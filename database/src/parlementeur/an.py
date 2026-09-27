"""Assemblée nationale : députés, groupes et scrutins de la législature en cours."""

from __future__ import annotations

import json
import re
import zipfile
from datetime import date

from .common import AN_BASE, as_list, fetch, log, slugify, val

LEGISLATURE = 17

AMO10 = f"{AN_BASE}/{LEGISLATURE}/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip"
AMO50 = f"{AN_BASE}/{LEGISLATURE}/amo/acteurs_mandats_organes_divises/AMO50_acteurs_mandats_organes_divises.json.zip"
SCRUTINS = f"{AN_BASE}/{LEGISLATURE}/loi/scrutins/Scrutins.json.zip"

# Ordre des groupes de la gauche vers la droite de l'hémicycle, et sigles affichés.
GROUP_ORDER = ["GDR", "LFI-NFP", "ECOS", "SOC", "LIOT", "EPR", "DEM", "HOR", "DR", "UDDPLR", "RN", "NI"]
DISPLAY_SIGLE = {"UDDPLR": "UDR", "ECOS": "EcoS", "DEM": "Dem"}
COLORS = {
    "GDR": "#9E1B1B", "LFI-NFP": "#CC2443", "ECOS": "#3A9D4F", "SOC": "#F08DA9", "LIOT": "#D8B545",
    "EPR": "#F7CB15", "DEM": "#F08A24", "HOR": "#45A9DA", "DR": "#2A5DB8", "UDDPLR": "#302C78",
    "RN": "#0D2B52", "NI": "#9A9A9A",
}
SHORT_NAMES = {"NI": "Non-inscrits"}


def _age(birth: str | None, today: date) -> int | None:
    if not birth:
        return None
    b = date.fromisoformat(birth[:10])
    return today.year - b.year - ((today.month, today.day) < (b.month, b.day))


def _ordinal_circo(n: str) -> str:
    return "1re" if n == "1" else f"{n}e"


