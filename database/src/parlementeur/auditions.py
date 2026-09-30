"""Qui a rencontré qui : sources nominatives reliant des députés à des organisations.

1. Annexes des rapports : l'article 22 de l'Instruction générale du Bureau de l'Assemblée impose que tout
   rapport liste « l'ensemble des auditions menées par le rapporteur », en distinguant les représentants
   d'intérêts inscrits au registre.
2. Auditions en commission : l'agenda nomme l'organisation entendue et liste les députés présents.
3. Amendements identiques déposés par des députés de groupes différents : signal d'un texte fourni de
   l'extérieur, à vérifier (ce n'est pas la preuve d'une rencontre).
"""

from __future__ import annotations

import html
import hashlib
import json
import re
import unicodedata
import zipfile
from pathlib import Path

import httpx
from lxml import html as lhtml

from .common import AN_BASE, RAW, USER_AGENT, as_list, fetch, log, val

DOSSIERS = f"{AN_BASE}/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip"
RAW_URL = "https://www.assemblee-nationale.fr/dyn/docs/{uid}.raw"
PAGE_URL = "https://www.assemblee-nationale.fr/dyn/17/rapports/{uid}"


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _clean(s: str) -> str:
    s = re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()
    return s.strip(" ;,.")


def list_reports() -> list[dict]:
    """Rapports de la législature avec leurs rapporteurs, d'après les dossiers législatifs."""
    z = zipfile.ZipFile(fetch(DOSSIERS, "an17_dossiers.json.zip", max_age_h=20))
    out = []
    for n in z.namelist():
        base = n.rsplit("/", 1)[-1]
        if not (base.startswith("RAPP") and "L17" in base and base.endswith(".json")):
            continue
        doc = json.loads(z.read(n)).get("document") or {}
        uid = doc.get("uid")
        if not uid:
            continue
        rapporteurs = []
        for a in as_list((doc.get("auteurs") or {}).get("auteur")):
            ac = (a or {}).get("acteur") or {}
            ref = val(ac.get("acteurRef"))
            if ref and "rapporteur" in (val(ac.get("qualite")) or "").lower():
                rapporteurs.append(ref)
        titres = doc.get("titres") or {}
        chrono = (doc.get("cycleDeVie") or {}).get("chrono") or {}
        out.append(
            {
                "uid": uid,
                "titre": (val(titres.get("titrePrincipalCourt")) or val(titres.get("titrePrincipal")) or "").strip(),
                "date": (val(chrono.get("dateDepot")) or val(chrono.get("datePublication")) or "")[:10],
                "rapporteurs": rapporteurs,
            }
        )
    return out


