"""
extractor.py — Extrae POIs comerciales desde Google Places API (Nearby Search).

Estrategia:
  Para cada punto de la grilla × cada categoría:
    → Nearby Search con radio calibrado (nunca >20 resultados del mismo tipo)
    → Normalización de marca via catálogo OSM (mismas reglas, sin duplicar)
    → Deduplicación por google_place_id

Mapeo de IDs:
  osm_id   = "gp_{google_place_id}"   (prefijo distingue de OSM n/w/r)
  osm_type = "google"
  fuente   = "google"
"""

from __future__ import annotations

import logging
import time
from typing import Any

# Reutiliza el catálogo del módulo OSM (namespace packages Python 3.3+)
from etl.comercio_osm import catalog

from . import places as places_api
from .config import CATEGORY_TYPES, CHILE_GRID, GOOGLE_TYPE_CATEGORY

log = logging.getLogger("comercio_google.extractor")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _infer_category(types: list[str]) -> str | None:
    for t in types:
        if t in GOOGLE_TYPE_CATEGORY:
            return GOOGLE_TYPE_CATEGORY[t]
    return None


def _parse_address(components: list[dict]) -> tuple[str | None, str | None]:
    """Extrae (comuna, region) desde addressComponents."""
    commune: str | None = None
    region:  str | None = None
    for comp in components:
        comp_types = comp.get("types", [])
        name = comp.get("longText") or comp.get("long_name") or ""
        if not name:
            continue
        if ("locality" in comp_types or "administrative_area_level_3" in comp_types) and not commune:
            commune = name
        elif "administrative_area_level_1" in comp_types and not region:
            region = name
    return commune or None, region or None


def _place_to_record(
    place: dict,
    forced_categoria: str | None = None,
) -> dict[str, Any] | None:
    """
    Convierte un dict de Google Places en un registro para comercio_poi.
    Devuelve None si faltan coordenadas o no se puede asignar categoría.
    """
    place_id = place.get("id")
    if not place_id:
        return None

    location = place.get("location", {})
    lat = location.get("latitude")
    lng = location.get("longitude")
    if lat is None or lng is None:
        return None

    display_name: str = (
        place.get("displayName", {}).get("text", "")
        or place.get("name", "")
    ).strip()

    short_address = (place.get("shortFormattedAddress") or "").strip() or None
    types         = place.get("types") or []
    primary_type  = place.get("primaryType") or ""
    addr_comps    = place.get("addressComponents") or []

    commune, region = _parse_address(addr_comps)

    # ── Normalización de marca via catálogo ───────────────────────────────────
    synthetic_tags = {"name": display_name, "brand": display_name}
    brand_entry = catalog.apply_catalog(synthetic_tags)

    if brand_entry:
        categoria    = brand_entry["categoria"]
        subcategoria = brand_entry.get("subcategoria") or None
        marca_est    = brand_entry["marca_estandar"]
        cadena       = brand_entry.get("cadena") or None
    else:
        categoria    = forced_categoria or _infer_category(types)
        if not categoria:
            return None
        subcategoria = None
        marca_est    = "Otros"
        cadena       = None

    if not display_name and not marca_est:
        return None

    return {
        "osm_id":         f"gp_{place_id}",
        "osm_type":       "google",
        "nombre":         display_name or None,
        "marca":          display_name or None,
        "marca_estandar": marca_est,
        "categoria":      categoria,
        "subcategoria":   subcategoria,
        "cadena":         cadena,
        "direccion":      short_address,
        "comuna":         commune,
        "region":         region,
        "codigo_region":  None,
        "latitud":        lat,
        "longitud":       lng,
        "tags": {
            "google_place_id": place_id,
            "types":           types,
            "primary_type":    primary_type,
        },
        "fuente":         "google",
        "osm_version":    None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Extracción completa
# ─────────────────────────────────────────────────────────────────────────────

def extract_all() -> list[dict[str, Any]]:
    """
    Extrae todos los POIs comerciales de Chile:
      Para cada punto de CHILE_GRID × cada categoría en CATEGORY_TYPES
      → Nearby Search → normalizar → deduplicar por google_place_id

    Retorna lista de registros listos para upsert en comercio_poi.
    """
    seen_ids: set[str]       = set()
    all_recs: list[dict]     = []
    stats:    dict[str, int] = {}

    total_points = len(CHILE_GRID)
    total_cats   = len(CATEGORY_TYPES)
    log.info("Grilla: %d puntos × %d categorías = %d requests estimados",
             total_points, total_cats, total_points * total_cats)

    for idx, (lat, lng, radius, label) in enumerate(CHILE_GRID, 1):
        log.info("── [%d/%d] %s (r=%dm)", idx, total_points, label, radius)
        punto_nuevos = 0

        for categoria, types in CATEGORY_TYPES.items():
            raw_places = places_api.search_nearby(lat, lng, radius, types, label)

            for place in raw_places:
                rec = _place_to_record(place, forced_categoria=categoria)
                if rec is None:
                    continue

                pid = rec["osm_id"]
                if pid in seen_ids:
                    continue  # ya capturado por otro punto de la grilla

                seen_ids.add(pid)
                all_recs.append(rec)
                cat = rec["categoria"]
                stats[cat] = stats.get(cat, 0) + 1
                punto_nuevos += 1

            # throttle gestionado en places._throttle() — no sleep aquí

        log.info("  → %d nuevos únicos en %s", punto_nuevos, label)

    log.info("═══ Total extraído: %d registros únicos ═══", len(all_recs))
    for cat, n in sorted(stats.items(), key=lambda x: -x[1]):
        log.info("    %-25s %5d", cat, n)

    return all_recs
