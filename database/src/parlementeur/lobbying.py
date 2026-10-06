"""Répertoire des représentants d'intérêts (HATVP, AGORA) : qui cherche à influencer les décideurs publics.

Le répertoire ne nomme jamais les responsables rencontrés : il indique leur catégorie (parlementaire,
membre de cabinet ministériel et son ministère, collaborateur de l'Élysée, administration, autorité
indépendante…). On retient toutes les actions publiées depuis le début de la législature.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime

from .common import fetch, log, slugify

AGORA = "https://www.hatvp.fr/agora/opendata/agora_repertoire_opendata.json"
DEPUIS = "2024-07-01"

# Institutions visées, dans l'ordre d'affichage.
INSTITUTIONS = {
    "parlement": "Parlement",
    "gouvernement": "Gouvernement",
    "elysee": "Élysée",
    "hauts": "Hauts fonctionnaires",
    "administration": "Administrations",
    "autorites": "Autorités indépendantes",
    "local": "Collectivités",
}

# Libellés des ministères dans le répertoire (liste fixe), avec un nom court lisible.
MINISTERES = {
    "Premier ministre": "Matignon",
    "Economie et finances": "Économie",
    "Environnement, énergie et mer": "Écologie, énergie",
    "Affaires sociales et santé": "Santé, social",
    "Agriculture, agroalimentaire et forêt": "Agriculture",
    "Logement": "Logement",
    "Culture et communication": "Culture",
    "Affaires étrangères et développement international": "Affaires étrangères",
    "Education nationale, enseignement supérieur et recherche": "Éducation, recherche",
    "Intérieur": "Intérieur",
    "Justice": "Justice",
    "Aménagement du territoire, ruralité et collectivités territoriales": "Territoires",
    "Ville, jeunesse et sport": "Ville, jeunesse, sport",
    "Fonction publique": "Fonction publique",
    "Outre-mer": "Outre-mer",
    "Défense": "Armées",
    "Famille, enfance et droits des femmes": "Famille, droits des femmes",
    "Travail, emploi, formation professionnelle et dialogue social": "Travail",
    "Autres : à préciser": "Autre ministère",
}

MOYENS = {
    "Transmettre aux décideurs publics des informations, expertises dans un objectif de conviction": "Informations, expertises",
    "Organiser des discussions informelles ou des réunions en tête-à-tête": "Rendez-vous",
    "Transmettre des suggestions afin d'influencer la rédaction d'une décision publique": "Propositions de rédaction",
    "Etablir une correspondance régulière (par courriel, par courrier…)": "Courriels, courriers",
    "Inviter ou organiser des évènements, des rencontres ou des activités promotionnelles": "Événements",
    "Convenir pour un tiers d'une entrevue avec le titulaire d'une charge publique": "Rendez-vous pour un tiers",
    "Organiser des auditions, des consultations formelles sur des actes législatifs ou d'autres consultations ouvertes": "Consultations formelles",
    "Envoyer des pétitions, lettres ouvertes, tracts": "Pétitions, lettres ouvertes",
}

DECISIONS = {
    "Lois, y compris constitutionnelles": "Lois",
    "Actes réglementaires": "Décrets, arrêtés",
    "Autres décisions publiques": "Autres décisions",
    "Décisions d'espèce": "Décisions individuelles",
    "Ordonnances de l'article 38 de la Constitution": "Ordonnances",
    "Marchés publics d'une valeur supérieure aux seuils européens": "Marchés publics",
}

# Familles d'organisations, à partir de la catégorie déclarée.
FAMILLES = {
    "entreprises": "Entreprises",
    "federations": "Fédérations, syndicats",
    "associations": "Associations, ONG",
    "cabinets": "Cabinets, consultants",
    "autres": "Autres",
}


def famille(label: str) -> str:
    l = label.lower()
    # « Société commerciale et civile (autre que cabinet…) » est une entreprise : on lit le début du libellé.
    if l.startswith(("société", "établissement public", "etablissement public", "coopérative")):
        return "entreprises"
    if l.startswith(("cabinet", "consultant", "avocat", "travailleur indépendant")):
        return "cabinets"
    if "syndica" in l or "fédération" in l or "professionnelle" in l or "consulaire" in l:
        return "federations"
    if "association" in l or "fondation" in l or "réflexion" in l or "recherche" in l:
        return "associations"
    return "autres"


def _date(s: str | None) -> str | None:
    if not s:
        return None
    for fmt in ("%d-%m-%Y", "%d/%m/%Y à %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _bracket_low(label: str | None) -> int:
    """Borne basse d'une tranche de dépenses déclarée ("≥ 100 000 euros et < 200 000 euros" → 100000)."""
    if not label:
        return 0
    nums = [int(x.replace(" ", "").replace(" ", "")) for x in re.findall(r"\d[\d  ]*", label)]
    if not nums:
        return 0
    return 0 if label.strip().startswith("<") else min(nums)


