"""
places.py — Cliente Google Places API (New) Nearby Search.

Nearby Search busca por tipo dentro de un radio geográfico — sin límite de
20 resultados globales, ya que cada punto cubre un área pequeña.
El servidor (GitHub Actions) usa headers X-Goog-* directamente (sin CORS).
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
    PLACES_MAX_RESULTS,
)

log = logging.getLogger("comercio_google.places")


class PlacesError(Exception):
    pass


def search_nearby(
    lat: float,
    lng: float,
    radius_m: int,
    included_types: list[str],
    label: str = "",
) -> list[dict]:
    """
    Nearby Search para una posición + radio + lista de tipos Google Places.
    Devuelve lista plana de place dicts (Places API New format).

    Nota: Nearby Search no soporta paginación — devuelve hasta 20 resultados.
    El radio debe ser suficientemente pequeño para que no haya más de 20
    establecimientos del tipo buscado en el área.
    """
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

    headers = {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
    }

    for attempt in range(5):
        try:
            resp = requests.post(
                PLACES_NEARBY_URL,
                json=body,
                headers=headers,
                timeout=30,
            )

            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", "60"))
                log.warning(
                    "Rate limit (intento %d/5) — esperando %ds",
                    attempt + 1, wait,
                )
                time.sleep(wait)
                continue  # reintento no recursivo

            resp.raise_for_status()
            data = resp.json()
            places = data.get("places", [])
            log.debug(
                "  Nearby %s r=%dm types=%s → %d resultados",
                label, radius_m, included_types, len(places),
            )
            return places

        except requests.HTTPError as exc:
            log.error("  HTTP error Nearby %s types=%s: %s", label, included_types, exc)
            return []
        except requests.RequestException as exc:
            log.error("  Red error Nearby %s: %s", label, exc)
            return []

    log.error("  Máx reintentos alcanzado para %s types=%s — saltando", label, included_types)
    return []