def _fetch_raw(uid: str) -> Path | None:
    """Texte intégral d'un rapport, mis en cache une fois pour toutes (un rapport publié ne change pas)."""
    d = RAW / "rapports"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{uid}.raw"
    if p.exists() and p.stat().st_size > 0:
        return p
    try:
        r = httpx.get(RAW_URL.format(uid=uid), timeout=120, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or len(r.content) < 500:
        p.write_bytes(b"")
        return None
    p.write_bytes(r.content)
    return p


BULLET = re.compile(r"^[\s\u2013\u2014\-•·▪◦●\uf000-\uf8ff]+")
# « Organisation (Sigle) – M. Nom, fonction » sur une seule ligne.
INLINE = re.compile(r"^(?P<org>[^–—]{3,160}?)\s+[–—-]\s+(?P<rest>(?:M\.|Mme|MM\.|Mmes|Me|Dr|Pr)\s.*)$")
PERSON = re.compile(r"^(M\.|Mme|Mmes|MM\.|Me|Dr|Pr|Général|Amiral|Colonel|Commissaire)\s", re.I)


def parse_annex(raw: bytes) -> list[dict]:
    """Extrait (organisation, personne, fonction, inscrit au registre) de l'annexe des auditions."""
    try:
        tree = lhtml.fromstring(raw.decode("utf-8", "ignore"))
    except (ValueError, lhtml.etree.ParserError):
        return []
    paras = [_clean(p.text_content()) for p in tree.iter("p", "li", "h1", "h2", "h3", "h4", "h5", "h6")]
    paras = [p for p in paras if p]
    def is_head(p: str) -> str | None:
        n = _norm(p)
        if len(p) > 160:
            return None
        if ("auditionn" in n or "entendu" in n) and ("liste" in n or "personnes" in n or "annexe" in n):
            return "audition"
        if "contribution" in n and ("ecrite" in n or "recue" in n) and ("liste" in n or "annexe" in n or len(n) < 40):
            return "contribution"
        return None
    heads = [(i, is_head(p)) for i, p in enumerate(paras)]
    heads = [(i, k) for i, k in heads if k]
    if not heads:
        return []
    # Le sommaire répète les intitulés en tête de rapport : seule la dernière occurrence est l'annexe.
    last: dict[str, int] = {}
    for i, k in heads:
        last[k] = i
    heads = sorted((i, k) for k, i in last.items())
    # Plusieurs annexes possibles (auditions puis contributions écrites) : on les lit toutes.
    rows_all: list[dict] = []
    for hi, (start, kind) in enumerate(heads):
        end = heads[hi + 1][0] if hi + 1 < len(heads) else len(paras)
        for r in _parse_block(paras[start + 1 : end]):
            r["type"] = kind
            rows_all.append(r)
    return rows_all


def _parse_block(paras: list[str]) -> list[dict]:
    rows: list[dict] = []
    org = None
    registre_note = False
    for p in paras:
        n = _norm(p)
        if n.startswith("annexe") or n.startswith("examen en commission") or n.startswith("travaux de la commission") or re.match(r"^\(\s*\d+\s*\)", p) or re.match(r"^\[\d+\]", p):
            break
        # Une prise de parole en séance ou en commission (« M. X (GDR). Texte… ») n'est pas une audition.
        if re.search(r"\((RN|LFI|LFI-NFP|SOC|EPR|DR|GDR|LIOT|HOR|Dem|EcoS|UDR|NI|ECOS|DEM)\)\.", p):
            continue
        if "registre" in n and ("representant" in n or "hatvp" in n or "haute autorite" in n):
            registre_note = True
            continue
        if n.startswith("par l") and "rapporteur" in n:
            continue
        # Puces : tirets, points, ou symboles Word hors alphabet (zone privée Unicode).
        body = BULLET.sub("", p).strip()
        bulleted = body != p.strip()
        inline = INLINE.match(body)
        if inline:
            org = _clean(inline.group("org").replace("*", ""))
            body = inline.group("rest")
        if bulleted or inline or PERSON.match(body):
            if not PERSON.match(body):
                continue
            name, _, fonction = body.partition(",")
            rows.append({"organisation": org, "personne": _clean(name), "fonction": _clean(fonction), "detail": _clean(body.replace("*", "")), "etoile": "*" in p})
        elif len(p) < 220 and not re.match(r"^\d{1,2}\s", n) and not re.match(r"^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b", n):
            # Une phrase d'explication, un lien ou une mention de vidéo n'est pas un nom d'organisation.
            if len(p.split()) > 14 or re.search(r"\b(sont|est|ont|a été|ont été)\b", n) or re.match(r"^(https?:|www\.|lien|video|compte rendu|\(par ordre)", n):
                continue
            org = _clean(p.replace("*", ""))
            org_star = "*" in p
            if org_star:
                rows.append({"organisation": org, "personne": None, "fonction": None, "etoile": True, "_header": True})
    # Rattache l'astérisque d'un en-tête d'organisation aux personnes qui suivent.
    starred = {r["organisation"] for r in rows if r.get("_header")}
    out = [r for r in rows if not r.get("_header")]
    for r in out:
        r["etoile"] = r["etoile"] or r["organisation"] in starred
    if not registre_note:
        for r in out:
            r["etoile"] = False
    # Une organisation sans personne nommée reste une audition (ex. « Medef » seul).
    named = {r["organisation"] for r in out}
    for o in starred - named:
        out.append({"organisation": o, "personne": None, "fonction": None, "detail": o, "etoile": True})
    return [r for r in out if r["organisation"] or r["personne"]]


def report_auditions(max_new: int = 400) -> list[dict]:
    reports = list_reports()
    new = 0
    rows = []
    for rep in sorted(reports, key=lambda r: r["date"], reverse=True):
        cached = (RAW / "rapports" / f"{rep['uid']}.raw").exists()
        if not cached:
            if new >= max_new:
                continue
            new += 1
        p = _fetch_raw(rep["uid"])
        if not p:
            continue
        for a in parse_annex(p.read_bytes()):
            rows.append({**a, "rapport": rep["uid"], "titre": rep["titre"], "date": rep["date"], "rapporteurs": rep["rapporteurs"], "url": PAGE_URL.format(uid=rep["uid"])})
    avec = len({r["rapport"] for r in rows})
    lisibles = sum(1 for rep in reports if (RAW / "rapports" / f"{rep['uid']}.raw").exists() and (RAW / "rapports" / f"{rep['uid']}.raw").stat().st_size)
    log(f"auditions des rapporteurs : {len(rows)} lignes, annexe lue dans {avec} rapports sur {lisibles} disponibles ({new} téléchargés)")
    report_auditions.couverture = {"rapports": len(reports), "lisibles": lisibles, "avecAnnexe": avec}
    return rows


def commission_auditions(events_raw: list[dict]) -> list[dict]:
    """Auditions inscrites à l'ordre du jour des commissions, avec les députés présents."""
    out = []
    for e in events_raw:
        texte = e.get("texte") or ""
        if "audition" not in texte.lower():
            continue
        out.append(e)
    return out


def identical_amendments() -> list[dict]:
    """Amendements au texte strictement identique déposés par au moins trois députés de deux groupes différents."""
    z = zipfile.ZipFile(fetch(f"{AN_BASE}/17/loi/amendements_div_legis/Amendements.json.zip", "an17_amendements.json.zip", max_age_h=20))
    clusters: dict[str, dict] = {}
    for n in z.namelist():
        if not n.endswith(".json"):
            continue
        a = json.loads(z.read(n))["amendement"]
        corps = (a.get("corps") or {}).get("contenuAuteur") or {}
        disp = val(corps.get("dispositif")) or ""
        # Textes publiés en HTML avec entités (&#x00E9;) et accents décomposés (e + accent combinant).
        text = unicodedata.normalize("NFC", html.unescape(re.sub(r"<[^>]+>", " ", disp)))
        key_text = _norm(re.sub(r"[^\w ]", " ", text))
        if len(key_text) < 60:
            continue
        sig = (a.get("signataires") or {}).get("auteur") or {}
        ref, grp = val(sig.get("acteurRef")), val(sig.get("groupePolitiqueRef"))
        if not ref or sig.get("typeAuteur") != "Député":
            continue
        texte_ref = ((a.get("pointeurFragmentTexte") or {}).get("division") or {}).get("titre") or ""
        k = hashlib.sha1(key_text.encode()).hexdigest()[:16]
        c = clusters.setdefault(k, {"texte": _clean(text)[:600], "deputes": {}, "groupes": set(), "numeros": [], "adoptes": 0, "cible": texte_ref})
        c["deputes"][ref] = grp
        c["groupes"].add(grp)
        c["numeros"].append(val(a.get("uid")))
        if val((a.get("cycleDeVie") or {}).get("sort")) == "Adopté":
            c["adoptes"] += 1
    out = []
    for k, c in clusters.items():
        if len(c["deputes"]) >= 3 and len(c["groupes"]) >= 2:
            out.append({"id": k, "texte": c["texte"], "deputes": list(c["deputes"]), "groupes": sorted(g for g in c["groupes"] if g), "n": len(c["numeros"]), "adoptes": c["adoptes"], "exemple": c["numeros"][0]})
    out.sort(key=lambda c: (-len(c["groupes"]), -len(c["deputes"])))
    log(f"amendements identiques : {len(out)} textes déposés par 3 députés ou plus de groupes différents")
    return out


def match_registry(org: str | None, agora_names: dict[str, str]) -> str | None:
    """Rapproche un nom d'organisation du répertoire de la HATVP (nom normalisé identique ou inclus)."""
    if not org:
        return None
    n = _norm(re.sub(r"\(.*?\)", "", org))
    n = re.sub(r"[^a-z0-9 ]", " ", n).strip()
    if len(n) < 4:
        return None
    if n in agora_names:
        return agora_names[n]
    # Sigle entre parenthèses : « Mouvement des entreprises de France (Medef) ».
    for s in re.findall(r"\(([^)]+)\)", org):
        s2 = re.sub(r"[^a-z0-9 ]", " ", _norm(s)).strip()
        if len(s2) >= 3 and s2 in agora_names:
            return agora_names[s2]
    return None


LEGAL = r"\b(sas|sasu|sa|sarl|eurl|snc|sca|se|groupe|group|france|association|federation)\b"


def registry_index(agora_json: Path) -> list[tuple[re.Pattern, str, bool]]:
    """Motifs de recherche des organisations inscrites au répertoire de la HATVP.

    Nom complet normalisé ; forme sans statut juridique seulement si elle garde au moins deux mots.
    Les noms d'un seul mot doivent apparaître avec une majuscule dans le texte d'origine.
    """
    data = json.loads(agora_json.read_text("utf-8"))
    out = []
    seen = set()
    for pub in data["publications"]:
        name = pub.get("denomination") or ""
        n = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", _norm(re.sub(r"\(.*?\)", "", name)))).strip()
        core = re.sub(r"\s+", " ", re.sub(LEGAL, " ", n)).strip()
        cands = {n} | ({core} if len(core.split()) >= 2 else set())
        for cand in cands:
            if len(cand) < 4 or cand in seen:
                continue
            seen.add(cand)
            single = len(cand.split()) == 1
            if single:
                # Mot seul : on exige la forme capitalisée dans le texte d'origine (Airbus, AIRBUS).
                word = re.escape(cand)
                # Pas collé à un trait d'union : « La Roche-sur-Yon » n'est pas l'entreprise Roche.
                out.append((re.compile(r"(?<![-’'])\b(" + word.capitalize() + "|" + word.upper() + r")\b(?![-’'])"), name, True))
            else:
                out.append((re.compile(r"\b" + re.escape(cand) + r"\b"), name, False))
    return out


def find_registered(text: str, index: list[tuple[re.Pattern, str, bool]]) -> list[str]:
    t = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", _norm(text)))
    raw = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    hits = []
    for pat, name, single in index:
        if name in hits or name.upper() in AMBIGUS:
            continue
        if single:
            # Un nom de famille (« M. Legrand », « Mme Roche ») n'est pas l'entreprise du même nom.
            ok = any(not PERSON_BEFORE.search(raw[max(0, m.start() - 40) : m.start()]) for m in pat.finditer(raw))
            if ok:
                hits.append(name)
        elif pat.search(t):
            hits.append(name)
    return hits


# Civilité suivie d'éventuels prénoms juste avant le mot : c'est un nom de personne.
PERSON_BEFORE = re.compile(r"(M\.|Mme|Mmes|MM\.|Me|Dr|Pr)\s+(?:[A-Z][\w'-]*\.?\s+){0,3}$")

# Noms d'organisations qui sont aussi des mots courants : trop de faux positifs pour un rapprochement automatique.
AMBIGUS = {"PRINTEMPS", "AVENIR", "DEMAIN", "ENSEMBLE", "HORIZON", "HORIZONS", "ACTION", "ENERGIE", "SANTE", "ENQUETE", "SEANCE PUBLIQUE", "LIBERTE", "SOLIDARITE", "CITOYENS", "TERRITOIRES"}


def drop_generic(rows: list[dict], key: str = "registre", cap: int = 40) -> None:
    """Un nom trouvé dans un nombre anormal d'auditions est un mot courant, pas une organisation."""
    from collections import Counter

    c = Counter(n for r in rows for n in r.get(key, []))
    generic = {n for n, k in c.items() if k > cap}
    for r in rows:
        r[key] = [n for n in r.get(key, []) if n not in generic]