def _ministeres(s: str) -> list[str]:
    """« Premier ministre, Economie et finances » → ["Matignon", "Économie"] (les libellés contiennent des virgules)."""
    out, rest = [], s.strip()
    while rest:
        hit = next((k for k in sorted(MINISTERES, key=len, reverse=True) if rest.startswith(k)), None)
        if hit:
            out.append(MINISTERES[hit])
            rest = rest[len(hit):].lstrip(", ")
        else:
            part, _, rest = rest.partition(", ")
            out.append(part)
    return out


def cibles(responsables: list[str]) -> tuple[set[str], list[str], list[str]]:
    """Institutions, ministères et autorités visés par une action."""
    inst, mins, aut = set(), [], []
    for r in responsables:
        head, _, tail = r.partition(" - ")
        h = head.lower()
        if h.startswith("député"):
            inst.add("parlement")
        elif h.startswith("membre du gouvernement"):
            inst.add("gouvernement")
            mins += _ministeres(tail)
        elif "président de la république" in h:
            inst.add("elysee")
        elif h.startswith("titulaire d'un emploi"):
            inst.add("hauts")
        elif "autorité administrative" in h or "autorité publique" in h:
            inst.add("autorites")
            if tail:
                aut.append(tail.strip())
        elif "collectivité" in h:
            inst.add("local")
        else:
            inst.add("administration")
    return inst, list(dict.fromkeys(mins)), list(dict.fromkeys(aut))


def quarter(d: str) -> str:
    return f"{d[:4]}-T{(int(d[5:7]) - 1) // 3 + 1}"


