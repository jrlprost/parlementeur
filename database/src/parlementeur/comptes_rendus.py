"""Comptes rendus des séances publiques : heures réelles d'ouverture, de levée et de suspension.

Les comptes rendus officiels écrivent les heures en toutes lettres
(« La séance est levée, le mercredi 4 février 2026, à zéro heure cinq. ») :
ce module les convertit et les rattache aux séances de l'agenda par seanceRef.
"""

from __future__ import annotations

import re
import zipfile
from datetime import date, datetime, timedelta

from lxml import etree

NS = {"a": "http://schemas.assemblee-nationale.fr/referentiel"}

# ---------------------------------------------------------------------------
# French number words -> int, 0..59 (covers hours 0-23 and minutes 0-59)
# ---------------------------------------------------------------------------

_UNITS = {
    "zero": 0, "zéro": 0,
    "un": 1, "une": 1,
    "deux": 2, "trois": 3, "quatre": 4, "cinq": 5, "six": 6, "sept": 7,
    "huit": 8, "neuf": 9, "dix": 10, "onze": 11, "douze": 12, "treize": 13,
    "quatorze": 14, "quinze": 15, "seize": 16,
}
_TENS = {
    "dix": 10, "vingt": 20, "trente": 30, "quarante": 40, "cinquante": 50,
}


def _word_to_int(text: str) -> int | None:
    """Convert a French number word (possibly hyphen/space/'et' separated,
    e.g. 'vingt et une', 'quarante-cinq', 'dix-sept') to an int 0..59."""
    if text is None:
        return None
    norm = text.strip().lower().replace("\xa0", " ")
    norm = re.sub(r"[\s-]+", " ", norm).strip()
    if not norm:
        return None
    if norm in _UNITS:
        return _UNITS[norm]
    if norm in _TENS:
        return _TENS[norm]
    # "dix-sept".."dix-neuf" already collapsed to "dix sept" etc by the split above
    parts = norm.split(" et ")
    if len(parts) == 2:
        tens = _TENS.get(parts[0].strip())
        unit = _UNITS.get(parts[1].strip())
        if tens is not None and unit is not None:
            return tens + unit
    # space-joined compounds: "dix sept", "vingt deux", "quatre vingt" (unused
    # for hours/minutes 0-59 but harmless), "soixante..." not needed here.
    tokens = norm.split(" ")
    if len(tokens) == 2:
        tens = _TENS.get(tokens[0])
        unit = _UNITS.get(tokens[1])
        if tens is not None and unit is not None:
            return tens + unit
    return None


_MONTHS = {
    "janvier": 1, "février": 2, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5,
    "juin": 6, "juillet": 7, "août": 8, "aout": 8, "septembre": 9,
    "octobre": 10, "novembre": 11, "décembre": 12, "decembre": 12,
}


def _norm_ws(s: str) -> str:
    return " ".join(s.split()).replace("\xa0", " ").strip()


def _parse_time_words(hour_word: str, minute_word: str | None) -> tuple[int, int] | None:
    """hour_word: 'minuit' | 'midi' | number word. minute_word: number word or None."""
    hw = hour_word.strip().lower()
    if hw == "minuit":
        h = 0
    elif hw == "midi":
        h = 12
    else:
        h = _word_to_int(hw)
    if h is None:
        return None
    m = 0
    if minute_word:
        mm = _word_to_int(minute_word)
        if mm is not None:
            m = mm
    return h, m


# A french number-word token restricted to the actual vocabulary (0-16, and the
# tens 10/20/30/40/50), so it can never swallow the following "heure(s)" word.
# Up to two tokens ("tens [et] unit", e.g. "vingt et une", "quarante-cinq",
# "dix-sept") cover every hour (0-23) and minute (0-59) value used here.
_NUM_TOKEN = (
    r"(?:zéro|zero|vingt|trente|quarante|cinquante|dix|onze|douze|treize|"
    r"quatorze|quinze|seize|neuf|huit|sept|six|cinq|quatre|trois|deux|une|un)"
)
_NUMWORD = _NUM_TOKEN + r"(?:[\s-]+(?:et[\s-]+)?" + _NUM_TOKEN + r")?"

# "(La séance est ouverte à quinze heures dix.)" / "à 14 heures." / "à 21h45."
_RE_OUVERTURE = re.compile(
    r"ouverte\s+à\s+"
    r"(?:(?P<digit_h>\d{1,2})\s*h\s*(?P<digit_m>\d{1,2})?"
    r"|(?P<digit_h2>\d{1,2})\s*heures?\.?"
    r"|(?P<word>minuit|midi|" + _NUMWORD + r")\s+heures?"
    r"(?:\s+(?P<mword>" + _NUMWORD + r"))?)"
    , re.IGNORECASE,
)

