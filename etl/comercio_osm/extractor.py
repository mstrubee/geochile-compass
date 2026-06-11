"""
extractor.py — Extrae todos los POIs comerciales de Chile desde Overpass,
normaliza con el catálogo de marcas y devuelve registros listos para la DB.

Cada registro es un dict que mapea directamente a la tabla comercio_poi.
"""

from __future__ import annotations

import logging
import unicodedata
from typing import Any

from . import catalog, overpass
from .config import CATEGORY_DEFAULTS, CATEGORY_TAG_MAP

log = logging.getLogger("comercio_osm.extractor")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clean(text: str | None) -> str | None:
    """Normaliza espacios y elimina caracteres de control."""
    if not text:
        return None
    cleaned = " ".join(text.split())
    return cleaned if cleaned else None


def _best_name(tags: dict) -> str | None:
    """Elige el mejor nombre para el registro: name:es → name → brand."""
    return (
        _clean(tags.get("name:es"))
        or _clean(tags.get("name"))
        or _clean(tags.get("brand"))
        or _clean(tags.get("official_name"))
    )


def _build_address(tags: dict) -> str | None:
    """Construye una dirección legible desde los tags OSM addr:*."""
    parts = []
    street = _clean(tags.get("addr:street"))
    number = _clean(tags.get("addr:housenumber"))
    if street:
        parts.append(f"{street} {number}" if number else street)
    city = _clean(tags.get("addr:city") or tags.get("addr:suburb"))
    if city:
        parts.append(city)
    return ", ".join(parts) if parts else None


def _extract_region_info(tags: dict) -> tuple[str | None, str | None]:
    """Extrae (comuna, region) desde los tags OSM."""
    commune = _clean(
        tags.get("addr:city")
        or tags.get("addr:municipality")
        or tags.get("is_in:municipality")
    )
    region = _clean(
        tags.get("addr:state")
        or tags.get("is_in:state")
        or tags.get("addr:region")
    )
    return commune, region


def _infer_categoria_from_tags(tags: dict) -> str | None:
    """
    Si el catálogo no reconoció la marca, intenta asignar una categoría
    a partir de los tags OSM directamente (fallback).
    """
    shop    = tags.get("shop", "")
    amenity = tags.get("amenity", "")

    mapping = {
        "supermarket":          "supermercado",
        "wholesale":            "supermercado",
        "convenience":          "conveniencia",
        "pharmacy":             "farmacia",
        "fuel":                 "combustible",
        "doityourself":         "mejoramiento_hogar",
        "hardware":             "mejoramiento_hogar",
        "building_materials":   "mejoramiento_hogar",
        "trade":                "mejoramiento_hogar",
        "department_store":     "retail_departamental",
        "clothes":              "retail_departamental",
        "fashion":              "retail_departamental",
        "general":              "retail_departamental",
        "bank":                 "banco",
        "atm":                  "banco",
        "fast_food":            "restaurante",
        "restaurant":           "restaurante",
        "cafe":                 "restaurante",
        "ice_cream":            "restaurante",
        "mall":                 "centro_comercial",
    }

    for val in (shop, amenity):
        if val in mapping:
            return mapping[val]

    if tags.get("building") == "mall":
        return "centro_comercial"

    return None


def _osm_element_to_record(
    el: dict,
    forced_categoria: str | None = None,
) -> dict[str, Any] | None:
    """
    Convierte un elemento crudo de Overpass en un registro para comercio_poi.
    Devuelve None si no se puede extraer posición o la categoría no aplica.
    """
    coords = overpass.element_coords(el)
    if coords is None:
        return None

    lat, lng = coords
    tags     = el.get("tags", {})
    osm_type = el["type"]
    osm_id   = f"{osm_type[0]}{el['id']}"   # n123, w456, r789

    # ── Normalización de marca ──────────────────────────────────────────────
    brand_entry = catalog.apply_catalog(tags)

    if brand_entry:
        categoria    = brand_entry["categoria"]
        subcategoria = brand_entry.get("subcategoria")
        marca_est    = brand_entry["marca_estandar"]
        cadena       = brand_entry.get("cadena")
    else:
        # Fallback: inferir categoría desde los tags pero no asignar marca
        categoria = forced_categoria or _infer_categoria_from_tags(tags)
        if not categoria:
            return None
        subcategoria = None
        marca_est    = None
        cadena       = None

    nombre   = _best_name(tags)
    if not nombre and not marca_est:
        return None  # sin nombre y sin marca → descartamos

    return {
        "osm_id":           osm_id,
        "osm_type":         osm_type,
        "nombre":           nombre,
        "marca":            _clean(tags.get("brand") or tags.get("operator")),
        "marca_estandar":   marca_est,
        "categoria":        categoria,
        "subcategoria":     subcategoria,
        "cadena":           cadena,
        "direccion":        _build_address(tags),
        "comuna":           _clean(tags.get("addr:city") or tags.get("addr:municipality")),
        "region":           _clean(tags.get("addr:state") or tags.get("is_in:state")),
        "codigo_region":    None,   # se puede enriquecer en el sync con una tabla de regiones
        "latitud":          lat,
        "longitud":         lng,
        "tags":             tags,   # guardamos el snapshot completo como JSONB
        "fuente":           "osm",
        "osm_version":      el.get("version"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# API pública del módulo
# ─────────────────────────────────────────────────────────────────────────────

def extract_all() -> list[dict[str, Any]]:
    """
    Extrae todos los POIs comerciales de Chile para todas las categorías
    definidas en CATEGORY_TAG_MAP.

    Devuelve una lista de registros normalizados y deduplicados por osm_id.
    """
    seen_ids:  set[str]          = set()
    all_recs:  list[dict]        = []
    stats:     dict[str, int]    = {}

    for categoria, tag_filters in CATEGORY_TAG_MAP.items():
        log.info("── Categoría: %s ─────────────────────", categoria)
        try:
            elements = overpass.fetch_category(tag_filters, categoria)
        except overpass.OverpassError as e:
            log.error("  ✗ Error Overpass para '%s': %s", categoria, e)
            continue

        cat_count = 0
        for el in elements:
            rec = _osm_element_to_record(el, forced_categoria=categoria)
            if rec is None:
                continue

            osm_id = rec["osm_id"]
            if osm_id in seen_ids:
                # El elemento ya fue capturado por otra query (tag solapado)
                continue

            seen_ids.add(osm_id)
            all_recs.append(rec)
            cat_count += 1

        stats[categoria] = cat_count
        log.info("  → %d registros únicos para '%s'", cat_count, categoria)

    log.info("═══ Total extraído: %d registros únicos ═══", len(all_recs))
    for cat, n in sorted(stats.items(), key=lambda x: -x[1]):
        log.info("    %-25s %5d", cat, n)

    return all_recs