def load_amo():
    """Députés en exercice, leurs groupes, et leurs mandats (historique limité à ce que publie l'AN)."""
    p10 = fetch(AMO10, f"an{LEGISLATURE}_amo10.json.zip", max_age_h=0.9)
    z = zipfile.ZipFile(p10)
    organes: dict[str, dict] = {}
    acteurs: list[dict] = []
    for n in z.namelist():
        if not n.endswith(".json"):
            continue
        doc = json.loads(z.read(n))
        if "organe" in doc:
            organes[doc["organe"]["uid"]] = doc["organe"]
        elif "acteur" in doc:
            acteurs.append(doc["acteur"])

    groupes = {
        uid: o for uid, o in organes.items() if o.get("codeType") == "GP" and str(o.get("legislature")) == str(LEGISLATURE)
    }
    today = date.today()
    deputes = []
    for a in acteurs:
        uid = a["uid"]["#text"]
        ident = a["etatCivil"]["ident"]
        mandats = as_list(a["mandats"]["mandat"])
        assemblee = next(
            (m for m in mandats if m["typeOrgane"] == "ASSEMBLEE" and str(m.get("legislature")) == str(LEGISLATURE) and not val(m.get("dateFin"))),
            None,
        )
        if not assemblee:
            continue
        gp = next((m for m in mandats if m["typeOrgane"] == "GP" and not val(m.get("dateFin"))), None)
        bureau = next((m for m in mandats if m["typeOrgane"] == "BUREAU" and not val(m.get("dateFin"))), None)
        fonction = (bureau or {}).get("infosQualite", {}).get("libQualiteSex") if bureau else None
        gp_ref = gp["organes"]["organeRef"] if gp else None
        sigle = groupes[gp_ref]["libelleAbrev"] if gp_ref in groupes else "NI"
        lieu = assemblee.get("election", {}).get("lieu", {})
        dep = val(lieu.get("departement"))
        circo = val(lieu.get("numCirco"))
        birth = val(a["etatCivil"].get("infoNaissance", {}).get("dateNais"))
        mandature = assemblee.get("mandature") or {}
        num = uid.removeprefix("PA")
        prof = val((a.get("profession") or {}).get("libelleCourant"))
        if prof:
            # L'AN préfixe parfois la profession de son code de nomenclature : "(23) - Chef d'entreprise".
            prof = re.sub(r"^\(\d+\)\s*-\s*", "", prof).strip()
            prof = prof[:1].upper() + prof[1:]
        deputes.append(
            {
                "id": uid,
                "prenom": ident["prenom"],
                # L'AN distingue les homonymes par un département entre parenthèses : on l'enlève du nom affiché.
                "nom": re.sub(r"\s*\([^)]*\)\s*$", "", ident["nom"]),
                "femme": ident.get("civ") == "Mme",
                "naissance": birth,
                "age": _age(birth, today),
                "groupeRef": gp_ref,
                "groupeCode": sigle,
                "departement": dep,
                "numDepartement": val(lieu.get("numDepartement")),
                "numCirco": circo,
                "circonscription": f"{_ordinal_circo(circo)} circonscription de {dep}" if dep and circo else None,
                "profession": prof,
                "place": val(mandature.get("placeHemicycle")),
                "fonction": fonction,
                "preside": bool(bureau and bureau.get("infosQualite", {}).get("codeQualite") == "Président"),
                "debut": val(mandature.get("datePriseFonction")) or assemblee.get("dateDebut"),
                "photoUrl": f"https://www2.assemblee-nationale.fr/static/tribun/{LEGISLATURE}/photos/{num}.jpg",
                "urlAN": f"https://www.assemblee-nationale.fr/dyn/deputes/{uid}",
                "uriHatvp": val(a.get("uri_hatvp")),
            }
        )

    # Slugs uniques (homonymes éventuels départagés par le département).
    seen: dict[str, int] = {}
    for d in deputes:
        s = slugify(f"{d['prenom']} {d['nom']}")
        seen[s] = seen.get(s, 0) + 1
    for d in deputes:
        s = slugify(f"{d['prenom']} {d['nom']}")
        d["slug"] = s if seen[s] == 1 else f"{s}-{slugify(d['departement'] or d['id'])}"

    groups_out = []
    for uid, o in groupes.items():
        code = o["libelleAbrev"]
        members = [d for d in deputes if d["groupeRef"] == uid]
        if not members:
            continue
        groups_out.append(
            {
                "ref": uid,
                "code": code,
                "sigle": DISPLAY_SIGLE.get(code, code),
                "nom": SHORT_NAMES.get(code, o["libelle"]),
                "couleur": COLORS.get(code, val(o.get("couleurAssociee")) or "#9A9A9A"),
                "effectif": len(members),
                "ordre": GROUP_ORDER.index(code) if code in GROUP_ORDER else len(GROUP_ORDER) // 2,
            }
        )
    # Non-inscrits sans organe GP : on les rattache à un groupe NI synthétique si nécessaire.
    orphans = [d for d in deputes if d["groupeRef"] not in groupes]
    if orphans and not any(g["code"] == "NI" for g in groups_out):
        groups_out.append({"ref": None, "code": "NI", "sigle": "NI", "nom": "Non-inscrits", "couleur": COLORS["NI"], "effectif": len(orphans), "ordre": len(GROUP_ORDER)})
    sigle_by_code = {g["code"]: g["sigle"] for g in groups_out}
    for d in deputes:
        d["groupe"] = sigle_by_code.get(d["groupeCode"], "NI")
    log(f"AMO : {len(deputes)} députés, {len(groups_out)} groupes")
    return deputes, groups_out, organes


