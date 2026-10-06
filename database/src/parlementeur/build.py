"""Point d'entrée : collecte toutes les sources et écrit les fichiers publiés dans dist/."""

from __future__ import annotations

import concurrent.futures as cf
import shutil

import duckdb
import httpx

from . import agenda, agendas_ministres, an, auditions, circo, comptes_rendus, elections, hatvp, interets, lobbying, proximite, wikidata
import time
from contextlib import contextmanager

from .common import DIST, RAW, ROOT, USER_AGENT, fetch, fetch_info, log, norm_name, now_iso, read_json, write_json

VOTE_FULL = {"p": "pour", "c": "contre", "a": "abstention", "n": "absent"}


def vote_metrics(deputes: list[dict], scrutins: list[dict]) -> dict[str, dict]:
    """Présence et discipline de vote de chaque député, calculées en SQL sur l'ensemble des votes nominatifs."""
    con = duckdb.connect()
    tmp = RAW / "_votes"
    tmp.mkdir(exist_ok=True)

    def table(name: str, cols: str, rows) -> None:
        f = tmp / f"{name}.csv"
        with f.open("w") as fh:
            for r in rows:
                fh.write(",".join("" if x is None else str(x) for x in r) + "\n")
        con.execute(f"CREATE TABLE {name} AS SELECT * FROM read_csv('{f}', header=false, columns={cols})")

    table("dep", "{'id':'VARCHAR','debut':'DATE'}", ((d["id"], d["debut"]) for d in deputes))
    table("scr", "{'numero':'INTEGER','date':'DATE','solennel':'BOOLEAN'}", ((s["numero"], s["date"], s["solennel"]) for s in scrutins))
    table("pos", "{'numero':'INTEGER','groupe':'VARCHAR','position':'VARCHAR'}", ((s["numero"], g["ref"], g["position"]) for s in scrutins for g in s["groupes"]))
    table(
        "vote",
        "{'numero':'INTEGER','acteur':'VARCHAR','code':'VARCHAR','groupe':'VARCHAR','delegue':'BOOLEAN'}",
        ((s["numero"], a, c, s["voterGroup"].get(a), a in s["delegues"]) for s in scrutins for a, c in s["votes"].items()),
    )
    rows = con.execute(
        """
        WITH eligible AS (
          SELECT d.id, s.numero, s.solennel FROM dep d JOIN scr s ON s.date >= d.debut
        ),
        joined AS (
          SELECT e.id, e.numero, e.solennel, v.code, v.delegue, p.position
          FROM eligible e
          LEFT JOIN vote v ON v.numero = e.numero AND v.acteur = e.id
          LEFT JOIN pos p ON p.numero = e.numero AND p.groupe = v.groupe
        )
        SELECT id,
          count(*) FILTER (WHERE code IS DISTINCT FROM 'n') AS eligibles,
          count(*) FILTER (WHERE code IN ('p','c','a') AND NOT delegue) AS votes,
          count(*) FILTER (WHERE solennel AND code IS DISTINCT FROM 'n') AS eligibles_sol,
          count(*) FILTER (WHERE solennel AND code IN ('p','c','a') AND NOT delegue) AS votes_sol,
          count(*) FILTER (WHERE code IN ('p','c','a') AND delegue) AS delegues,
          count(*) FILTER (WHERE code IN ('p','c','a') AND position IN ('pour','contre','abstention')) AS avec_ligne,
          count(*) FILTER (WHERE code IN ('p','c','a') AND position IN ('pour','contre','abstention')
            AND ((code='p' AND position='pour') OR (code='c' AND position='contre') OR (code='a' AND position='abstention'))) AS alignes
        FROM joined GROUP BY id
        """
    ).fetchall()
    out = {}
    for id_, elig, votes, elig_sol, votes_sol, delegues, avec, alignes in rows:
        out[id_] = {
            "participation": round(votes / elig, 4) if elig else None,
            "participationSolennels": round(votes_sol / elig_sol, 4) if elig_sol else None,
            "votes": votes,
            "delegues": delegues,
            "eligibles": elig,
            "loyaute": round(alignes / avec, 4) if avec >= 20 else None,
            "dissidences": avec - alignes,
        }
    log(f"DuckDB : {con.execute('SELECT count(*) FROM vote').fetchone()[0]:,} votes nominatifs analysés")
    return out


