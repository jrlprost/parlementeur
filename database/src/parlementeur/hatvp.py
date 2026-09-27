"""HATVP : déclarations d'intérêts et d'activités des députés.

Les déclarations de patrimoine des parlementaires (types DSP) ne sont jamais lues ni publiées :
l'article 26 (III) de la loi n° 2013-907 du 11 octobre 2013 interdit de les divulguer.
"""

from __future__ import annotations

import csv
import re
from datetime import datetime

from lxml import etree

from .common import fetch, log

LISTE = "https://www.hatvp.fr/livraison/opendata/liste.csv"
DECLARATIONS = "https://www.hatvp.fr/livraison/merge/declarations.xml"
INTEREST_TYPES = {"DI", "DIA", "DIM", "DIAM"}
INTEREST_DOCS = {"di", "dia", "dim", "diam"}


def _amount(s: str | None) -> float | None:
    if not s:
        return None
    digits = re.sub(r"[^\d,.]", "", s).replace(",", ".")
    if not digits:
        return None
    try:
        # Les montants sont saisis librement ("12 000", "12000.50", "12.000") : on garde la partie entière.
        if digits.count(".") > 1:
            digits = digits.replace(".", "")
        return float(digits)
    except ValueError:
        return None


def _montants(item) -> list[dict]:
    out = []
    for m in item.iterfind("remuneration/montant/montant"):
        y, v = m.findtext("annee"), _amount(m.findtext("montant"))
        if y and y.isdigit() and v is not None:
            out.append({"annee": int(y), "montant": v})
    return out


def _kept(item) -> bool:
    """Activité conservée pendant le mandat : champ explicite, sinon activité sans date de fin."""
    c = item.findtext("conservee")
    if c is not None:
        return c.strip() == "true"
    return not (item.findtext("dateFin") or "").strip()


def _txt(el, path) -> str | None:
    t = el.findtext(path)
    t = (t or "").strip()
    return t or None


def load_index():
    """Index des déclarations publiées, par identifiant AN (id_origine)."""
    p = fetch(LISTE, "hatvp_liste.csv")
    by_an: dict[str, list[dict]] = {}
    with p.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=";"):
            if row["type_mandat"] != "depute" or row["type_document"] not in INTEREST_DOCS:
                continue
            if row["id_origine"]:
                by_an.setdefault(f"PA{row['id_origine']}", []).append(row)
    return by_an


def load_declarations(deputes: list[dict]) -> dict[str, dict]:
    """Dernière déclaration d'intérêts de chaque député, rapprochée par nom, prénom et date de naissance."""
    p = fetch(DECLARATIONS, "hatvp_declarations.xml")
    index = load_index()
    key = {}
    for d in deputes:
        if d["naissance"]:
            b = d["naissance"][:10]
            key[(_norm(d["nom"]), b)] = d["id"]
            key[(_norm(d["prenom"] + d["nom"]), b)] = d["id"]

    best: dict[str, tuple[datetime, dict]] = {}
    for _, el in etree.iterparse(str(p), tag="declaration", huge_tree=True):
        g = el.find("general")
        typ = g.findtext("typeDeclaration/id") if g is not None else None
        if typ not in INTEREST_TYPES or g.findtext("qualiteMandat/codTypeMandatFichier") != "depute":
            el.clear()
            continue
        nom, prenom = g.findtext("declarant/nom") or "", g.findtext("declarant/prenom") or ""
        naiss = g.findtext("declarant/dateNaissance") or ""
        try:
            b = datetime.strptime(naiss.strip(), "%d/%m/%Y").date().isoformat()
        except ValueError:
            el.clear()
            continue
        an_id = key.get((_norm(nom), b)) or key.get((_norm(prenom + nom), b))
        if not an_id:
            el.clear()
            continue
        try:
            depot = datetime.strptime((el.findtext("dateDepot") or "").strip(), "%d/%m/%Y %H:%M:%S")
        except ValueError:
            el.clear()
            continue
        if an_id in best and best[an_id][0] >= depot:
            el.clear()
            continue
        best[an_id] = (depot, _parse(el, depot))
        el.clear()

    out = {}
    for an_id, (depot, dec) in best.items():
        rows = sorted(index.get(an_id, []), key=lambda r: r["date_depot"], reverse=True)
        match = next((r for r in rows if r["date_depot"] == depot.date().isoformat()), rows[0] if rows else None)
        dec["url"] = f"https://www.hatvp.fr/livraison/dossiers/{match['nom_fichier'].replace('.xml', '.pdf')}" if match and match["nom_fichier"] else "https://www.hatvp.fr/consulter-les-declarations/"
        dec["urlDossier"] = f"https://www.hatvp.fr{match['url_dossier']}" if match else None
        out[an_id] = dec
    log(f"HATVP : {len(out)} déclarations d'intérêts rapprochées sur {len(deputes)} députés")
    return out


def _norm(s: str) -> str:
    from .common import norm_name

    return norm_name(s)


def _parse(el, depot: datetime) -> dict:
    activites, dirigeant, mandats, participations = [], [], [], []
    for it in el.iterfind("activProfCinqDerniereDto/items/items"):
        activites.append({"description": _txt(it, "description") or "Activité professionnelle", "employeur": _txt(it, "employeur"), "montants": _montants(it), "conservee": _kept(it)})
    for it in el.iterfind("activConsultantDto/items/items"):
        activites.append({"description": "Conseil : " + (_txt(it, "description") or "activité de consultant"), "employeur": _txt(it, "nomEmployeur"), "montants": _montants(it), "conservee": _kept(it)})
    for it in el.iterfind("participationDirigeantDto/items/items"):
        dirigeant.append({"description": f"Direction : {_txt(it, 'nomSociete') or 'organisme'}" + (f" ({_txt(it, 'activite')})" if _txt(it, "activite") else ""), "employeur": None, "montants": _montants(it), "conservee": _kept(it)})
    for it in el.iterfind("mandatElectifDto/items/items"):
        desc = _txt(it, "descriptionMandat") or "Mandat électif"
        mandats.append({"description": desc, "montants": _montants(it), "conservee": _kept(it)})
    for it in el.iterfind("participationFinanciereDto/items/items"):
        participations.append({"societe": _txt(it, "nomSociete") or "Société", "evaluation": _amount(it.findtext("evaluation")), "parts": (f"{_txt(it, 'nombreParts')} parts" if _txt(it, "nombreParts") else None)})
    conjoint = [
        " · ".join(x for x in [_txt(it, "activiteProf"), _txt(it, "employeurConjoint")] if x)
        for it in el.iterfind("activProfConjointDto/items/items")
    ]

    # Revenus annexes : activités conservées pendant le mandat et autres mandats électifs, année la plus récente.
    kept = [a for a in activites + dirigeant if a["conservee"]] + [m for m in mandats if m["conservee"] and "député" not in m["description"].lower()]
    years = [m["annee"] for a in kept for m in a["montants"]]
    revenus = None
    annee = None
    if years:
        annee = max(years)
        revenus = sum(m["montant"] for a in kept for m in a["montants"] if m["annee"] == annee)
    elif activites or dirigeant or mandats:
        revenus = 0.0

    return {
        "date": depot.date().isoformat(),
        "activites": [{k: a[k] for k in ("description", "employeur", "montants")} for a in activites + dirigeant],
        "mandatsElectifs": [{k: m[k] for k in ("description", "montants")} for m in mandats],
        "participations": participations,
        "conjoint": "; ".join(c for c in conjoint if c) or None,
        "revenusAnnexes": revenus,
        "anneeRevenus": annee,
    }