def load_mandate_history(ids: set[str]):
    """Mandats de député de chaque élu actuel, tels que publiés par l'AN (fiable à partir de la XIVe)."""
    p50 = fetch(AMO50, f"an{LEGISLATURE}_amo50.json.zip")
    z = zipfile.ZipFile(p50)
    out: dict[str, list[dict]] = {i: [] for i in ids}
    gp_hist: dict[str, list[dict]] = {i: [] for i in ids}
    for n in z.namelist():
        if not n.startswith("mandat/"):
            continue
        m = json.loads(z.read(n))["mandat"]
        a = m.get("acteurRef")
        if a not in out:
            continue
        if m["typeOrgane"] == "ASSEMBLEE":
            lieu = (m.get("election") or {}).get("lieu") or {}
            dep, circo = val(lieu.get("departement")), val(lieu.get("numCirco"))
            out[a].append(
                {
                    "legislature": int(m["legislature"]),
                    "debut": m["dateDebut"],
                    "fin": val(m.get("dateFin")),
                    "circonscription": f"{_ordinal_circo(circo)} circonscription de {dep}" if dep and circo else None,
                }
            )
        elif m["typeOrgane"] == "GP" and str(m.get("legislature")) == str(LEGISLATURE):
            gp_hist[a].append({"ref": m["organes"]["organeRef"], "debut": m["dateDebut"], "fin": val(m.get("dateFin"))})
    for v in out.values():
        v.sort(key=lambda x: x["debut"])
    for v in gp_hist.values():
        v.sort(key=lambda x: x["debut"])
    return out, gp_hist


VOTE_KEYS = {"pours": "p", "contres": "c", "abstentions": "a", "nonVotants": "n"}


def load_scrutins():
    """Tous les scrutins publics de la législature, avec le vote nominatif de chaque député."""
    p = fetch(SCRUTINS, f"an{LEGISLATURE}_scrutins.json.zip", max_age_h=0.9)
    z = zipfile.ZipFile(p)
    scrutins = []
    for n in z.namelist():
        if not n.endswith(".json"):
            continue
        s = json.loads(z.read(n))["scrutin"]
        dec = s["syntheseVote"]["decompte"]
        votes: dict[str, str] = {}
        voter_group: dict[str, str] = {}
        delegues: set[str] = set()
        groupes = []
        for g in as_list(((s.get("ventilationVotes") or {}).get("organe") or {}).get("groupes", {}).get("groupe")):
            v = g.get("vote") or {}
            dv = v.get("decompteVoix") or {}
            nomi = v.get("decompteNominatif") or {}
            for key, code in VOTE_KEYS.items():
                block = nomi.get(key)
                if not block:
                    continue
                for voter in as_list(block.get("votant")):
                    if voter and voter.get("acteurRef"):
                        votes[voter["acteurRef"]] = code
                        voter_group[voter["acteurRef"]] = g["organeRef"]
                        # Vote émis par un collègue au nom du député absent.
                        if voter.get("parDelegation") == "true":
                            delegues.add(voter["acteurRef"])
            groupes.append(
                {
                    "ref": g["organeRef"],
                    "position": v.get("positionMajoritaire"),
                    "pour": int(dv.get("pour") or 0),
                    "contre": int(dv.get("contre") or 0),
                    "abstention": int(dv.get("abstentions") or 0),
                    "nonVotants": int(dv.get("nonVotants") or 0),
                }
            )
        type_code = s["typeVote"]["codeTypeVote"]
        titre = (s.get("objet") or {}).get("libelle") or s.get("titre") or ""
        titre = titre.strip()
        titre = titre[:1].upper() + titre[1:]
        titre = titre.rstrip(".")
        scrutins.append(
            {
                "numero": int(s["numero"]),
                "date": s["dateScrutin"],
                "titre": titre,
                "type": s["typeVote"]["libelleTypeVote"],
                "typeCode": type_code,
                "solennel": type_code == "SPS",
                "motion": type_code == "MOC",
                "adopte": s["sort"]["code"] == "adopté",
                "pour": int(dec.get("pour") or 0),
                "contre": int(dec.get("contre") or 0),
                "abstention": int(dec.get("abstentions") or 0),
                "votants": int(s["syntheseVote"].get("nombreVotants") or 0),
                "demandeur": val((s.get("demandeur") or {}).get("texte")),
                "seanceRef": val(s.get("seanceRef")),
                "url": f"https://www.assemblee-nationale.fr/dyn/{LEGISLATURE}/scrutins/{s['numero']}",
                "votes": votes,
                "voterGroup": voter_group,
                "delegues": delegues,
                "groupes": groupes,
            }
        )
    scrutins.sort(key=lambda x: x["numero"])
    log(f"scrutins : {len(scrutins)}")
    return scrutins


