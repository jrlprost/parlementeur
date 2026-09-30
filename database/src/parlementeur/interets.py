"""Intérêts déclarés, vus de haut : participations financières, fonctions de direction, délais de dépôt,
et sociétés détenues qui mènent aussi des actions de lobbying auprès des parlementaires.

Tout vient des déclarations d'intérêts et d'activités (publiques) et du répertoire des représentants d'intérêts.
Les déclarations de patrimoine ne sont ni lues ni publiées, pas même leur date de dépôt.
"""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date

from .common import RAW, log

HIDDEN = re.compile(r"\[\s*DONN[ÉE]ES NON PUBLI[ÉE]ES\s*\]", re.I)
LEGAL = r"\b(sa|sas|sasu|sarl|eurl|se|sca|snc|groupe|group|holding|nv|plc|inc|ag|the)\b"
# Formes de détention dont la HATVP masque le nom (patrimoine familial, pas d'entreprise identifiable).
PRIVATE = {"societe", "société", "sci", "gfa", "scea", "pea", "gaec", "groupement forestier", "earl", "sarl", "sas", "sc", "gfr", "scpi", "cto", "assurance vie", "compte titres"}
DELAI_LEGAL = 61  # deux mois après l'entrée en fonctions (article LO 135-1 du code électoral)