_RE_LEVEE_DATE = re.compile(
    r"levée,?\s*(?:le\s+(?P<date>(?:[a-zéû]+\s+)?\d{1,2}(?:er)?(?:\s*[a-zéû]+)?(?:\s+\d{4})?)\s*,?\s*)?"
    r"à\s+"
    r"(?:(?P<digit_h>\d{1,2})\s*h\s*(?P<digit_m>\d{1,2})?"
    r"|(?P<word>minuit|midi|" + _NUMWORD + r")(?:\s+heures?)?"
    r"(?:\s+(?P<mword>" + _NUMWORD + r"))?)"
    , re.IGNORECASE,
)

_WEEKDAYS = {"lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"}


def _parse_explicit_date(date_str: str, ref: date) -> date | None:
    """Parse a fragment like 'mardi 3 juin 2025' / 'jeudi 1er mai 2025' /
    'mercredi 4 décembre' / '20 juillet 2024', filling missing month/year
    from the reference (opening) date."""
    if not date_str:
        return None
    tokens = _norm_ws(date_str).lower().split(" ")
    tokens = [t for t in tokens if t not in _WEEKDAYS]
    if not tokens:
        return None
    day_tok = tokens[0].replace("er", "")
    if not day_tok.isdigit():
        return None
    day = int(day_tok)
    month = ref.month
    year = ref.year
    if len(tokens) >= 2 and tokens[1] in _MONTHS:
        month = _MONTHS[tokens[1]]
    if len(tokens) >= 3 and tokens[2].isdigit():
        year = int(tokens[2])
    try:
        d = date(year, month, day)
    except ValueError:
        return None
    # If month/year were not given and the resulting date is before the
    # reference date, the sitting rolled over to the next month.
    if d < ref:
        month2 = month + 1
        year2 = year
        if month2 > 12:
            month2 = 1
            year2 += 1
        try:
            d2 = date(year2, month2, day)
            if d2 >= ref:
                d = d2
        except ValueError:
            pass
    return d


def _extract_paragraph_text(root, code_grammaire: str) -> list[str]:
    out = []
    for p in root.findall(f'.//a:paragraphe[@code_grammaire="{code_grammaire}"]', NS):
        out.append(_norm_ws("".join(p.itertext())))
    return out