AMENDEMENTS = f"{AN_BASE}/{LEGISLATURE}/loi/amendements_div_legis/Amendements.json.zip"
QUESTIONS = f"{AN_BASE}/{LEGISLATURE}/questions/questions_ecrites/Questions_ecrites.json.zip"


def load_amendements() -> tuple[dict[str, dict], int]:
    """Amendements déposés (en premier signataire) et adoptés par député, en séance et en commission."""
    p = fetch(AMENDEMENTS, f"an{LEGISLATURE}_amendements.json.zip", max_age_h=20)
    out: dict[str, dict] = {}
    total = 0
    with zipfile.ZipFile(p) as z:
        for n in z.namelist():
            if not n.endswith(".json"):
                continue
            a = json.loads(z.read(n))["amendement"]
            total += 1
            auteur = (a.get("signataires") or {}).get("auteur") or {}
            ref = val(auteur.get("acteurRef"))
            if not ref or auteur.get("typeAuteur") != "Député":
                continue
            sort = val((a.get("cycleDeVie") or {}).get("sort"))
            row = out.setdefault(ref, {"deposes": 0, "adoptes": 0})
            row["deposes"] += 1
            if sort == "Adopté":
                row["adoptes"] += 1
    log(f"amendements : {total:,} lus, {sum(r['deposes'] for r in out.values()):,} déposés par des députés")
    return out, total


def load_questions() -> tuple[dict[str, dict], int]:
    """Questions écrites posées par chaque député, et part ayant reçu une réponse du gouvernement."""
    p = fetch(QUESTIONS, f"an{LEGISLATURE}_questions.json.zip", max_age_h=20)
    out: dict[str, dict] = {}
    total = 0
    with zipfile.ZipFile(p) as z:
        for n in z.namelist():
            if not n.endswith(".json"):
                continue
            q = json.loads(z.read(n))["question"]
            total += 1
            ref = val(((q.get("auteur") or {}).get("identite") or {}).get("acteurRef"))
            if not ref:
                continue
            row = out.setdefault(ref, {"posees": 0, "repondues": 0})
            row["posees"] += 1
            if val(q.get("textesReponse")):
                row["repondues"] += 1
    log(f"questions écrites : {total:,}")
    return out, total


def load_all_groups() -> dict[str, dict]:
    """Tous les groupes politiques de la législature, y compris ceux dissous ou renommés depuis."""
    z = zipfile.ZipFile(fetch(AMO50, f"an{LEGISLATURE}_amo50.json.zip"))
    out = {}
    for n in z.namelist():
        if n.startswith("organe/"):
            o = json.loads(z.read(n))["organe"]
            debut = ((o.get("viMoDe") or {}).get("dateDebut") or "")[:10]
            if o.get("codeType") == "GP" and (str(o.get("legislature")) == str(LEGISLATURE) or debut >= "2024-07-01"):
                out[o["uid"]] = {"sigle": DISPLAY_SIGLE.get(o["libelleAbrev"], o["libelleAbrev"]), "nom": o["libelle"]}
    return out


def load_organe_names() -> dict[str, str]:
    """Nom de tous les organes (commissions, délégations, groupes d'études…) cités dans l'agenda."""
    names = {}
    for path, prefix in ((fetch(AMO50, f"an{LEGISLATURE}_amo50.json.zip"), "organe/"), (fetch(AMO10, f"an{LEGISLATURE}_amo10.json.zip"), "json/organe/")):
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if n.startswith(prefix) and n.endswith(".json"):
                    o = json.loads(z.read(n))["organe"]
                    names[o["uid"]] = o.get("libelle") or o.get("libelleAbrege") or ""
    return names