def load() -> dict:
    p = fetch(AGORA, "hatvp_agora.json", max_age_h=20)
    data = json.loads(p.read_text("utf-8"))
    orgs: list[dict] = []
    slugs: Counter = Counter()
    beneficiaires: Counter = Counter()
    via: dict[str, set] = defaultdict(set)

    for pub in data["publications"]:
        actions = []
        exercices = []
        for ex in pub.get("exercices") or []:
            pc = ex.get("publicationCourante") or {}
            debut = _date(pc.get("dateDebut"))
            fin = _date(pc.get("dateFin")) or debut
            if not debut or fin < DEPUIS:
                continue
            exercices.append(
                {"debut": debut, "fin": fin, "depense": (pc.get("montantDepense") or "").replace("> = ", "≥ ").replace(" euros", " €") or None, "depenseMin": _bracket_low(pc.get("montantDepense")), "salaries": pc.get("nombreSalaries"), "activites": pc.get("nombreActivite") or 0}
            )
            for act in pc.get("activites") or []:
                a = act.get("publicationCourante") or {}
                ars = a.get("actionsRepresentationInteret") or []
                if not ars:
                    continue
                inst, mins, aut = cibles([r for x in ars for r in (x.get("reponsablesPublics") or [])])
                date = _date((a.get("publicationDate") or "").split(" à ")[0]) or debut
                if date < DEPUIS:
                    continue
                tiers = sorted({re.sub(r"\s*\(en propre\)\s*$", "", t).strip() for x in ars for t in (x.get("tiers") or [])})
                for t in tiers:
                    beneficiaires[t] += 1
                    if t != pub["denomination"]:
                        via[t].add(pub["denomination"])
                actions.append(
                    {
                        "date": date,
                        "objet": (a.get("objet") or "").strip(),
                        "domaines": a.get("domainesIntervention") or [],
                        "cibles": sorted(inst, key=list(INSTITUTIONS).index),
                        "ministeres": mins,
                        "autorites": aut,
                        "moyens": list(dict.fromkeys(MOYENS.get(m, m) for x in ars for m in (x.get("actionsMenees") or []))),
                        "decisions": list(dict.fromkeys(DECISIONS.get(m, m) for x in ars for m in (x.get("decisionsConcernees") or []))),
                        "tiers": [t for t in tiers if t != pub["denomination"]][:6],
                        "fiche": a.get("identifiantFiche"),
                    }
                )
        if not actions:
            continue
        cat = (pub.get("categorieOrganisation") or {}).get("label") or "Autre organisation"
        usage = (pub.get("nomUsage") or "").strip()
        # « FNSEA - Fédération nationale… » : le sigle sert de nom, la forme longue de sous-titre.
        nom, _, nom_long = (usage or pub["denomination"]).partition(" - ")
        nom, nom_long = nom.strip(), nom_long.strip() or None
        base = slugify(nom)[:60].strip("-") or slugify(pub["denomination"])[:60]
        slugs[base] += 1
        actions.sort(key=lambda x: x["date"], reverse=True)
        exercices.sort(key=lambda x: x["debut"])
        last = next((e for e in reversed(exercices) if e["depense"]), exercices[-1] if exercices else {})
        orgs.append(
            {
                "slug": base,
                "nom": nom,
                "nomLong": nom_long,
                "denomination": pub["denomination"],
                "siren": pub.get("identifiantNational"),
                "categorie": cat,
                "famille": famille(cat),
                "secteurs": [s["label"] for s in ((pub.get("activites") or {}).get("listSecteursActivites") or [])],
                "ville": (pub.get("ville") or "").title() or None,
                "site": pub.get("lienSiteWeb"),
                "fiche": f"https://www.hatvp.fr/fiche-organisation/?organisation={pub.get('identifiantNational')}",
                "dirigeants": [{"nom": f"{(d.get('prenom') or '').strip()} {(d.get('nom') or '').strip().title()}".strip(), "fonction": d.get("fonction")} for d in (pub.get("dirigeants") or [])][:6],
                "affiliations": [a.get("denomination") for a in (pub.get("affiliations") or []) if a.get("denomination")][:12],
                "clients": [c.get("denomination") for c in (pub.get("clients") or []) if c.get("denomination")][:40],
                "exercices": exercices,
                "depense": last.get("depense"),
                "depenseMin": max((e["depenseMin"] for e in exercices), default=0),
                "salaries": last.get("salaries"),
                "actions": actions,
            }
        )
    # Slugs uniques : homonymes départagés par le SIREN.
    seen: Counter = Counter()
    for o in orgs:
        if slugs[o["slug"]] > 1:
            o["slug"] = f"{o['slug']}-{o['siren'] or seen[o['slug']]}"
        seen[o["slug"]] += 1
    orgs.sort(key=lambda o: (-len(o["actions"]), -o["depenseMin"]))

    acts = [a for o in orgs for a in o["actions"]]
    n = len(acts)
    inst = Counter(c for a in acts for c in a["cibles"])
    mins = Counter(m for a in acts for m in a["ministeres"])
    auts = Counter(m for a in acts for m in a["autorites"])
    doms = Counter(d for a in acts for d in a["domaines"])
    moy = Counter(m for a in acts for m in a["moyens"])
    dec = Counter(m for a in acts for m in a["decisions"])
    flows = Counter((o["famille"], c) for o in orgs for a in o["actions"] for c in a["cibles"])
    fam = Counter(o["famille"] for o in orgs)
    fam_actions = Counter(o["famille"] for o in orgs for _ in o["actions"])
    series = Counter(quarter(a["date"]) for a in acts)
    parl = sum(1 for a in acts if "parlement" in a["cibles"])
    log(f"lobbying : {len(orgs)} organisations, {n} actions depuis {DEPUIS}, dont {parl} visant le Parlement")

    def top(f: str | None, k: int = 25):
        return [{"slug": o["slug"], "nom": o["nom"], "actions": len(o["actions"]), "depense": o["depense"], "depenseMin": o["depenseMin"], "famille": o["famille"]} for o in orgs if f is None or o["famille"] == f][:k]

    summary = {
        "depuis": DEPUIS,
        "organisations": len(orgs),
        "actions": n,
        "actionsParlement": parl,
        "institutions": [{"code": k, "nom": v, "n": inst[k]} for k, v in INSTITUTIONS.items()],
        "familles": [{"code": k, "nom": v, "organisations": fam[k], "actions": fam_actions[k]} for k, v in FAMILLES.items()],
        "flux": [{"de": f, "vers": c, "n": v} for (f, c), v in flows.items()],
        "ministeres": [{"nom": k, "n": v} for k, v in mins.most_common()],
        "autorites": [{"nom": k, "n": v} for k, v in auts.most_common(12)],
        "domaines": [{"nom": k, "n": v} for k, v in doms.most_common(30)],
        "moyens": [{"nom": k, "n": v} for k, v in moy.most_common()],
        "decisions": [{"nom": k, "n": v} for k, v in dec.most_common()],
        "trimestres": [{"t": k, "n": series[k]} for k in sorted(series)],
        "top": top(None, 150),
        "topFamilles": {f: top(f, 15) for f in FAMILLES},
        "gros": sorted(top(None, 10**6), key=lambda o: -o["depenseMin"])[:40],
        "beneficiaires": [{"nom": k, "n": v, "via": sorted(via[k])[:5]} for k, v in beneficiaires.most_common(60)],
        # Compatibilité avec l'image de partage et l'accueil.
        "categories": [{"nom": FAMILLES[k], "n": fam[k]} for k in FAMILLES],
        "source": AGORA,
    }
    return {"summary": summary, "orgs": orgs}
