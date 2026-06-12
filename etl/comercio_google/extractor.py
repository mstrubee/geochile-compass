"""
extractor.py — Convierte resultados de Google Places API en registros
para la tabla comercio_poi, reutilizando el catálogo de marcas del módulo OSM.

Mapeo de campos:
  osm_id      → "gp_{google_place_id}"  (prefijo que distingue de OSM)
  osm_type    → "google"
  fuente      → "google"
  tags (JSONB)→ {"google_place_id": ..., "types": [...], "primary_type": ...}
"""

from __future__ import annotations

import logging
from typing import Any

# Reutiliza el catálogo de marcas: mismas reglas, mismo Admin, sin duplicar código.
# Funciona porque Python 3.3+ soporta namespace packages (no necesita etl/__init__.py).
from etl.comercio_osm import catalog

from . import places as places_api
from .config import BRAND_SEARCHES, GOOGLE_TYPE_CATEGORY

log = logging.getLogger("comercio_google.extractor")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _infer_category(types: list[str]) -> str | None:
    """Infiere categoría interna desde los tipos Google Places."""
    for t in types:
        if t in GOOGLE_TYPE_CATEGORY:
            return GOOGLE_TYPE_CATEGORY[t]
    return None


def _parse_address(components: list[dict]) -> tuple[str | None, str | None]:
    """
    Extrae (comuna, region) desde addressComponents de Google Places.
    Prioridad: locality > administrative_area_level_3 para la comuna.
    """
    commune: str | None = None
    region:  str | None = None

    for comp in components:
        comp_types = comp.get("types", [])
        name       = comp.get("longText") or comp.get("long_name") or ""
        if not name:
            continue
        if "locality" in comp_types and not commune:
            commune = name
        elif "administrative_area_level_3" in comp_types and not commune:
            commune = name
        elif "administrative_area_level_1" in comp_types and not region:
            region = name

    return commune or None, region or None


# ─────────────────────────────────────────────────────────────────────────────
# Conversión de un lugar Google → registro comercio_poi
# ─────────────────────────────────────────────────────────────────────────────

def _place_to_record(
    place: dict,
    forced_categoria: str | None = None,
) -> dict[str, Any] | None:
    """
    Convierte un dict de Google Places en un registro para comercio_poi.
    Devuelve None si faltan datos mínimos (sin posición o sin categoría).
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
    # catalog.apply_catalog espera tags OSM; construimos un dict sintético.
    synthetic_tags = {
        "name":  display_name,
        "brand": display_name,   # también como tag brand para mayor coverage
    }
    brand_entry = catalog.apply_catalog(synthetic_tags)

    if brand_entry:
        categoria    = brand_entry["categoria"]
        subcategoria = brand_entry.get("subcategoria") or None
        marca_est    = brand_entry["marca_estandar"]
        cadena       = brand_entry.get("cadena") or None
    else:
        categoria    = forced_categoria or _infer_category(types)
        if not categoria:
            return None   # sin categoría → no importa
        subcategoria = None
        marca_est    = "Otros"
        cadena       = None

    if not display_name and not marca_est:
        return None

    return {
        # El prefijo "gp_" distingue IDs de Google de IDs de OSM (n/w/r).
        # Esto permite que la lógica de soft-delete elimine los registros OSM
        # automáticamente en el primer sync de Google (no coinciden por ID).
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
    Extrae todos los POIs comerciales de Chile desde Google Places API.

    Estrategia: Text Search por cada marca/cadena en BRAND_SEARCHES.
    Deduplicación por google_place_id para evitar que una misma sucursal
    aparezca en múltiples búsquedas (ej. "Jumbo" y "Cencosud").
    """
    seen_ids: set[str]       = set()
    all_recs: list[dict]     = []
    stats:    dict[str, int] = {}

    for query, fallback_cat in BRAND_SEARCHES:
        log.info("── Buscando: %s", query)
        try:
            raw_places = places_api.search_brand(query)
        except Exception as exc:
            log.error("  ✗ Error en búsqueda '%s': %s", query, exc)
            continue

        nuevos = 0
        for place in raw_places:
            rec = _place_to_record(place, forced_categoria=fallback_cat)
            if rec is None:
                continue

            pid = rec["osm_id"]
            if pid in seen_ids:
                continue   # ya capturado por otra búsqueda

            seen_ids.add(pid)
            all_recs.append(rec)
            cat = rec["categoria"]
            stats[cat] = stats.get(cat, 0) + 1
            nuevos += 1

        log.info("  → %d nuevos únicos", nuevos)

    log.info("═══ Total extraído: %d registros únicos ═══", len(all_recs))
    for cat, n in sorted(stats.items(), key=lambda x: -x[1]):
        log.info("    %-25s %5d", cat, n)

    return all_recs
