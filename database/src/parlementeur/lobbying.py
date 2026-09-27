"""Répertoire des représentants d'intérêts (HATVP, AGORA) : qui cherche à influencer le Parlement.

Le répertoire ne nomme jamais les élus rencontrés, seulement leur catégorie. On ne retient ici que les
actions déclarées auprès de « Député, sénateur, collaborateur… », depuis le début de la législature.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime

from .common import fetch, log

AGORA = "https://www.hatvp.fr/agora/opendata/agora_repertoire_opendata.json"
DEPUIS = "2024-07-01"


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
    nums = [int(x.replace(" ", "").replace(" ", "")) for x in re.findall(r"\d[\d  ]*", label)]
    if not nums:
        return 0
    return 0 if label.strip().startswith("<") else min(nums)


def load() -> dict:
    p = fetch(AGORA, "hatvp_agora.json", max_age_h=20)
    data = json.loads(p.read_text("utf-8"))
    orgs = []
    domaines: Counter = Counter()
    categories: Counter = Counter()
    decisions: Counter = Counter()
    beneficiaires: Counter = Counter()
    via: dict[str, set] = defaultdict(set)
    recent = []
    total_actions = 0
    for pub in data["publications"]:
        n_parl = 0
        dom_org: Counter = Counter()
        spend = 0
        spend_label = None
        last = None
        for ex in pub.get("exercices") or []:
            pc = ex.get("publicationCourante") or {}
            debut = _date(pc.get("dateDebut"))
            if not debut or (_date(pc.get("dateFin")) or debut) < DEPUIS:
                continue
            low = _bracket_low(pc.get("montantDepense"))
            if low >= spend:
                spend, spend_label = low, pc.get("montantDepense") or spend_label
            for act in pc.get("activites") or []:
                a = act.get("publicationCourante") or {}
                actions = a.get("actionsRepresentationInteret") or []
                if not any("Député" in r for x in actions for r in (x.get("reponsablesPublics") or [])):
                    continue
                n_parl += 1
                total_actions += 1
                for dm in a.get("domainesIntervention") or []:
                    domaines[dm] += 1
                    dom_org[dm] += 1
                for x in actions:
                    for dc in x.get("decisionsConcernees") or []:
                        decisions[dc] += 1
                # Bénéficiaires : l'organisation elle-même ("en propre") ou les clients d'un cabinet.
                for t in {t for x in actions for t in (x.get("tiers") or [])}:
                    name = re.sub(r"\s*\(en propre\)\s*$", "", t).strip()
                    beneficiaires[name] += 1
                    if name != pub["denomination"]:
                        via[name].add(pub["denomination"])
                date = _date((a.get("publicationDate") or "").split(" à ")[0]) or debut
                last = max(last or date, date)
                recent.append(
                    {
                        "organisation": pub["denomination"],
                        "objet": (a.get("objet") or "").strip(),
                        "date": date,
                        "domaines": a.get("domainesIntervention") or [],
                        "actions": sorted({m for x in actions for m in (x.get("actionsMenees") or [])}),
                    }
                )
        if not n_parl:
            continue
        cat = (pub.get("categorieOrganisation") or {}).get("label") or "Autre"
        categories[cat] += 1
        orgs.append(
            {
                "nom": pub["denomination"],
                "categorie": cat,
                "activites": n_parl,
                "depense": spend_label,
                "depenseMin": spend,
                "domaines": [d for d, _ in dom_org.most_common(3)],
                "site": pub.get("lienSiteWeb"),
                "fiche": f"https://www.hatvp.fr/fiche-organisation/?organisation={pub.get('identifiantNational')}",
                "derniere": last,
            }
        )
    orgs.sort(key=lambda o: (-o["activites"], -o["depenseMin"]))
    recent.sort(key=lambda r: r["date"], reverse=True)
    by_cat_spend: dict[str, int] = defaultdict(int)
    for o in orgs:
        by_cat_spend[o["categorie"]] += o["depenseMin"]
    log(f"lobbying : {len(orgs)} organisations, {total_actions} actions visant les parlementaires depuis {DEPUIS}")
    return {
        "depuis": DEPUIS,
        "organisations": len(orgs),
        "actions": total_actions,
        "domaines": [{"nom": k, "n": v} for k, v in domaines.most_common(25)],
        "categories": [{"nom": k, "n": v, "depenseMin": by_cat_spend[k]} for k, v in categories.most_common()],
        "decisions": [{"nom": k, "n": v} for k, v in decisions.most_common(10)],
        "beneficiaires": [{"nom": k, "n": v, "via": sorted(via[k])[:5]} for k, v in beneficiaires.most_common(60)],
        "top": orgs[:150],
        "gros": sorted(orgs, key=lambda o: -o["depenseMin"])[:40],
        "recentes": recent[:400],
        "source": AGORA,
    }
