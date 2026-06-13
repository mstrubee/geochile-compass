"""
places.py — Cliente Google Places API (New).

Rate limiting centralizado aquí: todo request pasa por _throttle(),
que garantiza MIN_INTERVAL segundos entre llamadas midiendo tiempo real
con monotonic(). Más preciso que sleep fijo en el caller porque descuenta
el tiempo que tardó la respuesta anterior.

  MIN_INTERVAL = 0.25s → 4 req/s
  5 949 requests × 0.75s (throttle + red) ≈ 74 min < 90 min timeout
  Backoff exponencial en 429: 5s → 10s → 20s → 40s (máx 4 intentos)
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from .config import (
    GOOGLE_API_KEY,
    FIELD_MASK,
    PLACES_NEARBY_URL,
    PLACES_TEXT_URL,
    PLACES_MAX_RESULTS,
)

log = logging.getLogger("comercio_google.places")

# ─────────────────────────────────────────────────────────────────────────────
# Rate limiter de módulo
# ─────────────────────────────────────────────────────────────────────────────

MIN_INTERVAL = 0.25   # segundos mínimos entre requests (4 req/s)
_last_call: float = 0.0


def _throttle() -> None:
    global _last_call
    gap = time.monotonic() - _last_call
    if gap < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - gap)
    _last_call = time.monotonic()


# ─────────────────────────────────────────────────────────────────────────────
# HTTP helper compartido
# ─────────────────────────────────────────────────────────────────────────────

def _post(url: str, body: dict, label: str = "") -> dict:
    """
    POST a la Places API con throttle y backoff exponencial en 429.
    Devuelve el JSON completo de la respuesta, o {} en caso de error.
    """
    headers = {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
    }
    backoff = 5.0
    for attempt in range(4):
        _throttle()
        try:
            resp = requests.post(url, json=body, headers=headers, timeout=30)

            if resp.status_code == 429:
                wait = float(resp.headers.get("Retry-After", backoff))
                log.warning("429 [%s] — esperando %.0fs (intento %d/4)", label, wait, attempt + 1)
                time.sleep(wait)
                backoff = min(backoff * 2, 60.0)
                continue

            resp.raise_for_status()
            return resp.json()

        except requests.HTTPError as exc:
            log.error("HTTP %s [%s]: %s",
                      exc.response.status_code if exc.response is not None else "?",
                      label, exc)
            return {}
        except requests.RequestException as exc:
            log.error("Red error [%s]: %s", label, exc)
            return {}

    log.error("Máx reintentos alcanzado [%s] — saltando", label)
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# Nearby Search
# ─────────────────────────────────────────────────────────────────────────────

def search_nearby(
    lat: float,
    lng: float,
    radius_m: int,
    included_types: list[str],
    label: str = "",
) -> list[dict]:
    """Nearby Search; devuelve hasta 20 places. Sin paginación (límite de la API)."""
    body: dict[str, Any] = {
        "includedTypes":   included_types,
        "maxResultCount":  PLACES_MAX_RESULTS,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius_m),
            }
        },
        "languageCode": "es",
    }
    return _post(PLACES_NEARBY_URL, body, label).get("places", [])


# ─────────────────────────────────────────────────────────────────────────────
# Text Search (con soporte de paginación)
# ─────────────────────────────────────────────────────────────────────────────

def search_text(
    query: str,
    rectangle: dict,
    page_token: str | None = None,
) -> tuple[list[dict], str | None]:
    """
    Text Search para una marca + bounding box.
    Retorna (places, next_page_token).

    rectangle = {"low": {"latitude": ..., "longitude": ...},
                 "high": {"latitude": ..., "longitude": ...}}

    Nota: Text Search requiere locationRestriction.rectangle —
    no acepta .circle (exclusivo de Nearby Search).
    """
    body: dict[str, Any] = {
        "textQuery":      query,
        "maxResultCount": PLACES_MAX_RESULTS,
        "locationRestriction": {"rectangle": rectangle},
        "languageCode":   "es",
    }
    if page_token:
        body["pageToken"] = page_token

    data = _post(PLACES_TEXT_URL, body, query)
    return data.get("places", []), data.get("nextPageToken")
