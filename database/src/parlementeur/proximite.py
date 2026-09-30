"""Qui vote avec qui : accord entre groupes, carte des votes des députés, et votes de chaque député
dans un format compact pour le comparateur.
"""

from __future__ import annotations

import numpy as np

from .common import DIST, log, write_json

CODE = {"p": 1.0, "c": -1.0, "a": 0.0}


def accord_groupes(scrutins: list[dict], groupes: list[dict], ref_to_sigle: dict[str, str]) -> dict:
    """Part des scrutins où deux groupes ont pris la même position majoritaire (pour, contre ou abstention)."""
    sigles = [g["sigle"] for g in groupes if g["ref"]]
    idx = {s: i for i, s in enumerate(sigles)}
    same = np.zeros((len(sigles), len(sigles)))
    both = np.zeros((len(sigles), len(sigles)))
    for sc in scrutins:
        if sc["motion"]:
            continue
        pos = {}
        for g in sc["groupes"]:
            s = ref_to_sigle.get(g["ref"])
            if s in idx and g["position"] in ("pour", "contre", "abstention"):
                pos[idx[s]] = g["position"]
        for i, a in pos.items():
            for j, b in pos.items():
                both[i, j] += 1
                same[i, j] += a == b
    rate = np.divide(same, both, out=np.zeros_like(same), where=both > 0)
    return {"groupes": sigles, "accord": [[round(float(x), 3) for x in row] for row in rate], "scrutins": [[int(x) for x in row] for row in both]}


def carte(scrutins: list[dict], deputes: list[dict], slug_by_id: dict[str, str], group_order: list[str]) -> dict:
    """Analyse en composantes principales des votes : deux députés proches sur la carte votent souvent pareil."""
    cols = [sc for sc in scrutins if not sc["motion"] and sc["votants"] >= 30]
    ids = [d["id"] for d in deputes]
    row = {a: i for i, a in enumerate(ids)}
    M = np.full((len(ids), len(cols)), np.nan)
    for j, sc in enumerate(cols):
        for a, c in sc["votes"].items():
            if a in row and c in CODE:
                M[row[a], j] = CODE[c]
    counts = (~np.isnan(M)).sum(axis=1)
    keep = counts >= 150
    X = M[keep]
    mean = np.nanmean(X, axis=0)
    X = np.where(np.isnan(X), 0.0, X - np.nan_to_num(mean))
    # Chaque député pèse autant, quel que soit son nombre de votes.
    X = X / np.sqrt(np.maximum(counts[keep], 1))[:, None] * np.sqrt(len(cols))
    U, S, _ = np.linalg.svd(X, full_matrices=False)
    P = U[:, :2] * S[:2]
    var = (S**2) / (S**2).sum()
    kept_ids = [a for a, k in zip(ids, keep) if k]
    grp = {d["id"]: d["groupe"] for d in deputes}
    # Orientation stable d'une exécution à l'autre : le premier groupe de l'ordre gauche → droite à gauche.
    first = [i for i, a in enumerate(kept_ids) if grp[a] == group_order[0]]
    if first and P[first, 0].mean() > 0:
        P[:, 0] *= -1
    last = [i for i, a in enumerate(kept_ids) if grp[a] == group_order[-1]]
    if last and P[last, 1].mean() < 0:
        P[:, 1] *= -1
    m = np.abs(P).max(axis=0)
    P = P / np.where(m > 0, m, 1)
    log(f"carte des votes : {len(kept_ids)} députés, {len(cols)} scrutins, axes {var[0]:.0%} et {var[1]:.0%} de la variance")
    return {
        "points": {slug_by_id[a]: [round(float(P[i, 0]), 4), round(float(P[i, 1]), 4)] for i, a in enumerate(kept_ids)},
        "variance": [round(float(var[0]), 3), round(float(var[1]), 3)],
        "scrutins": len(cols),
        "seuil": 150,
    }


def votes_compacts(scrutins: list[dict], deputes: list[dict]) -> None:
    """Une ligne de caractères par député, un caractère par scrutin (dans l'ordre des numéros).

    p pour, c contre, a abstention, n non-votant ; majuscule quand le vote a été confié à un collègue ;
    « - » absent ; « _ » scrutin antérieur au début du mandat.
    """
    ordered = sorted(scrutins, key=lambda s: s["numero"])
    (DIST / "votes").mkdir(parents=True, exist_ok=True)
    write_json(DIST / "votes" / "index.json", [s["numero"] for s in ordered])
    for d in deputes:
        start = d["debut"][:10]
        chars = []
        for s in ordered:
            c = s["votes"].get(d["id"])
            if c:
                chars.append(c.upper() if d["id"] in s["delegues"] else c)
            else:
                chars.append("_" if s["date"] < start else "-")
        (DIST / "votes" / f"{d['slug']}.txt").write_text("".join(chars))
