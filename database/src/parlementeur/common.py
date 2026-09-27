"""Outils partagés : chemins, téléchargement avec cache, normalisation des JSON issus du XML."""

from __future__ import annotations

import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import orjson

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
DIST = ROOT / "dist"
USER_AGENT = "Parlementeur/1.0 (+https://parlementeur.fr/methode/)"

AN_BASE = "https://data.assemblee-nationale.fr/static/openData/repository"


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def fetch(url: str, name: str, max_age_h: float = 20) -> Path:
    """Télécharge `url` dans data/raw/`name`, sauf si une copie de moins de `max_age_h` heures existe."""
    RAW.mkdir(parents=True, exist_ok=True)
    dest = RAW / name
    if dest.exists() and time.time() - dest.stat().st_mtime < max_age_h * 3600:
        return dest
    log(f"téléchargement {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=300, headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        with tmp.open("wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    tmp.replace(dest)
    return dest


def as_list(x: Any) -> list:
    """Le JSON de l'Assemblée donne un objet seul ou une liste selon la cardinalité : on normalise en liste."""
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def val(x: Any) -> Any:
    """Les éléments XML nuls arrivent sous la forme {"@xsi:nil": "true"} : on les ramène à None."""
    if isinstance(x, dict) and x.get("@xsi:nil") == "true":
        return None
    return x


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def norm_name(s: str) -> str:
    """Clé de rapprochement des noms entre sources (accents, tirets, particules)."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(orjson.dumps(data, option=orjson.OPT_NON_STR_KEYS))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