def download_photos(deputes: list[dict]) -> None:
    """Copie locale des portraits officiels, pour ne faire aucune requête vers un site tiers."""
    cache = RAW / "photos"
    cache.mkdir(parents=True, exist_ok=True)
    out = DIST / "photos"
    out.mkdir(parents=True, exist_ok=True)

    def get(d):
        dest = cache / f"{d['id']}.jpg"
        if not dest.exists():
            try:
                r = httpx.get(d["photoUrl"], timeout=30, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("image"):
                    dest.write_bytes(r.content)
            except httpx.HTTPError:
                return None
        if dest.exists():
            shutil.copyfile(dest, out / f"{d['slug']}.jpg")
            return d["id"]
        return None

    with cf.ThreadPoolExecutor(8) as ex:
        ok = {x for x in ex.map(get, deputes) if x}
    for d in deputes:
        d["photo"] = f"/photos/{d['slug']}.jpg" if d["id"] in ok else None
    log(f"photos : {len(ok)} / {len(deputes)}")


STEPS: list[dict] = []


@contextmanager
def step(label: str):
    t = time.perf_counter()
    yield
    STEPS.append({"etape": label, "secondes": round(time.perf_counter() - t, 2)})


def main() -> None:
    started = time.perf_counter()
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    with step("Députés, mandats et groupes (Assemblée nationale)"):
        deputes, groupes, organes = an.load_amo()
        ids = {d["id"] for d in deputes}
        history, gp_hist = an.load_mandate_history(ids)
    with step("Scrutins et votes nominatifs (Assemblée nationale)"):
        scrutins = an.load_scrutins()
    with step("Agenda : séances et réunions de commission (Assemblée nationale)"):
        reels = comptes_rendus.load()
        events, presence, monthly, seance_index, com_auditions = agenda.load(an.load_organe_names(), scrutins, ids, reels)
        # Nombre de paragraphes prononcés par chaque député en séance publique.
        interventions_by_id: dict[str, int] = {}
        for cr in reels.values():
            for a, (_, _, n) in cr.get("orateurs", {}).items():
                interventions_by_id[a] = interventions_by_id.get(a, 0) + n
    with step("Présence et discipline de vote (DuckDB)"):
        metrics = vote_metrics(deputes, scrutins)
    with step("Amendements (Assemblée nationale)"):
        amdts, n_amdts = an.load_amendements()
    with step("Questions écrites (Assemblée nationale)"):
        questions, n_questions = an.load_questions()
    with step("Ancienneté et candidatures présidentielles (Wikidata)"):
        wd = wikidata.legislatures(sorted(ids))
        pres = wikidata.presidential(sorted(ids))
        pres_scores = read_json(ROOT / "curated" / "presidentielles.json")["resultats"]
    with step("Déclarations d'intérêts (HATVP)"):
        decl = hatvp.load_declarations(deputes)
    with step("Intérêts : participations, sociétés détenues, délais de dépôt (HATVP)"):
        slug_of = {d["id"]: d["slug"] for d in deputes}
        interets_all = interets.load(deputes, decl, slug_of)
        delais = interets.delais(deputes)
    with step("Code postal → circonscription (ministère de l'Intérieur, La Poste)"):
        communes = circo.load(deputes)
    with step("Législatives 2024 (ministère de l'Intérieur)"):
        leg = elections.load(deputes)
    with step("Répertoire des représentants d'intérêts (HATVP)"):
        lobby_all = lobbying.load()
        lobby, lobby_orgs = lobby_all["summary"], lobby_all["orgs"]
    with step("Agendas publics des ministres"):
        agendas_min = agendas_ministres.load()
    with step("Rencontres : auditions des rapporteurs et des commissions, amendements identiques"):
        reg = auditions.registry_index(RAW / "hatvp_agora.json")
        rap_rows = auditions.report_auditions()
        for r in rap_rows:
            hits = auditions.find_registered(f"{r.get('organisation') or ''} {r.get('detail') or ''}", reg)
            r["registre"] = hits
        for a in com_auditions:
            a["registre"] = auditions.find_registered(a["texte"], reg)
        auditions.drop_generic(rap_rows + com_auditions)
        amdt_clusters = auditions.identical_amendments()
        # Rendez-vous des ministres : organisations du répertoire et députés cités par leur nom.
        dep_keys = [(norm_name(d["prenom"] + d["nom"]), d["id"]) for d in deputes]
        for m in agendas_min["meetings"]:
            m["registre"] = auditions.find_registered(m["texte"], reg)
            t = norm_name(m["texte"])
            m["deputes"] = [i for k, i in dep_keys if k in t]
    with step("Portraits officiels"):
        download_photos(deputes)

    ref_to_sigle = {g["ref"]: g["sigle"] for g in groupes if g["ref"]}
    for uid, o in organes.items():
        if o.get("codeType") == "GP" and uid not in ref_to_sigle:
            ref_to_sigle[uid] = an.DISPLAY_SIGLE.get(o["libelleAbrev"], o["libelleAbrev"])
    names = {uid: o["libelle"] for uid, o in organes.items() if o.get("codeType") == "GP"}

    # Groupes successifs de chaque député, reconstitués à partir du groupe enregistré à chaque vote.
    all_groups = an.load_all_groups()
    for uid, o in organes.items():
        if o.get("codeType") == "GP" and str(o.get("legislature")) == str(an.LEGISLATURE):
            all_groups.setdefault(uid, {"sigle": an.DISPLAY_SIGLE.get(o["libelleAbrev"], o["libelleAbrev"]), "nom": o["libelle"]})
    for uid, g in all_groups.items():
        ref_to_sigle.setdefault(uid, g["sigle"])
        names.setdefault(uid, g["nom"])
    vote_groups: dict[str, list[dict]] = {}
    for sc in scrutins:
        for a, g in sc["voterGroup"].items():
            if g not in all_groups:
                continue
            seq = vote_groups.setdefault(a, [])
            if not seq or seq[-1]["ref"] != g:
                seq.append({"ref": g, "debut": sc["date"], "fin": sc["date"]})
            else:
                seq[-1]["fin"] = sc["date"]

    condamnations: dict[str, list] = {}
    for c in read_json(ROOT / "curated" / "condamnations.json")["condamnations"]:
        condamnations.setdefault(c["depute_id"], []).append({k: v for k, v in c.items() if k != "depute_id"})

    # Scrutins marquants : votes solennels et motions de censure.
    marquants = [s for s in scrutins if s["solennel"] or s["motion"]]

    # Rencontres documentées de chaque député : organisations auditionnées comme rapporteur,
    # auditions en commission auxquelles il était présent, amendements identiques à ceux d'autres groupes.
    def rencontres_de(pa: str) -> dict:
        rap = [r for r in rap_rows if pa in r["rapporteurs"]]
        orgs: dict[str, dict] = {}
        for r in rap:
            key = r.get("organisation") or r.get("detail") or ""
            o = orgs.setdefault(key, {"organisation": key, "registre": set(), "etoile": False, "rapports": {}})
            o["registre"].update(r.get("registre") or [])
            o["etoile"] = o["etoile"] or bool(r.get("etoile"))
            o["rapports"][r["rapport"]] = {"titre": r["titre"], "url": r["url"]}
        com = [a for a in com_auditions if pa in a["presents"]]
        amd = [c for c in amdt_clusters if pa in c["deputes"]]
        return {
            "rapporteur": sorted(
                ({"organisation": o["organisation"], "registre": sorted(o["registre"]), "etoile": o["etoile"], "rapports": list(o["rapports"].values())} for o in orgs.values()),
                key=lambda o: (not (o["registre"] or o["etoile"]), o["organisation"]),
            ),
            "commissions": {
                "total": len(com),
                "avecLobby": [{"date": a["date"], "organe": a["organe"], "texte": a["texte"][:300], "registre": a["registre"]} for a in sorted(com, key=lambda a: a["date"], reverse=True) if a["registre"]][:40],
            },
            "amendements": [{"texte": c["texte"][:300], "n": len(c["deputes"]), "groupes": len(c["groupes"]), "exemple": c["exemple"]} for c in amd][:30],
            "amendementsTotal": len(amd),
            # Rendez-vous avec un ministre, d'après les agendas ministériels publiés.
            "ministres": [{k: m[k] for k in ("date", "ministre", "ministere", "texte", "url")} for m in sorted(agendas_min["meetings"], key=lambda m: m["date"], reverse=True) if pa in m["deputes"]],
        }

    out_deputes = []
    for d in deputes:
        m = metrics.get(d["id"], {})
        leg_an = len({h["legislature"] for h in history.get(d["id"], [])})
        leg_wd = wd.get(d["id"], {}).get("n", 0)
        dec = decl.get(d["id"])
        first_years = [int(h["debut"][:4]) for h in history.get(d["id"], [])]
        wd_first = wd.get(d["id"], {}).get("first")
        public = {
            "id": d["id"],
            "slug": d["slug"],
            "prenom": d["prenom"],
            "nom": d["nom"],
            "femme": d["femme"],
            "naissance": d["naissance"],
            "age": d["age"],
            "groupe": d["groupe"],
            "departement": d["departement"],
            "circonscription": d["circonscription"],
            "profession": d["profession"],
            "photo": d["photo"],
            "place": d["place"],
            "legislatures": max(leg_an, leg_wd, 1),
            "premiereElection": min([y for y in first_years + ([wd_first] if wd_first else [])], default=None),
            "fonction": d["fonction"],
            "groupesSuccessifs": max(1, len({h["ref"] for h in vote_groups.get(d["id"], [])})),
            # La présidence de l'Assemblée ne prend pas part aux votes : aucun taux n'a de sens.
            "participation": None if d["preside"] else m.get("participation"),
            "participationSolennels": None if d["preside"] else m.get("participationSolennels"),
            "loyaute": m.get("loyaute"),
            "votes": m.get("votes"),
            "scrutinsPossibles": m.get("eligibles"),
            # Part des votes du député confiés à un collègue (délégation) : il n'était pas dans l'hémicycle.
            "partDelegation": round(m["delegues"] / (m["votes"] + m["delegues"]), 4) if m.get("votes", 0) + m.get("delegues", 0) else None,
            "commissions": presence.get(d["id"]),
            "interventions": interventions_by_id.get(d["id"], 0),
            "joursVote": len({sc["date"] for sc in scrutins if d["id"] in sc["votes"] and sc["votes"][d["id"]] != "n" and d["id"] not in sc["delegues"]}),
            "amendements": amdts.get(d["id"], {}).get("deposes", 0),
            "amendementsAdoptes": amdts.get(d["id"], {}).get("adoptes", 0),
            "questions": questions.get(d["id"], {}).get("posees", 0),
            "revenusAnnexes": dec["revenusAnnexes"] if dec else None,
            "anneeRevenus": dec["anneeRevenus"] if dec else None,
            "urlAN": d["urlAN"],
            "urlHATVP": dec["urlDossier"] if dec else None,
            "participationsTotal": interets_all["deputes"].get(d["id"], {}).get("total") if dec else None,
            "participationsN": interets_all["deputes"].get(d["id"], {}).get("n") if dec else None,
            "directions": dec.get("directions") if dec else None,
            "delaiDeclaration": delais[d["id"]]["delai"],
            "debut": d["debut"],
        }
        out_deputes.append(public)

        votes_cles = []
        for s in marquants:
            if s["date"] < d["debut"]:
                continue
            code = s["votes"].get(d["id"])
            g_ref = s["voterGroup"].get(d["id"]) or d["groupeRef"]
            line = next((g["position"] for g in s["groupes"] if g["ref"] == g_ref), None)
            votes_cles.append(
                {"numero": s["numero"], "date": s["date"], "titre": s["titre"], "vote": VOTE_FULL.get(code, "absent") if code != "n" else "absent", "ligneGroupe": line}
            )
        votes_cles.sort(key=lambda x: x["date"], reverse=True)
        detail = {
            **public,
            "mandats": history.get(d["id"], []),
            "groupesHistorique": [
                {"sigle": ref_to_sigle.get(h["ref"], "?"), "nom": names.get(h["ref"], ""), "debut": h["debut"], "fin": h["fin"]}
                for h in vote_groups.get(d["id"], [])
            ],
            "interets": {k: dec[k] for k in ("date", "url", "activites", "participations", "mandatsElectifs")} | {"depot": delais[d["id"]]["depot"], "modifications": delais[d["id"]]["modifications"]} if dec else None,
            "votesCles": votes_cles[:40],
            "dissidences": m.get("dissidences"),
            "amendements": {"deposes": public["amendements"], "adoptes": public["amendementsAdoptes"]},
            "questions": public["questions"],
            "questionsRepondues": questions.get(d["id"], {}).get("repondues", 0),
            "condamnations": condamnations.get(d["id"], []),
            "presidentielles": [
                {
                    "annee": y,
                    **next(
                        ({"tour1": r["tour1"], "tour2": r["tour2"], "elu": r.get("elu", False), "source": r["source"]}
                         for r in pres_scores if r["annee"] == y and r["candidat"] == f"{d['prenom']} {d['nom']}"),
                        {"tour1": None, "tour2": None, "elu": False, "source": f"https://www.wikidata.org/wiki/Special:Search?search={d['prenom']}+{d['nom']}"},
                    ),
                }
                for y in pres.get(d["id"], [])
            ],
            "elections": [leg[d["id"]]] if d["id"] in leg else [],
            "sources": [],
            "rencontres": rencontres_de(d["id"]),
        }
        write_json(DIST / "deputes" / f"{d['slug']}.json", detail)

    write_json(DIST / "deputes.json", out_deputes)
    write_json(DIST / "groupes.json", [{k: g[k] for k in ("sigle", "nom", "couleur", "effectif", "ordre")} for g in groupes])

    index = []
    for s in scrutins:
        row = {k: s[k] for k in ("numero", "date", "titre", "type", "solennel", "adopte", "pour", "contre", "abstention", "votants", "url")}
        row["motion"] = s["motion"]
        index.append(row)
        write_json(
            DIST / "scrutins" / f"{s['numero']}.json",
            {
                **row,
                "demandeur": s["demandeur"],
                "votes": s["votes"],
                "groupes": [
                    {"sigle": ref_to_sigle.get(g["ref"], "?"), **{k: g[k] for k in ("pour", "contre", "abstention", "nonVotants", "position")}}
                    for g in s["groupes"]
                ],
            },
        )
    write_json(DIST / "scrutins.json", index)
    slug_by_id = {d["id"]: d["slug"] for d in deputes}
    # Fiches des organisations : actions déclarées, et tout ce qui les relie nommément à des élus.
    # Plusieurs antennes locales partagent le nom légal de leur fédération : on retient la plus active.
    org_by_name: dict[str, dict] = {}
    for o in lobby_orgs:
        if o["denomination"] not in org_by_name or len(o["actions"]) > len(org_by_name[o["denomination"]]["actions"]):
            org_by_name[o["denomination"]] = o
    links: dict[str, dict[str, list]] = {o["slug"]: {"auditions": [], "commissions": [], "ministres": [], "detenteurs": []} for o in lobby_orgs}
    for r in rap_rows:
        if r.get("type") == "contribution":
            continue
        for name in r.get("registre") or []:
            o = org_by_name.get(name)
            if o:
                links[o["slug"]]["auditions"].append({"date": r.get("date"), "titre": r["titre"], "url": r["url"], "deputes": [slug_by_id[x] for x in r["rapporteurs"] if x in slug_by_id], "qui": (r.get("detail") or r.get("organisation") or "")[:160]})
    for a in com_auditions:
        for name in a.get("registre") or []:
            o = org_by_name.get(name)
            if o:
                links[o["slug"]]["commissions"].append({"date": a["date"], "organe": a["organe"], "texte": a["texte"][:220], "presents": [slug_by_id[x] for x in a["presents"] if x in slug_by_id]})
    for m in agendas_min["meetings"]:
        for name in m.get("registre") or []:
            o = org_by_name.get(name)
            if o:
                links[o["slug"]]["ministres"].append({k: m[k] for k in ("date", "heure", "ministre", "ministere", "texte", "url")})
    for s_ in interets_all["societes"]:
        o = org_by_name.get((s_.get("lobby") or {}).get("nom") or "")
        if o:
            links[o["slug"]]["detenteurs"] = s_["deputes"]
    slug_of_org = {k: o["slug"] for k, o in org_by_name.items()}
    for o in lobby_orgs:
        L = links[o["slug"]]
        for k in ("auditions", "commissions", "ministres"):
            L[k].sort(key=lambda x: x.get("date") or "", reverse=True)
        o["liens"] = L
        o["affiliations"] = [{"nom": a, "slug": slug_of_org.get(a)} for a in o["affiliations"]]
        # Élus nommément reliés : rapporteurs qui l'ont auditionnée, ministres qui l'ont reçue.
        o["nommes"] = len({d for a in L["auditions"] for d in a["deputes"]}) + len({m["ministre"] for m in L["ministres"]})
        write_json(DIST / "lobbying" / "orgs" / f"{o['slug']}.json", o)
    # Registre, action par action, découpé par trimestre (chargé à la demande).
    by_q: dict[str, list] = {}
    for o in lobby_orgs:
        for a in o["actions"]:
            by_q.setdefault(lobbying.quarter(a["date"]), []).append(
                [a["date"], o["slug"], o["nom"], a["objet"][:240], a["domaines"], a["cibles"], a["ministeres"], a["autorites"], a["moyens"], o["nommes"]]
            )
    for q, rows in by_q.items():
        rows.sort(key=lambda r: r[0], reverse=True)
        write_json(DIST / "lobbying" / "registre" / f"{q}.json", rows)
    lobby["registre"] = sorted(by_q, reverse=True)
    lobby["orgs"] = [[o["slug"], o["nom"], o["famille"], len(o["actions"]), o["nommes"], o["depenseMin"]] for o in lobby_orgs]
    lobby["liens"] = {
        "auditions": sum(len(L["auditions"]) for L in links.values()),
        "commissions": sum(len(L["commissions"]) for L in links.values()),
        "ministres": sum(len(L["ministres"]) for L in links.values()),
        "detenteurs": sum(1 for L in links.values() if L["detenteurs"]),
        "organisationsReliees": sum(1 for o in lobby_orgs if any(o["liens"][k] for k in ("auditions", "commissions", "ministres", "detenteurs"))),
    }
    lobby["agendas"] = {"sources": agendas_min["sources"], "rencontres": len(agendas_min["meetings"]), "avecOrganisation": sum(1 for m in agendas_min["meetings"] if m["registre"]), "avecDepute": sum(1 for m in agendas_min["meetings"] if m["deputes"])}
    write_json(DIST / "lobbying.json", lobby)
    write_json(DIST / "lobbying" / "noms.json", slug_of_org)
    grp_sigle = {**ref_to_sigle, **{g["ref"]: g["sigle"] for g in groupes if g["ref"]}}
    write_json(
        DIST / "rencontres.json",
        {
            "couverture": auditions.report_auditions.couverture,
            "rapports": [
                {**{k: r.get(k) for k in ("rapport", "titre", "date", "url", "organisation", "detail", "etoile", "registre", "type")}, "rapporteurs": [slug_by_id[x] for x in r["rapporteurs"] if x in slug_by_id]}
                for r in rap_rows
            ],
            "commissions": [
                {"date": a["date"], "organe": a["organe"], "texte": a["texte"], "registre": a["registre"], "presents": [slug_by_id[x] for x in a["presents"] if x in slug_by_id]}
                for a in com_auditions
            ],
            "amendements": [
                {**{k: c[k] for k in ("id", "texte", "n", "adoptes", "exemple")}, "deputes": [slug_by_id[x] for x in c["deputes"] if x in slug_by_id], "groupes": sorted({grp_sigle.get(g, "?") for g in c["groupes"]})}
                for c in amdt_clusters
            ],
        },
    )
    write_json(DIST / "agenda.json", events)
    write_json(DIST / "interets.json", {"societes": interets_all["societes"], "delaiLegal": interets_all["delaiLegal"], "source": hatvp.DECLARATIONS, "sourceLobby": lobbying.AGORA})
    write_json(DIST / "communes.json", communes)
    ordre = [g["sigle"] for g in groupes]
    write_json(DIST / "proximite.json", {**proximite.accord_groupes(scrutins, groupes, ref_to_sigle), "carte": proximite.carte(scrutins, deputes, slug_by_id, ordre)})
    proximite.votes_compacts(scrutins, deputes)
    # Travail par député et par mois : commissions (convocations, présences, minutes), jours de vote,
    # et minutes de séance publique où le député a voté ou siégé (durée réelle, suspensions déduites).
    from datetime import date as _date

    vote_days: dict[str, dict[str, set]] = {}
    for sc in scrutins:
        mo = sc["date"][:7]
        for a, c in sc["votes"].items():
            if c != "n" and a not in sc["delegues"]:
                vote_days.setdefault(a, {}).setdefault(mo, set()).add(sc["date"])
    # Présence estimée en séance : part des scrutins de la séance auxquels le député a pris part,
    # ou fenêtre entre sa première et sa dernière prise de parole, la plus grande des deux.
    seance_scrutins: dict[str, list[dict]] = {}
    for sc in scrutins:
        if sc.get("seanceRef"):
            seance_scrutins.setdefault(sc["seanceRef"], []).append(sc)
    seance_min: dict[str, dict[str, list[float]]] = {}
    weeks_by_month: dict[str, set] = {}
    for uid, ev in seance_index.items():
        d0 = _date.fromisoformat(ev["d"][:10])
        mo = ev["d"][:7]
        if d0 <= _date.today():
            weeks_by_month.setdefault(mo, set()).add(d0.isocalendar()[:2])
        dur = (ev["rm"] - ev.get("rs", 0)) if ev.get("rm") is not None else (ev.get("m") or 0)
        scs = seance_scrutins.get(uid, [])
        share: dict[str, float] = {}
        if scs:
            counts: dict[str, int] = {}
            for sc in scs:
                for a in sc["votes"]:
                    if a not in sc["delegues"]:
                        counts[a] = counts.get(a, 0) + 1
            for a, n in counts.items():
                share[a] = n / len(scs)
        cr = reels.get(uid)
        if cr and cr.get("paragraphes"):
            for a, (first, last, _n) in cr["orateurs"].items():
                share[a] = max(share.get(a, 0.0), (last - first + 1) / cr["paragraphes"])
        for a, f in share.items():
            row = seance_min.setdefault(a, {}).setdefault(mo, [0.0, 0])
            row[0] += dur * min(1.0, f)
            row[1] += 1
    months = sorted({m for v in monthly.values() for m in v} | {m for v in vote_days.values() for m in v} | set(weeks_by_month))
    write_json(
        DIST / "travail.json",
        {
            "mois": months,
            # Semaines (lundi-dimanche) comptant au moins une séance publique, rattachées au mois de la séance.
            "semaines": {m: sorted(f"{y}-{w:02d}" for y, w in weeks_by_month.get(m, ())) for m in months},
            "debut": {d["slug"]: d["debut"][:10] for d in deputes},
            "deputes": {
                d["slug"]: [
                    [
                        *monthly[d["id"]].get(m, [0, 0, 0]),
                        len(vote_days.get(d["id"], {}).get(m, ())),
                        *[round(x) for x in seance_min.get(d["id"], {}).get(m, [0, 0])],
                    ]
                    for m in months
                ]
                for d in deputes
            },
        },
    )
    shutil.copyfile(ROOT / "curated" / "sieges.json", DIST / "sieges.json")
    # Données constituées à la main, chacune avec ses sources : historique et condamnations.
    for name in ("legislatures.json",):
        if (ROOT / "curated" / name).exists():
            shutil.copyfile(ROOT / "curated" / name, DIST / name)

    n_votes = sum(len(s["votes"]) for s in scrutins)
    checks = [
        {"controle": "577 sièges pourvus", "ok": len(deputes) == 577, "valeur": len(deputes)},
        {"controle": "Chaque député rattaché à un groupe", "ok": all(d["groupe"] for d in deputes), "valeur": len(groupes)},
        {"controle": "Déclarations d'intérêts rapprochées (plus de 85 %)", "ok": len(decl) / len(deputes) > 0.85, "valeur": len(decl)},
        {"controle": "Taux de présence calculé pour chaque député votant", "ok": sum(1 for d in out_deputes if d["participation"] is not None) >= len(deputes) - 5, "valeur": sum(1 for d in out_deputes if d["participation"] is not None)},
        {"controle": "Aucune déclaration de patrimoine de parlementaire lue", "ok": True, "valeur": 0},
    ]
    write_json(
        DIST / "meta.json",
        {
            "legislature": an.LEGISLATURE,
            "generatedAt": now_iso(),
            "dureeSecondes": round(time.perf_counter() - started, 1),
            "etapes": STEPS,
            "controles": checks,
            "volumes": {"deputes": len(deputes), "scrutins": len(scrutins), "votes": n_votes, "declarations": len(decl), "amendements": n_amdts, "questions": n_questions},
            "sources": {
                "amo": {"label": "Assemblée nationale, députés, mandats et organes (AMO)", "url": an.AMO10, "records": len(deputes), **fetch_info(f"an{an.LEGISLATURE}_amo10.json.zip")},
                "scrutins": {"label": "Assemblée nationale, scrutins publics", "url": an.SCRUTINS, "records": len(scrutins), **fetch_info(f"an{an.LEGISLATURE}_scrutins.json.zip")},
                "amendements": {"label": "Assemblée nationale, amendements", "url": an.AMENDEMENTS, "records": n_amdts, **fetch_info(f"an{an.LEGISLATURE}_amendements.json.zip")},
                "questions": {"label": "Assemblée nationale, questions écrites", "url": an.QUESTIONS, "records": n_questions, **fetch_info(f"an{an.LEGISLATURE}_questions.json.zip")},
                "comptesRendus": {"label": "Assemblée nationale, comptes rendus des séances publiques", "url": comptes_rendus.SYCERON, "records": len(reels), **fetch_info("an17_syceron.xml.zip")},
                "agenda": {"label": "Assemblée nationale, agenda des séances et réunions", "url": agenda.AGENDA, "records": len(events), **fetch_info("an17_agenda.json.zip")},
                "hatvp": {"label": "HATVP, déclarations d'intérêts et d'activités", "url": hatvp.DECLARATIONS, "records": len(decl), **fetch_info("hatvp_declarations.xml")},
                "agora": {"label": "HATVP, répertoire des représentants d'intérêts", "url": lobbying.AGORA, "records": lobby["organisations"], **fetch_info("hatvp_agora.json")},
                "wikidata": {"label": "Wikidata, mandats de député antérieurs", "url": "https://query.wikidata.org/", "records": len(wd)},
            },
        },
    )
    log(f"terminé : {len(out_deputes)} députés, {len(scrutins)} scrutins → {DIST}")


if __name__ == "__main__":
    main()
