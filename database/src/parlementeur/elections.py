"""Élections législatives de 2024 : résultat de chaque député actuel dans sa circonscription (ministère de l'Intérieur)."""

from __future__ import annotations

import csv
import re

from .common import fetch, log, norm_name

T1 = "https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/20240710-171413/resultats-definitifs-par-circonscriptions-legislatives.csv"
T2 = "https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour/20240710-170728/resultats-definitifs-par-circonscription.csv"
DATASET = "https://www.data.gouv.fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour"
DEPT_MAP = {"ZX": "977", "ZZ": "99"}


def _dept(code: str) -> str:
    code = DEPT_MAP.get(code.strip(), code.strip())
    return code.lstrip("0") if code.isdigit() else code


def _pct(s: str) -> float | None:
    s = (s or "").replace("%", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _rows(path):
    with open(path, encoding="utf-8") as f:
        for row in csv.reader(f, delimiter=";"):
            yield row


def _parse(path, tour: int) -> dict[tuple[str, int], dict]:
    rows = _rows(path)
    header = next(rows)
    idx = {h: i for i, h in enumerate(header)}
    out = {}
    for r in rows:
        dept = _dept(r[idx["Code département"]])
        m = re.match(r"(\d+)", r[idx["Libellé circonscription législative"]])
        if not m:
            continue
        circo = int(m.group(1))
        cands = []
        k = 1
        while f"Nom candidat {k}" in idx:
            nom = r[idx[f"Nom candidat {k}"]]
            if nom:
                cands.append(
                    {
                        "nom": nom,
                        "prenom": r[idx[f"Prénom candidat {k}"]],
                        "nuance": r[idx[f"Nuance candidat {k}"]],
                        "voix": int(r[idx[f"Voix {k}"]] or 0),
                        "pct": _pct(r[idx[f"% Voix/exprimés {k}"]]),
                        "elu": r[idx[f"Elu {k}"]].strip().lower() in ("élu", "elu", "oui"),
                    }
                )
            k += 1
        out[(dept, circo)] = {"tour": tour, "participation": _pct(r[idx["% Votants"]]), "candidats": sorted(cands, key=lambda c: -c["voix"])}
    return out


def load(deputes: list[dict]) -> dict[str, dict]:
    t1 = _parse(fetch(T1, "leg2024_t1_circo.csv", max_age_h=24 * 30), 1)
    t2 = _parse(fetch(T2, "leg2024_t2_circo.csv", max_age_h=24 * 30), 2)
    out = {}
    for d in deputes:
        if not d.get("numDepartement") or not d.get("numCirco"):
            continue
        key = (_dept(d["numDepartement"]), int(d["numCirco"]))
        res = t2.get(key) if key in t2 and any(c["elu"] for c in t2[key]["candidats"]) else t1.get(key)
        if not res:
            continue
        elu = next((c for c in res["candidats"] if c["elu"]), None)
        a, b = norm_name(elu["nom"]) if elu else "", norm_name(d["nom"])
        if not elu or not (a == b or a.startswith(b) or b.startswith(a) or a[:6] == b[:6]):
            # Député entré en cours de législature (suppléant, élection partielle) : pas le résultat de 2024.
            continue
        adversaires = [c for c in res["candidats"] if c is not elu][:3]
        out[d["id"]] = {
            "annee": 2024,
            "tour": res["tour"],
            "pct": elu["pct"],
            "voix": elu["voix"],
            "nuance": elu["nuance"],
            "participation": res["participation"],
            "adversaires": [{"nom": f"{c['prenom']} {c['nom'].title()}", "nuance": c["nuance"], "pct": c["pct"]} for c in adversaires],
            "source": DATASET,
        }
    log(f"législatives 2024 : résultat retrouvé pour {len(out)} députés")
    return out
