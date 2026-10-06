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
DIPLOMATIE = "https://www.diplomatie.gouv.fr/fr/agenda"
ECOLOGIE = "https://www.ecologie.gouv.fr/presse"
# Agendas protégés contre les robots (Matignon…), collectés avec un navigateur par website/scripts/agendas-navigateur.ts.
NAVIGATEUR = "https://og.parlementeur.fr/donnees/agendas-navigateur.json"

SOURCES = {
    "education": {"label": "Ministère de l'Éducation nationale, agenda du ministre (open data)", "url": "https://www.data.gouv.fr/datasets/agenda-du-ministre-de-leducation-nationale-et-de-la-jeunesse"},
    "esr": {"label": "Ministère de l'Enseignement supérieur et de la Recherche, agenda public (open data)", "url": "https://www.data.gouv.fr/datasets/agenda-public-des-ministres-en-charge-de-lenseignement-superieur-de-la-recherche-et-de-linnovation"},
    "culture": {"label": "Ministère de la Culture, agenda prévisionnel de la ministre", "url": CULTURE},
    "ecologie": {"label": "Ministères de la Transition écologique, agendas des ministres", "url": ECOLOGIE},
    "diplomatie": {"label": "Ministère de l'Europe et des Affaires étrangères, agendas des ministres", "url": DIPLOMATIE},
    "matignon": {"label": "Premier ministre, agenda publié sur info.gouv.fr", "url": "https://www.info.gouv.fr/agenda/ministre/sebastien-lecornu"},
    "economie": {"label": "Ministères économiques et financiers (Bercy), agendas des ministres", "url": "https://presse.economie.gouv.fr/agendas/"},
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


def _get(url: str, cache: bool = True) -> str:
    """Page HTML mise en cache : une semaine passée ne change plus ; la semaine en cours est relue."""
    name = re.sub(r"[^a-z0-9]+", "_", url.split("gouv.fr/")[-1].lower())[-90:] + ".html"
    p = RAW / "agendas" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    if cache and p.exists():
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


JOURS = r"(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)"


def _parse_hours(lines: list[str], year: int, base: dict) -> list[dict]:
    """Agenda au format « Lundi 15 juin » puis « 09h30 : Entretien avec … » (le lieu suit, sur sa ligne)."""
    out, day = [], None
    for l in lines:
        m = re.match(JOURS + r"\s+(\d+)(?:er)?\s+([a-zéû]+)", l, re.I)
        if m and m.group(3).lower() in MOIS and len(l) < 40:
            day = date(year, MOIS[m.group(3).lower()], int(m.group(2))).isoformat()
            continue
        h = re.match(r"^(\d{1,2})\s*h\s*(\d{2})?\s*[:–-]?\s+(.*)$", l)
        if h and day:
            out.append({**base, "date": day, "heure": f"{int(h.group(1)):02d}:{h.group(2) or '00'}", "texte": h.group(3).strip()})
    return out


# Le site de l'Écologie publie aussi les agendas des ministres du Logement et des Territoires.
ECOLOGIE_MIN = {
    "Valérie Létard": "Logement",
    "Vincent Jeanbrun": "Logement",
    "François Rebsamen": "Aménagement du territoire, ruralité et collectivités territoriales",
    "Françoise Gatel": "Aménagement du territoire, ruralité et collectivités territoriales",
    "Catherine Vautrin": "Aménagement du territoire, ruralité et collectivités territoriales",
    "Michel Fournier": "Aménagement du territoire, ruralité et collectivités territoriales",
    "Agnès Pannier-Runacher": "Environnement, énergie et mer",
    "Olga Givernet": "Environnement, énergie et mer",
}


def _ecologie() -> list[dict]:
    """Agendas hebdomadaires des ministres, listés parmi les communiqués de /presse (paginés)."""
    # Index cumulatif des semaines déjà vues : la liste ne remonte pas indéfiniment d'un passage à l'autre.
    index = RAW / "agendas" / "ecologie_index.json"
    index_existed = index.exists()
    links: list[str] = json.loads(index.read_text("utf-8")) if index_existed else []
    known = 0
    for page in range(0, 400):
        listing = _get(ECOLOGIE if page == 0 else f"{ECOLOGIE}?page={page}", cache=False)
        found = list(dict.fromkeys(re.findall(r'href="/presse/(agenda-[^"]+)"', listing)))
        if "/presse/" not in listing:
            break
        new = [u for u in found if u not in links]
        links += new
        # Trois pages de suite sans semaine nouvelle : le reste de la liste est déjà dans l'index.
        known = known + 1 if found and not new else 0
        oldest = min((int(y) for u in found for y in re.findall(r"(20\d\d)", u)), default=9999)
        # Sans index (premier passage), on parcourt toute la liste jusqu'à la date de départ.
        if (index_existed and known >= 3) or oldest < int(DEPUIS[:4]):
            break
        time.sleep(0.3)
    index.write_text(json.dumps(links, ensure_ascii=False), "utf-8")
    out = []
    for u in links:
        url = f"{ECOLOGIE}/{u}"
        try:
            lines = _text(_get(url))
        except httpx.HTTPError:
            continue
        title = next((l for l in lines if re.match(r"Agenda (prévisionnel )?d", l)), "")
        year = next((int(y) for l in lines[:40] for y in re.findall(r"\b(20\d\d)\b", l)), date.today().year)
        who = re.sub(r"^Agenda (prévisionnel )?(de |d['’])", "", title).strip()
        who = re.split(r"\s+[-–:]\s*|\s+pour (la semaine|les?)\b|\s+semaine\b|\s+du\s+(\d|lundi|mardi|mercredi|jeudi|vendredi)", who, flags=re.I)[0].strip(" ,:")
        out += _parse_hours(lines, year, {"source": "ecologie", "ministere": "", "ministre": who or "Ministre", "url": url})
    # Coquilles du site (« Philipe Tabarot ») : chaque nom rare est rattaché au nom fréquent le plus proche.
    import difflib
    freq: dict[str, int] = {}
    for e in out:
        freq[e["ministre"]] = freq.get(e["ministre"], 0) + 1
    common = [n for n, k in sorted(freq.items(), key=lambda x: -x[1]) if k >= 15]
    for e in out:
        if e["ministre"] not in common:
            close = difflib.get_close_matches(e["ministre"], common, n=1, cutoff=0.85)
            if close:
                e["ministre"] = close[0]
        e["ministere"] = ECOLOGIE_MIN.get(e["ministre"], "Environnement, énergie et mer")
    return [e for e in out if e["date"] >= DEPUIS]


def _diplomatie_week(slug: str, week: str, cache: bool) -> list[dict]:
    url = f"{DIPLOMATIE}/{slug}?date={week}"
    try:
        lines = _text(_get(url, cache))
    except httpx.HTTPError:
        return []
    who = next((lines[i + 1] for i, l in enumerate(lines) if l.startswith("Vous visualisez l'agenda") and i + 1 < len(lines)), slug.replace("_", " ").title())
    out, day, pending = [], None, None
    for l in lines:
        m = re.match(JOURS + r"\s+(\d+)(?:er)?\s+([a-zéû]+)\s+(20\d\d)$", l, re.I)
        if m and m.group(3).lower() in MOIS:
            day = date(int(m.group(4)), MOIS[m.group(3).lower()], int(m.group(2))).isoformat()
            pending = None
            continue
        if l.startswith("Vous visualisez"):
            break
        if not day:
            continue
        # Le texte précède l'heure : « Entretien avec … » puis « 17:00 ».
        if re.fullmatch(r"\d{1,2}:\d{2}", l) and pending:
            out.append({"source": "diplomatie", "ministere": "Affaires étrangères et développement international", "ministre": who, "date": day, "heure": l, "texte": pending, "url": url})
            pending = None
        elif not re.fullmatch(r"\d{1,2}:\d{2}", l):
            pending = l
    return out


def _diplomatie() -> list[dict]:
    # Les ministres en fonctions sont listés sous « Voir un autre agenda ».
    slugs = sorted(set(re.findall(r"/fr/agenda/([a-z_]+)", _get(f"{DIPLOMATIE}/jean_noel_barrot", cache=False)))) or ["jean_noel_barrot"]
    out = []
    d = date.fromisoformat(DEPUIS)
    today = date.today()
    weeks = []
    while d <= today:
        y, w, _ = d.isocalendar()
        weeks.append(f"{y}-W{w:02d}")
        d = date.fromordinal(d.toordinal() + 7)
    recent = set(weeks[-2:])
    for slug in slugs:
        for wk in weeks:
            out += _diplomatie_week(slug, wk, cache=wk not in recent)
    return out


def _navigateur() -> list[dict]:
    """Fichier déposé par le collecteur en navigateur ; la copie locale sert si R2 est injoignable."""
    try:
        r = httpx.get(NAVIGATEUR, headers={"User-Agent": USER_AGENT}, timeout=60)
        r.raise_for_status()
        data = r.json()
    except Exception:
        p = RAW / "agendas-navigateur.json"
        data = json.loads(p.read_text("utf-8")) if p.exists() else {"entries": []}
    return [e for e in data.get("entries", []) if e.get("date", "") >= DEPUIS and e.get("texte")]


def load() -> dict:
    entries: list[dict] = []
    status = {}
    for key, fn in (("education", _education), ("esr", _esr), ("culture", _culture), ("ecologie", _ecologie), ("diplomatie", _diplomatie), ("navigateur", _navigateur)):
        try:
            rows = fn()
            entries += rows
            # Le fichier du navigateur réunit plusieurs sources (Matignon, Bercy…) : une ligne de couverture par source.
            for k in sorted({r["source"] for r in rows}) if key == "navigateur" else [key]:
                sub = [r for r in rows if r["source"] == k]
                status[k] = {**SOURCES.get(k, {"label": k, "url": ""}), "records": len(sub), "dernier": max((r["date"] for r in sub), default=None)}
        except Exception as e:  # une source indisponible n'empêche pas les autres
            log(f"agenda ministériel {key} indisponible : {e}")
            status[key] = {**SOURCES.get(key, {"label": key, "url": ""}), "records": 0, "erreur": str(e)[:120]}
    meetings = [e for e in entries if MEETING.search(e["texte"])]
    log(f"agendas des ministres : {len(entries)} événements depuis {DEPUIS}, dont {len(meetings)} entretiens ou rencontres")
    return {"entries": entries, "meetings": meetings, "sources": status}
