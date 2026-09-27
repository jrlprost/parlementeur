"""Agenda de l'Assemblée : séances publiques et réunions de commission, avec la présence de chaque député en commission."""

from __future__ import annotations

import json
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta

from .common import AN_BASE, as_list, fetch, log, val

AGENDA = f"{AN_BASE}/17/vp/reunions/Agenda.json.zip"
TYPES = {"seance_type": "seance", "reunionCommission_type": "commission", "reunionInitParlementaire_type": "autre"}


def _ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace(".000", ""))
    except ValueError:
        return None


def _objets(r: dict) -> list[str]:
    odj = r.get("ODJ") or {}
    out = []
    for p in as_list((odj.get("pointsODJ") or {}).get("pointODJ")):
        o = val(p.get("objet"))
        if o:
            out.append(o.strip())
    conv = (odj.get("convocationODJ") or {}).get("item") if odj.get("convocationODJ") else None
    for c in as_list(conv):
        if isinstance(c, str) and c.strip():
            out.append(c.strip())
    seen = set()
    return [o for o in out if not (o in seen or seen.add(o))]


def load(organe_names: dict[str, str], scrutins: list[dict], deputy_ids: set[str], reels: dict[str, dict] | None = None):
    """Renvoie (événements publiés, statistiques de présence en commission par député)."""
    z = zipfile.ZipFile(fetch(AGENDA, "an17_agenda.json.zip", max_age_h=0.9))
    votes_by_seance: dict[str, int] = defaultdict(int)
    for s in scrutins:
        if s.get("seanceRef"):
            votes_by_seance[s["seanceRef"]] += 1

    events = []
    auditions = []
    presence: dict[str, dict] = {i: {"convocations": 0, "presents": 0, "excuses": 0, "absents": 0, "minutes": 0} for i in deputy_ids}
    # Par mois : [convocations, présences, minutes de présence] en commission, pour filtrer par période.
    monthly: dict[str, dict[str, list[int]]] = {i: {} for i in deputy_ids}
    for n in z.namelist():
        if not n.endswith(".json"):
            continue
        r = json.loads(z.read(n))["reunion"]
        etat = ((r.get("cycleDeVie") or {}).get("etat") or "").strip()
        if etat not in ("Confirmé", "Eventuel"):
            continue
        debut, fin = _ts(r.get("timeStampDebut")), _ts(val(r.get("timeStampFin")))
        if not debut:
            continue
        minutes = int((fin - debut).total_seconds() // 60) if fin and fin > debut else None
        if minutes is not None and minutes > 16 * 60:
            minutes = None
        kind = TYPES.get(r.get("@xsi:type"), "autre")
        parts = as_list(((r.get("participants") or {}).get("participantsInternes") or {}).get("participantInterne"))
        presents = sum(1 for p in parts if p and p.get("presence") == "présent")
        for p in parts:
            a = p and p.get("acteurRef")
            if a in presence:
                st = presence[a]
                st["convocations"] += 1
                pr = p.get("presence")
                mo = monthly[a].setdefault(debut.strftime("%Y-%m"), [0, 0, 0])
                mo[0] += 1
                if pr == "présent":
                    mo[1] += 1
                    mo[2] += minutes or 0
                if pr == "présent":
                    st["presents"] += 1
                    st["minutes"] += minutes or 0
                elif pr == "excusé":
                    st["excuses"] += 1
                else:
                    st["absents"] += 1
        organe = organe_names.get(r.get("organeReuniRef") or "", "")
        objets = _objets(r)
        if kind == "commission" and any("audition" in o.lower() for o in objets):
            auditions.append(
                {
                    "date": debut.date().isoformat(),
                    "organe": organe,
                    "texte": " · ".join(o for o in objets if "audition" in o.lower())[:900],
                    "presents": [p.get("acteurRef") for p in parts if p and p.get("presence") == "présent"],
                }
            )
        reel = (reels or {}).get(r["uid"]) if kind == "seance" else None
        # Séance passée sans compte rendu, sans vote et sans heure de fin : prévue mais jamais tenue.
        if kind == "seance" and reels and not reel and not votes_by_seance.get(r["uid"]) and minutes is None and debut.date() < datetime.now(debut.tzinfo).date() - timedelta(days=10):
            continue
        events.append(
            {
                # Heures réelles tirées du compte rendu : ouverture, durée totale, minutes de suspension.
                **({"ro": reel["ouverture"], "rm": reel["minutes"], "rs": reel["suspensions_minutes"]} if reel else {}),
                **({"_uid": r["uid"]} if kind == "seance" else {}),
                "t": kind,
                "d": debut.isoformat(timespec="minutes"),
                "m": minutes,
                "o": "Séance publique" if kind == "seance" else organe,
                "x": " · ".join(_objets(r))[:180],
                "v": votes_by_seance.get(r["uid"], 0),
                "p": presents if parts else None,
                "c": len(parts) if parts else None,
                "e": "prévisionnel" if etat == "Eventuel" else None,
            }
        )
    events.sort(key=lambda e: e["d"])
    # Index des séances publiques par identifiant, pour calculer la présence en séance de chaque député.
    seance_index = {e.pop("_uid"): e for e in events if "_uid" in e}
    log(f"agenda : {len(events)} réunions ({sum(1 for e in events if e['t'] == 'seance')} séances publiques)")
    return events, presence, monthly, seance_index, auditions