def _key(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(LEGAL, " ", s)
    k = re.sub(r"\s+", "", s)
    return ALIAS.get(k, k)


# Même société, noms différents selon les déclarations.
ALIAS = {"totalenergie": "totalenergies", "total": "totalenergies", "adp": "aeroportsdeparis", "groupeadp": "aeroportsdeparis", "fdj": "lafrancaisedesjeux",
         "hermesintl": "hermes", "hermesinternational": "hermes", "airfranceklm": "airfranceklm", "airfrance": "airfranceklm", "loreal": "loreal"}


def clean_societe(raw: str) -> tuple[str, bool]:
    """Nom lisible d'une société déclarée, et s'il s'agit d'une entreprise identifiable."""
    s = re.sub(r"\s+", " ", HIDDEN.sub("", raw or "")).strip(" -–,;")
    if not s or s.lower() in PRIVATE:
        return (f"{s} (nom non publié)" if s else "Nom non publié par la HATVP"), False
    return s, True


# Graphie officielle des sociétés les plus citées (les déclarations sont saisies librement).
GRAPHIE = {
    "totalenergies": "TotalEnergies", "loreal": "L'Oréal", "aeroportsdeparis": "Aéroports de Paris", "creditagricole": "Crédit Agricole",
    "airfranceklm": "Air France-KLM", "lafrancaisedesjeux": "La Française des jeux", "veoliaenvironnement": "Veolia Environnement",
    "dassaultsystemes": "Dassault Systèmes", "biomerieux": "bioMérieux", "ovh": "OVHcloud", "open": "Open", "stmicroelectronics": "STMicroelectronics",
    "lvmh": "LVMH", "saintgobain": "Saint-Gobain", "hermes": "Hermès", "essilorluxottica": "EssilorLuxottica", "elis": "Elis", "bnpparibas": "BNP Paribas", "societegenerale": "Société Générale", "creditmutuel": "Crédit Mutuel", "schneiderelectric": "Schneider Electric",
}
SMALL_WORDS = {"de", "des", "du", "la", "le", "les", "et", "en"}


def _nice(s: str, key: str = "") -> str:
    if key in GRAPHIE:
        return GRAPHIE[key]
    if s == s.upper() and len(s) <= 4:
        return s
    if s == s.upper() or s[:1].islower():
        words = s.lower().split()
        return " ".join(w if (i and w in SMALL_WORDS) else (w.upper() if len(w) <= 3 and w.isalpha() and w not in SMALL_WORDS and s == s.upper() else w[:1].upper() + w[1:]) for i, w in enumerate(words))
    return s


def agora_index() -> dict[str, dict]:
    """Organisations du répertoire ayant visé des parlementaires depuis 2024, par nom normalisé."""
    from .lobbying import DEPUIS, _date

    data = json.loads((RAW / "hatvp_agora.json").read_text("utf-8"))
    out = {}
    for pub in data["publications"]:
        n = 0
        dom: Counter = Counter()
        objets = []
        for ex in pub.get("exercices") or []:
            pc = ex.get("publicationCourante") or {}
            debut = _date(pc.get("dateDebut"))
            if not debut or (_date(pc.get("dateFin")) or debut) < DEPUIS:
                continue
            for act in pc.get("activites") or []:
                a = act.get("publicationCourante") or {}
                acts = a.get("actionsRepresentationInteret") or []
                if not any("Député" in r for x in acts for r in (x.get("reponsablesPublics") or [])):
                    continue
                n += 1
                dom.update(a.get("domainesIntervention") or [])
                if a.get("objet") and len(objets) < 5:
                    objets.append(a["objet"].strip()[:220])
        if not n:
            continue
        k = _key(pub.get("denomination") or "")
        if len(k) >= 3:
            out[k] = {
                "nom": pub["denomination"],
                "actions": n,
                "domaines": [d for d, _ in dom.most_common(4)],
                "objets": objets,
                "fiche": f"https://www.hatvp.fr/fiche-organisation/?organisation={pub.get('identifiantNational')}",
            }
    return out


def delais(deputes: list[dict]) -> dict[str, dict]:
    """Date de la première déclaration d'intérêts déposée pour le mandat en cours, et nombre de modifications."""
    by_an: dict[str, list[dict]] = defaultdict(list)
    with (RAW / "hatvp_liste.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=";"):
            if row["type_mandat"] == "depute" and row["type_document"] in ("dia", "diam") and row["id_origine"]:
                by_an[f"PA{row['id_origine']}"].append(row)
    out = {}
    for d in deputes:
        start = d["debut"][:10]
        rows = [r for r in by_an.get(d["id"], []) if r["date_depot"] >= start]
        first = min((r["date_depot"] for r in rows if r["type_document"] == "dia"), default=None)
        out[d["id"]] = {
            "depot": first,
            "delai": (date.fromisoformat(first) - date.fromisoformat(start)).days if first else None,
            "modifications": sum(1 for r in rows if r["type_document"] == "diam"),
        }
    return out


def load(deputes: list[dict], decl: dict[str, dict], slug_by_id: dict[str, str]) -> dict:
    agora = agora_index()
    societes: dict[str, dict] = {}
    per_dep: dict[str, dict] = {}
    for d in deputes:
        dec = decl.get(d["id"])
        if not dec:
            continue
        total, n, lobby = 0.0, 0, []
        for p in dec["participations"]:
            nom, ident = clean_societe(p["societe"])
            p["societe"] = nom
            p["identifiable"] = ident
            n += 1
            total += p["evaluation"] or 0
            if not ident:
                continue
            k = _key(nom)
            if len(k) < 3:
                continue
            s = societes.setdefault(k, {"noms": Counter(), "deputes": {}, "total": 0.0})
            s["noms"][nom] += 1
            p["societe"] = _nice(nom, k)
            s["deputes"][slug_by_id[d["id"]]] = (s["deputes"].get(slug_by_id[d["id"]], 0) or 0) + (p["evaluation"] or 0)
            s["total"] += p["evaluation"] or 0
            if k in agora:
                p["lobby"] = {k2: agora[k][k2] for k2 in ("nom", "actions", "domaines", "fiche")}
                lobby.append(k)
        per_dep[d["id"]] = {"total": round(total), "n": n, "lobby": sorted(set(lobby)), "directions": dec.get("directions", 0)}

    out_soc = []
    for k, s in societes.items():
        out_soc.append(
            {
                "nom": _nice(s["noms"].most_common(1)[0][0], k),
                "deputes": sorted(s["deputes"], key=lambda x: -s["deputes"][x]),
                "total": round(s["total"]),
                "lobby": {k2: agora[k][k2] for k2 in ("nom", "actions", "domaines", "objets", "fiche")} if k in agora else None,
            }
        )
    out_soc.sort(key=lambda s: (-len(s["deputes"]), -s["total"]))
    log(f"intérêts : {len(out_soc)} sociétés identifiables détenues, dont {sum(1 for s in out_soc if s['lobby'])} inscrites au répertoire des lobbies")
    return {"deputes": per_dep, "societes": out_soc, "delaiLegal": DELAI_LEGAL}
