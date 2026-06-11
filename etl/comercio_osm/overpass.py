"""
overpass.py — Cliente robusto para la Overpass API con reintentos y fallback de mirrors.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from .config import (
    OVERPASS_ENDPOINTS,
    OVERPASS_MAX_RETRIES,
    OVERPASS_RETRY_WAIT,
    OVERPASS_TIMEOUT_S,
)

log = logging.getLogger("comercio_osm.overpass")


class OverpassError(Exception):
    pass


def _build_chile_area_query(tag_filters: list[tuple[str, str]]) -> str:
    """
    Construye una consulta Overpass QL para buscar elementos en Chile
    por uno o más pares (tag_key, tag_value).

    El área de Chile se filtra por bbox continental para mayor velocidad
    y compatibilidad (evita problemas con la query area["ISO3166-1"="CL"]).
    """
    # Bbox Chile continental + Isla de Pascua: Sur, Oeste, Norte, Este
    bbox = "(-56,-76,-17,-65)"

    lines: list[str] = []
    for key, val in tag_filters:
        for osm_type in ("node", "way", "relation"):
            lines.append(f'  {osm_type}["{key}"="{val}"]{bbox};')

    filters_block = "\n".join(lines)

    query = (
        "[out:json]"
        f"[timeout:{OVERPASS_TIMEOUT_S}]"
        "[maxsize:1073741824];\n"
        "(\n"
        f"{filters_block}\n"
        ");\n"
        "out center tags;"
    )
    return query


def query(ql: str) -> list[dict[str, Any]]:
    """
    Ejecuta una consulta Overpass QL y devuelve la lista de elementos.
    Intenta cada endpoint en OVERPASS_ENDPOINTS antes de fallar.
    """
    last_error: Exception | None = None

    for attempt in range(OVERPASS_MAX_RETRIES):
        endpoint = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        log.debug("Overpass request → %s (intento %d)", endpoint, attempt + 1)
        try:
            resp = requests.post(
                endpoint,
                data={"data": ql},
                timeout=OVERPASS_TIMEOUT_S + 30,
                headers={"User-Agent": "geochile-compass-etl/1.0"},
            )
            if resp.status_code == 429:
                log.warning("Rate limit en %s — esperando %ds", endpoint, OVERPASS_RETRY_WAIT * 2)
                time.sleep(OVERPASS_RETRY_WAIT * 2)
                continue
            resp.raise_for_status()
            data = resp.json()
            elements: list[dict] = data.get("elements", [])
            log.info("  ✓ %d elementos recibidos desde %s", len(elements), endpoint)
            return elements

        except requests.exceptions.Timeout:
            log.warning("Timeout en %s (intento %d/%d)", endpoint, attempt + 1, OVERPASS_MAX_RETRIES)
            last_error = OverpassError(f"Timeout en {endpoint}")
        except requests.exceptions.HTTPError as e:
            log.warning("HTTP %s en %s: %s", e.response.status_code, endpoint, e)
            last_error = e
        except Exception as e:
            log.warning("Error inesperado en %s: %s", endpoint, e)
            last_error = e

        if attempt < OVERPASS_MAX_RETRIES - 1:
            log.info("  Reintentando en %ds…", OVERPASS_RETRY_WAIT)
            time.sleep(OVERPASS_RETRY_WAIT)

    raise OverpassError(f"Todos los intentos fallaron. Último error: {last_error}")


def fetch_category(tag_filters: list[tuple[str, str]], category_name: str) -> list[dict]:
    """
    Extrae todos los POIs de Chile para los tag_filters dados.
    Retorna la lista cruda de elementos OSM.
    """
    log.info("Extrayendo categoría: %s (%d filtros)", category_name, len(tag_filters))
    ql = _build_chile_area_query(tag_filters)
    log.debug("Query:\n%s", ql)
    elements = query(ql)
    log.info("  → %d elementos para '%s'", len(elements), category_name)
    return elements


def element_coords(el: dict) -> tuple[float, float] | None:
    """
    Extrae (lat, lng) de un elemento OSM (node, way con center, relation con center).
    Devuelve None si no hay coordenadas.
    """
    if el["type"] == "node":
        if "lat" in el and "lon" in el:
            return float(el["lat"]), float(el["lon"])
    else:
        center = el.get("center", {})
        if center.get("lat") and center.get("lon"):
            return float(center["lat"]), float(center["lon"])
    return None
