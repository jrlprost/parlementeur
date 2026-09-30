"""Trouver son député : code postal → communes → circonscriptions législatives.

Les résultats officiels des législatives 2024 par bureau de vote donnent la commune de chaque bureau, pas sa
circonscription. Chaque circonscription a sa propre liste de candidats : on retrouve donc la circonscription
d'un bureau en comparant sa liste de candidats à celle des résultats par circonscription.
La base officielle des codes postaux (La Poste) relie ensuite chaque code postal à ses communes.
"""

from __future__ import annotations

import csv
import re

from .common import fetch, log, norm_name

BV = "https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/20240710-171445/resultats-definitifs-par-bureau-de-vote.csv"
CIRCO = "https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/20240710-171413/resultats-definitifs-par-circonscriptions-legislatives.csv"
LAPOSTE = "https://data.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/raw"
BV_DATASET = "https://www.data.gouv.fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour"
LAPOSTE_DATASET = "https://www.data.gouv.fr/datasets/base-officielle-des-codes-postaux"

# Paris, Lyon et Marseille votent par arrondissement : le code du bureau commence par le numéro d'arrondissement.
PLM = {"75056": 75100, "69123": 69380, "13055": 13200}


def _dep(code: str) -> str:
    return code.lstrip("0") or "0"


def _candidates(row: list[str], h: dict[str, int]) -> frozenset:
    out = set()
    i = 1
    while f"Nom candidat {i}" in h:
        nom = row[h[f"Nom candidat {i}"]].strip() if h[f"Nom candidat {i}"] < len(row) else ""
        if nom:
            out.add(norm_name(nom + row[h[f"Prénom candidat {i}"]]))
        i += 1
    return frozenset(out)


def load(deputes: list[dict]) -> dict:
    # Signature (liste des candidats) de chaque circonscription.
    sig: dict[tuple[str, frozenset], str] = {}
    with fetch(CIRCO, "leg2024_t1_circo.csv").open(encoding="utf-8") as f:
        r = csv.reader(f, delimiter=";")
        head = next(r)
        h = {k: i for i, k in enumerate(head)}
        for row in r:
            dep = _dep(row[h["Code département"]])
            code = row[h["Code circonscription législative"]]
            sig[(dep, _candidates(row, h))] = f"{dep}-{int(code[-2:])}"

    commune_circos: dict[str, dict[str, int]] = {}
    # Nom officiel (accentué) de chaque commune, d'après les résultats électoraux.
    official: dict[str, str] = {}
    unmatched = 0
    with fetch(BV, "leg2024_t1_bv.csv").open(encoding="utf-8") as f:
        r = csv.reader(f, delimiter=";")
        head = next(r)
        h = {k: i for i, k in enumerate(head)}
        for row in r:
            dep = _dep(row[h["Code département"]])
            key = sig.get((dep, _candidates(row, h)))
            if not key:
                unmatched += 1
                continue
            com = row[h["Code commune"]].zfill(5)
            bv = row[h["Code BV"]]
            if com in PLM and len(bv) >= 3:
                com = str(PLM[com] + int(bv[:-2]))
            if com not in official:
                name = row[h["Libellé commune"]]
                official[com] = f"{name} {int(bv[:-2])}{'er' if int(bv[:-2]) == 1 else 'e'}" if row[h["Code commune"]].zfill(5) in PLM and len(bv) >= 3 else name
            c = commune_circos.setdefault(com, {})
            c[key] = c.get(key, 0) + 1

    slug_by_circo = {}
    for d in deputes:
        if d.get("numDepartement") and d.get("numCirco"):
            slug_by_circo[f"{_dep(d['numDepartement'])}-{int(d['numCirco'])}"] = d["slug"]

    # Code postal → communes (nom, circonscriptions, de la plus représentée à la moins représentée).
    cp: dict[str, list] = {}
    names: dict[tuple[str, str], str] = {}
    raw = fetch(LAPOSTE, "laposte_cp.csv").read_bytes()
    text = raw.decode("utf-8") if raw[:3] == b"\xef\xbb\xbf" or _is_utf8(raw) else raw.decode("latin-1")
    for row in csv.reader(text.splitlines()[1:], delimiter=";"):
        if len(row) < 3:
            continue
        insee, nom, code = row[0].strip(), row[1].strip(), row[2].strip()
        circos = commune_circos.get(insee)
        if not circos:
            continue
        slugs = [slug_by_circo[k] for k, _ in sorted(circos.items(), key=lambda kv: -kv[1]) if k in slug_by_circo]
        if not slugs:
            continue
        # Ligne 5 : localité rattachée (« La Source » à Orléans) ; on garde le nom officiel de la commune.
        base = official.get(insee) or _nice(nom)
        sub = row[4].strip() if len(row) > 4 else ""
        label = f"{base} ({_nice(sub)})" if sub else base
        entry = [label, slugs]
        if entry not in cp.setdefault(code, []):
            cp[code].append(entry)
        names[(label, code)] = code
    log(f"circonscriptions : {len(commune_circos)} communes, {len(cp)} codes postaux, {unmatched} bureaux non rapprochés")
    return {"cp": cp, "communes": sorted([n, c] for (n, c) in names), "sources": [BV_DATASET, LAPOSTE_DATASET]}


def _is_utf8(b: bytes) -> bool:
    try:
        b.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


SMALL = {"de", "des", "du", "la", "le", "les", "et", "en", "sur", "sous", "aux", "au", "l", "d"}


def _nice(s: str) -> str:
    """« ST DENIS EN VAL » → « St Denis en Val » (La Poste publie en capitales sans accents)."""
    words = re.split(r"(\s+)", s.lower())
    out = []
    for i, w in enumerate(words):
        out.append(w if (i > 0 and w in SMALL) else w[:1].upper() + w[1:])
    return "".join(out)
