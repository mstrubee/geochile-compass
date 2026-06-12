"""
places.py — Cliente Google Places API (New) Text Search.

Nota: Este ETL corre en GitHub Actions (servidor), no en el browser.
Los headers X-Goog-* NO generan problemas CORS en este contexto.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from .config import (
    GOOGLE_API_KEY,
    FIELD_MASK,
    PLACES_SEARCH_URL,
    PLACES_MAX_RESULTS,
)

log = logging.getLogger("comercio_google.places")


class PlacesError(Exception):
    pass


def _text_search_page(query: str, page_token: str | None = None) -> dict:
    """
    Una sola llamada a Places API Text Search.
    Maneja rate-limit (429) con espera automática.
    """
    body: dict[str, Any] = {
        "textQuery":      query,
        "maxResultCount": PLACES_MAX_RESULTS,
        # Bounding box Chile continental + Isla de Pascua
        "locationBias": {
            "rectangle": {
                "low":  {"latitude": -56.0, "longitude": -76.0},
                "high": {"latitude": -17.5, "longitude": -65.5},
            }
        },
        "languageCode": "es",
        "regionCode":   "CL",
    }
    if page_token:
        body["pageToken"] = page_token

    headers = {
        "Content-Type":    "application/json",
        "X-Goog-Api-Key":  GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
    }

    resp = requests.post(PLACES_SEARCH_URL, json=body, headers=headers, timeout=30)

    if resp.status_code == 429:
        wait = int(resp.headers.get("Retry-After", "30"))
        log.warning("Rate limit — esperando %ds antes de reintentar", wait)
        time.sleep(wait)
        return _text_search_page(query, page_token)

    resp.raise_for_status()
    return resp.json()


def search_brand(query: str) -> list[dict]:
    """
    Busca todos los locales en Chile para una query de marca usando
    Text Search con paginación completa.

    Devuelve lista plana de dicts de lugares (Places API New format).
    """
    all_places: list[dict] = []
    page_token: str | None = None
    page_num = 0

    while True:
        page_num += 1
        try:
            data = _text_search_page(query, page_token)
        except requests.HTTPError as exc:
            log.error("  HTTP error para '%s' (pág %d): %s", query, page_num, exc)
            break
        except requests.RequestException as exc:
            log.error("  Error de red para '%s': %s", query, exc)
            break

        batch = data.get("places", [])
        all_places.extend(batch)
        log.debug("  '%s' pág %d: %d resultados (acum: %d)", query, page_num, len(batch), len(all_places))

        page_token = data.get("nextPageToken")
        if not page_token or not batch:
            break  # sin más páginas

        time.sleep(0.3)  # cortesía con la API entre páginas

    log.info("  → '%s': %d locales", query, len(all_places))
    return all_places
