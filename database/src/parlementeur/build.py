"""Point d'entrée : collecte toutes les sources et écrit les fichiers publiés dans dist/."""

from __future__ import annotations

import concurrent.futures as cf
import shutil

import duckdb
import httpx

from . import an, hatvp, wikidata
from .common import DIST, RAW, USER_AGENT, fetch, log, now_iso, write_json

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
        "{'numero':'INTEGER','acteur':'VARCHAR','code':'VARCHAR','groupe':'VARCHAR'}",
        ((s["numero"], a, c, s["voterGroup"].get(a)) for s in scrutins for a, c in s["votes"].items()),
    )
    rows = con.execute(
        """
        WITH eligible AS (
          SELECT d.id, s.numero, s.solennel FROM dep d JOIN scr s ON s.date >= d.debut
        ),
        joined AS (
          SELECT e.id, e.numero, e.solennel, v.code, p.position
          FROM eligible e
          LEFT JOIN vote v ON v.numero = e.numero AND v.acteur = e.id
          LEFT JOIN pos p ON p.numero = e.numero AND p.groupe = v.groupe
        )
        SELECT id,
          count(*) FILTER (WHERE code IS DISTINCT FROM 'n') AS eligibles,
          count(*) FILTER (WHERE code IN ('p','c','a')) AS votes,
          count(*) FILTER (WHERE solennel AND code IS DISTINCT FROM 'n') AS eligibles_sol,
          count(*) FILTER (WHERE solennel AND code IN ('p','c','a')) AS votes_sol,
          count(*) FILTER (WHERE code IN ('p','c','a') AND position IN ('pour','contre','abstention')) AS avec_ligne,
          count(*) FILTER (WHERE code IN ('p','c','a') AND position IN ('pour','contre','abstention')
            AND ((code='p' AND position='pour') OR (code='c' AND position='contre') OR (code='a' AND position='abstention'))) AS alignes
        FROM joined GROUP BY id
        """
    ).fetchall()
    out = {}
    for id_, elig, votes, elig_sol, votes_sol, avec, alignes in rows:
        out[id_] = {
            "participation": round(votes / elig, 4) if elig else None,
            "participationSolennels": round(votes_sol / elig_sol, 4) if elig_sol else None,
            "votes": votes,
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


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    deputes, groupes, organes = an.load_amo()
    ids = {d["id"] for d in deputes}
    history, gp_hist = an.load_mandate_history(ids)
    scrutins = an.load_scrutins()
    metrics = vote_metrics(deputes, scrutins)
    wd = wikidata.legislatures(sorted(ids))
    decl = hatvp.load_declarations(deputes)
    download_photos(deputes)

    ref_to_sigle = {g["ref"]: g["sigle"] for g in groupes if g["ref"]}
    for uid, o in organes.items():
        if o.get("codeType") == "GP" and uid not in ref_to_sigle:
            ref_to_sigle[uid] = an.DISPLAY_SIGLE.get(o["libelleAbrev"], o["libelleAbrev"])
    names = {uid: o["libelle"] for uid, o in organes.items() if o.get("codeType") == "GP"}

    # Scrutins marquants : votes solennels et motions de censure.
    marquants = [s for s in scrutins if s["solennel"] or s["motion"]]

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
            # La présidence de l'Assemblée ne prend pas part aux votes : aucun taux n'a de sens.
            "participation": None if d["preside"] else m.get("participation"),
            "participationSolennels": None if d["preside"] else m.get("participationSolennels"),
            "loyaute": m.get("loyaute"),
            "votes": m.get("votes"),
            "revenusAnnexes": dec["revenusAnnexes"] if dec else None,
            "anneeRevenus": dec["anneeRevenus"] if dec else None,
            "urlAN": d["urlAN"],
            "urlHATVP": dec["urlDossier"] if dec else None,
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
                for h in gp_hist.get(d["id"], [])
            ],
            "interets": {k: dec[k] for k in ("date", "url", "activites", "participations", "mandatsElectifs", "conjoint")} if dec else None,
            "votesCles": votes_cles[:40],
            "dissidences": m.get("dissidences"),
            "amendements": None,
            "questions": None,
            "condamnations": [],
            "presidentielles": [],
            "elections": [],
            "sources": [],
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

    write_json(
        DIST / "meta.json",
        {
            "legislature": an.LEGISLATURE,
            "generatedAt": now_iso(),
            "sources": {
                "amo": {"label": "Assemblée nationale, députés, mandats et organes (AMO)", "url": an.AMO10, "records": len(deputes)},
                "scrutins": {"label": "Assemblée nationale, scrutins publics", "url": an.SCRUTINS, "records": len(scrutins)},
                "hatvp": {"label": "HATVP, déclarations d'intérêts et d'activités", "url": hatvp.DECLARATIONS, "records": len(decl)},
                "wikidata": {"label": "Wikidata, mandats de député antérieurs", "url": wikidata.ENDPOINT, "records": len(wd)},
            },
        },
    )
    log(f"terminé : {len(out_deputes)} députés, {len(scrutins)} scrutins → {DIST}")


if __name__ == "__main__":
    main()
