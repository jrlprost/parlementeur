"""Wikidata : nombre de législatures effectuées par chaque député (l'AN ne publie l'historique qu'à partir de 2012)."""

from __future__ import annotations

import httpx

from .common import USER_AGENT, log

ENDPOINT = "https://query.wikidata.org/sparql"
QUERY = """
SELECT ?id (COUNT(DISTINCT ?term) AS ?n) (MIN(?start) AS ?first) WHERE {
  ?p wdt:P4123 ?id .
  ?p p:P39 ?st .
  ?st ps:P39 wd:Q3044918 ; pq:P2937 ?term .
  OPTIONAL { ?st pq:P580 ?start . }
  VALUES ?id { %s }
}
GROUP BY ?id
"""


def legislatures(an_ids: list[str]) -> dict[str, dict]:
    """Renvoie {PAxxxx: {"n": nombre de législatures, "first": année de première élection}}."""
    out: dict[str, dict] = {}
    nums = [i.removeprefix("PA") for i in an_ids]
    try:
        for k in range(0, len(nums), 150):
            chunk = " ".join(f'"{n}"' for n in nums[k : k + 150])
            r = httpx.get(
                ENDPOINT,
                params={"query": QUERY % chunk},
                headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT},
                timeout=120,
            )
            r.raise_for_status()
            for b in r.json()["results"]["bindings"]:
                first = b.get("first", {}).get("value")
                out[f"PA{b['id']['value']}"] = {"n": int(b["n"]["value"]), "first": int(first[:4]) if first else None}
    except httpx.HTTPError as e:
        log(f"Wikidata indisponible ({e}) : ancienneté calculée sur les seules données AN")
    log(f"Wikidata : ancienneté trouvée pour {len(out)} députés")
    return out


PRESIDENTIAL = """
SELECT ?id ?eLabel WHERE {
  VALUES ?id { %s }
  ?p wdt:P4123 ?id ; wdt:P3602 ?e .
  ?e rdfs:label ?eLabel .
  FILTER(LANG(?eLabel) = "fr" && CONTAINS(?eLabel, "présidentielle"))
}
"""


def presidential(an_ids: list[str]) -> dict[str, list[int]]:
    """Années de candidature à l'élection présidentielle de chaque député (d'après Wikidata)."""
    import re as _re

    nums = " ".join(f'"{i.removeprefix("PA")}"' for i in an_ids)
    out: dict[str, set[int]] = {}
    try:
        r = httpx.post(
            ENDPOINT,
            data={"query": PRESIDENTIAL % nums},
            headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT},
            timeout=120,
        )
        r.raise_for_status()
        for b in r.json()["results"]["bindings"]:
            m = _re.search(r"(19|20)\d{2}", b["eLabel"]["value"])
            if m:
                out.setdefault(f"PA{b['id']['value']}", set()).add(int(m.group()))
    except httpx.HTTPError as e:
        log(f"Wikidata indisponible pour les présidentielles ({e})")
    return {k: sorted(v) for k, v in out.items()}
