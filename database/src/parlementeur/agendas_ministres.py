"""Agendas publics des ministres : qui les ministres reçoivent.

Sources lisibles sans contourner de protection :
- Éducation nationale et Enseignement supérieur : jeux de données ouverts (Opendatasoft) ;
- Culture : agenda prévisionnel hebdomadaire publié en HTML.
L'agenda centralisé d'info.gouv.fr (tous les ministres) est protégé contre les robots : il n'est pas collecté.
"""

from __future__ import annotations

import html
import json
import re
import time
from datetime import date

import httpx

from .common import RAW, USER_AGENT, fetch, log

DEPUIS = "2024-07-01"
EDU = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-agenda-ministre-education-nationale/exports/json"
ESR = "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-agenda-ministre/exports/json"
CULTURE = "https://www.culture.gouv.fr/presse/agenda-ministre"

SOURCES = {
    "education": {"label": "Ministère de l'Éducation nationale, agenda du ministre (open data)", "url": "https://www.data.gouv.fr/datasets/agenda-du-ministre-de-leducation-nationale-et-de-la-jeunesse"},
    "esr": {"label": "Ministère de l'Enseignement supérieur et de la Recherche, agenda public (open data)", "url": "https://www.data.gouv.fr/datasets/agenda-public-des-ministres-en-charge-de-lenseignement-superieur-de-la-recherche-et-de-linnovation"},
    "culture": {"label": "Ministère de la Culture, agenda prévisionnel de la ministre", "url": CULTURE},
}

# Rendez-vous où le ministre reçoit ou rencontre quelqu'un (et non un déplacement, un discours, une séance).
MEETING = re.compile(r"\b(entretien|rencontre|re[çc]oit|r[ée]union avec|[ée]change avec|audience|petit[- ]d[ée]jeuner avec|d[ée]jeuner avec|d[îi]ner avec|visioconf[ée]rence avec)\b", re.I)


def _education() -> list[dict]:
    rows = json.loads(fetch(EDU, "agenda_min_education.json").read_text("utf-8"))
    return [
        {"source": "education", "ministere": "Education nationale, enseignement supérieur et recherche", "ministre": "Ministre de l'Éducation nationale", "date": r["dtstart"][:10], "heure": None, "texte": (r.get("description") or "").strip(), "url": SOURCES["education"]["url"]}
        for r in rows
        if (r.get("dtstart") or "") >= DEPUIS and r.get("description")
    ]


def _esr() -> list[dict]:
    rows = json.loads(fetch(ESR, "agenda_min_esr.json").read_text("utf-8"))
    out = []
    for r in rows:
        d = r.get("dtstart") or ""
        if d < DEPUIS:
            continue
        # « Entretien avec X at Lieu » : le lieu suit « at ».
        texte = re.sub(r"\s+at\s+[^,]*(,.*)?$", "", (r.get("summary") or "").strip())
        out.append({"source": "esr", "ministere": "Education nationale, enseignement supérieur et recherche", "ministre": r.get("agenda") or "Ministre de l'Enseignement supérieur", "date": d[:10], "heure": d[11:16] or None, "texte": texte, "url": SOURCES["esr"]["url"]})
    return out


MOIS = {m: i + 1 for i, m in enumerate(["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"])}


def _get(url: str) -> str:
    """Page HTML mise en cache ; une page de semaine passée ne change plus."""
    name = "culture_" + re.sub(r"[^a-z0-9]+", "_", url.split("gouv.fr/")[-1].lower())[-80:] + ".html"
    p = RAW / "agendas" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():
        return p.read_text("utf-8")
    r = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True)
    r.raise_for_status()
    time.sleep(0.5)
    p.write_text(r.text, "utf-8")
    return r.text


def _text(s: str) -> list[str]:
    m = re.search(r"<main.*?</main>", s, re.S)
    s = m.group(0) if m else s
    s = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    s = html.unescape(re.sub(r"<(br|/p|/li|/h\d|/div)[^>]*>", "\n", s))
    s = re.sub(r"<[^>]+>", "", s).replace("\xa0", " ")
    return [l.strip() for l in s.split("\n") if l.strip()]


def _culture_week(url: str) -> list[dict]:
    lines = _text(_get(url))
    title = next((l for l in lines if l.startswith("Agenda prévisionnel")), "")
    ministre = re.sub(r"^Agenda prévisionnel (de |du )?", "", title).split(",")[0].strip() or "Ministre de la Culture"
    year = next((int(y) for l in lines[:12] for y in re.findall(r"\b(20\d\d)\b", l)), date.today().year)
    out, day = [], None
    i = 0
    while i < len(lines):
        l = lines[i]
        m = re.match(r"^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d+)(?:er)?\s+([a-zéû]+)", l, re.I)
        if m and m.group(3).lower() in MOIS:
            day = date(year, MOIS[m.group(3).lower()], int(m.group(2))).isoformat()
        h = re.match(r"^(\d{1,2})\s*h\s*(\d{2})?\s+(.*)$", l)
        if h and day:
            texte = h.group(3).strip()
            # Suite du texte sur la ligne suivante, quand ce n'est ni une heure, ni un jour, ni un lieu court.
            if i + 1 < len(lines) and not re.match(r"^\d{1,2}\s*h", lines[i + 1]) and texte.endswith((",", "et", "de", "du", "des", "la", "le")):
                texte += " " + lines[i + 1]
            out.append({"source": "culture", "ministere": "Culture et communication", "ministre": ministre, "date": day, "heure": f"{int(h.group(1)):02d}:{h.group(2) or '00'}", "texte": texte, "url": url})
        i += 1
    return out


def _culture() -> list[dict]:
    out, page, seen = [], 0, set()
    while page < 200:
        listing = httpx.get(CULTURE if page == 0 else f"{CULTURE}?page={page}", headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True).text
        links = [u for u in dict.fromkeys(re.findall(r'href="(https://www\.culture\.gouv\.fr/presse/agenda-ministre/[^"]+)"', listing)) if u not in seen]
        # Plus de nouvelle semaine : on a fait le tour de la liste.
        if not links:
            break
        seen.update(links)
        old = False
        for u in links:
            week = _culture_week(u)
            out += [e for e in week if e["date"] >= DEPUIS]
            if week and max(e["date"] for e in week) < DEPUIS:
                old = True
        if old:
            break
        page += 1
        time.sleep(0.5)
    return out


def load() -> dict:
    entries: list[dict] = []
    status = {}
    for key, fn in (("education", _education), ("esr", _esr), ("culture", _culture)):
        try:
            rows = fn()
            entries += rows
            status[key] = {**SOURCES[key], "records": len(rows), "dernier": max((r["date"] for r in rows), default=None)}
        except Exception as e:  # une source indisponible n'empêche pas les autres
            log(f"agenda ministériel {key} indisponible : {e}")
            status[key] = {**SOURCES[key], "records": 0, "erreur": str(e)[:120]}
    meetings = [e for e in entries if MEETING.search(e["texte"])]
    log(f"agendas des ministres : {len(entries)} événements depuis {DEPUIS}, dont {len(meetings)} entretiens ou rencontres")
    return {"entries": entries, "meetings": meetings, "sources": status}