def _parse_dateseance(raw: str) -> date | None:
    # format observed: "20251002090000000" -> YYYYMMDDHHMMSSmmm
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", raw or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def parse_seance_times(xml: bytes) -> dict:
    uid = None
    try:
        root = etree.fromstring(xml)

        uid_el = root.find(".//a:uid", NS)
        uid = uid_el.text.strip() if uid_el is not None and uid_el.text else None
        seance_ref_el = root.find(".//a:seanceRef", NS)
        seance_uid = seance_ref_el.text.strip() if seance_ref_el is not None and seance_ref_el.text else None
        session_ref_el = root.find(".//a:sessionRef", NS)
        session_ref = session_ref_el.text.strip() if session_ref_el is not None and session_ref_el.text else None
        date_seance_el = root.find(".//a:metadonnees/a:dateSeance", NS)
        ref_date = _parse_dateseance(date_seance_el.text if date_seance_el is not None else "")
        if ref_date is None:
            return {"uid": uid, "error": "no dateSeance"}

        # --- opening time -------------------------------------------------
        ouv_texts = _extract_paragraph_text(root, "OUV_SEAN_2_2")
        ouv_time = None
        for t in ouv_texts:
            m = _RE_OUVERTURE.search(t)
            if not m:
                continue
            if m.group("digit_h"):
                h = int(m.group("digit_h"))
                mnt = int(m.group("digit_m")) if m.group("digit_m") else 0
                ouv_time = (h, mnt)
            elif m.group("digit_h2"):
                ouv_time = (int(m.group("digit_h2")), 0)
            elif m.group("word"):
                parsed = _parse_time_words(m.group("word"), m.group("mword"))
                if parsed:
                    ouv_time = parsed
            if ouv_time:
                break
        if ouv_time is None:
            return {"uid": uid, "seance_uid": seance_uid, "date": ref_date.isoformat(),
                     "error": "could not parse ouverture", "ouv_texts": ouv_texts}

        # --- closing time (+ optional explicit next-day date) -------------
        fin_texts = _extract_paragraph_text(root, "FIN_SEAN_2_4")
        levee_time = None
        levee_date = ref_date
        explicit_date_found = False
        for t in fin_texts:
            m = _RE_LEVEE_DATE.search(t)
            if not m:
                continue
            if m.group("digit_h"):
                h = int(m.group("digit_h"))
                mnt = int(m.group("digit_m")) if m.group("digit_m") else 0
                levee_time = (h, mnt)
            elif m.group("word"):
                parsed = _parse_time_words(m.group("word"), m.group("mword"))
                if parsed:
                    levee_time = parsed
            if levee_time is None:
                continue
            if m.group("date"):
                d = _parse_explicit_date(m.group("date"), ref_date)
                if d:
                    levee_date = d
                    explicit_date_found = True
            break
        if levee_time is None:
            return {"uid": uid, "seance_uid": seance_uid, "date": ref_date.isoformat(),
                     "error": "could not parse levee", "fin_texts": fin_texts}

        # If no explicit date was given and the closing clock time is
        # earlier than the opening clock time, the sitting crossed midnight.
        if not explicit_date_found:
            if (levee_time[0], levee_time[1]) < ouv_time:
                levee_date = ref_date + timedelta(days=1)

        dt_ouv = datetime(ref_date.year, ref_date.month, ref_date.day, ouv_time[0], ouv_time[1])
        dt_lev = datetime(levee_date.year, levee_date.month, levee_date.day, levee_time[0], levee_time[1])
        if dt_lev < dt_ouv:
            # safety net: still crossed a boundary we didn't detect explicitly
            dt_lev += timedelta(days=1)
        minutes = round((dt_lev - dt_ouv).total_seconds() / 60)

        # --- suspensions (best effort) -------------------------------------
        susp_minutes = 0
        n_susp = 0
        for code in ("SUSP_SEANCE_2_2", "SUSP_SEAN_PRES_3"):
            for t in _extract_paragraph_text(root, code):
                mm = re.search(
                    r"suspendue\s+à\s+(?P<h1>" + _NUMWORD + r")\s+heures?(?:\s+(?P<m1>" + _NUMWORD + r"))?"
                    r"\s*,?\s*est\s+reprise\s+à\s+(?P<h2>" + _NUMWORD + r")\s+heures?(?:\s+(?P<m2>" + _NUMWORD + r"))?",
                    t, re.IGNORECASE,
                )
                if not mm:
                    continue
                h1 = _word_to_int(mm.group("h1"))
                m1 = _word_to_int(mm.group("m1")) if mm.group("m1") else 0
                h2 = _word_to_int(mm.group("h2"))
                m2 = _word_to_int(mm.group("m2")) if mm.group("m2") else 0
                if h1 is None or h2 is None:
                    continue
                t1 = h1 * 60 + (m1 or 0)
                t2 = h2 * 60 + (m2 or 0)
                delta = t2 - t1
                if delta < 0:
                    delta += 24 * 60  # crossed midnight
                susp_minutes += delta
                n_susp += 1

        # Prises de parole : position de chaque paragraphe du député dans la séance.
        orders = []
        speakers: dict[str, list[int]] = {}
        for p in root.iter("{http://schemas.assemblee-nationale.fr/referentiel}paragraphe"):
            o = p.get("ordre_absolu_seance")
            if not o or not o.isdigit():
                continue
            o = int(o)
            orders.append(o)
            a = p.get("id_acteur") or ""
            if a.startswith("PA"):
                w = speakers.setdefault(a, [o, o, 0])
                w[0] = min(w[0], o)
                w[1] = max(w[1], o)
                # La présidence de séance prouve la présence, mais ce n'est pas une intervention.
                nom = (p.findtext("{http://schemas.assemblee-nationale.fr/referentiel}orateurs/{http://schemas.assemblee-nationale.fr/referentiel}orateur/{http://schemas.assemblee-nationale.fr/referentiel}nom") or "").strip().lower()
                if not (nom.startswith("m. le président") or nom.startswith("mme la présidente")):
                    w[2] += 1
        span = (max(orders) - min(orders) + 1) if orders else 0
        return {
            "uid": uid,
            "seance_uid": seance_uid,
            "paragraphes": span,
            "orateurs": speakers,
            "session_ref": session_ref,
            "date": ref_date.isoformat(),
            "ouverture": f"{ouv_time[0]:02d}:{ouv_time[1]:02d}",
            "levee": f"{levee_time[0]:02d}:{levee_time[1]:02d}",
            "levee_date": levee_date.isoformat(),
            "levee_next_day": levee_date != ref_date,
            "minutes": minutes,
            "suspensions_minutes": susp_minutes,
            "n_suspensions": n_susp,
        }
    except Exception as exc:  # noqa: BLE001
        return {"uid": uid, "error": f"{type(exc).__name__}: {exc}"}


SYCERON = "https://data.assemblee-nationale.fr/static/openData/repository/17/vp/syceronbrut/syseron.xml.zip"


def load() -> dict[str, dict]:
    """Heures réelles de chaque séance publique, indexées par identifiant de séance de l'agenda."""
    from .common import fetch, log

    out: dict[str, dict] = {}
    failed = 0
    with zipfile.ZipFile(fetch(SYCERON, "an17_syceron.xml.zip", max_age_h=20)) as z:
        for n in z.namelist():
            if not n.endswith(".xml"):
                continue
            r = parse_seance_times(z.read(n))
            if "error" in r or not r.get("seance_uid"):
                failed += 1
                continue
            out[r["seance_uid"]] = r
    log(f"comptes rendus : {len(out)} séances datées, {failed} non lues")
    return out
