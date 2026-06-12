"""
supplement.py — Text Search suplemento para cadenas comerciales con alta densidad.

Problema que resuelve
─────────────────────
El Nearby Search retorna hasta 20 resultados MIXTOS por punto (p. ej. 20
farmacias de cualquier marca). En corredores densos, las 20 posiciones se
llenan con marcas variadas y sucursales de Cruz Verde / Copec / BancoEstado
quedan fuera del top-20.

El Text Search busca una sola marca ("Cruz Verde") dentro de un radio, por
lo que el cap de 20 afecta únicamente a Cruz Verde. Con ≤1 sucursal Cruz Verde
por km², incluso a 7 km de radio se esperan ≤50 resultados → nunca se satura.
Paginando hasta 3 páginas (60 resultados máx) capturamos el 100% en cada zona.

Zonas de búsqueda
─────────────────
• DENSE_ZONES  — sectores del Gran Santiago (7 km) + RM periférica (20 km)
                 + Gran Valparaíso (7 km) + Gran Concepción (7 km)
                 Usadas solo para marcas "dense" (>300 locales nacionales)

• REGIONAL_ZONES — ciudades de provincia con radio 8-20 km
                   Usadas para TODAS las marcas (dense y standard)

Costo estimado
──────────────
  17 DENSE_ZONES × 11 marcas dense × 2 págs. prom. = 374 requests
  40 REGIONAL_ZONES × 21 marcas × 1.2 págs. prom. = 1 008 requests
  ──────────────────────────────────────────────────────────────────
  Total ≈ 1 382 Text Search requests × $0.035 = USD $48 / sync trimestral
  Grand total con Nearby Search: USD $238 / sync = USD $952 / año
  Margen frente al crédito gratis ($2 400 / año): USD $1 448
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from etl.comercio_osm import catalog
from .config import GOOGLE_API_KEY, FIELD_MASK, PLACES_TEXT_URL
from . import extractor as _extractor

log = logging.getLogger("comercio_google.supplement")

# ─────────────────────────────────────────────────────────────────────────────
# Catálogo de marcas a suplementar
# ─────────────────────────────────────────────────────────────────────────────

# Cada entrada:
#   query        → texto que se envía a Text Search
#   marca        → marca_estandar esperada según catálogo OSM
#   cat          → categoría interna (para fallback si catálogo no reconoce)
#   dense        → True = busca en DENSE_ZONES + REGIONAL_ZONES
#                  False = solo REGIONAL_ZONES
#   name_hint    → subcadena (lower) que DEBE aparecer en el displayName
#                  para evitar falsos positivos. None = sin filtro extra.

BRANDS: list[dict] = [
    # ── Muy densas (>300 locales) — buscan en zonas metro Y regiones ─────────
    {
        "query": "Cruz Verde farmacia",
        "marca": "Cruz Verde",
        "cat":   "farmacia",
        "dense": True,
        "name_hint": "cruz verde",
    },
    {
        "query": "Salcobrand farmacia",
        "marca": "Salcobrand",
        "cat":   "farmacia",
        "dense": True,
        "name_hint": "salcobrand",
    },
    {
        "query": "Farmacias Ahumada",
        "marca": "Ahumada",
        "cat":   "farmacia",
        "dense": True,
        "name_hint": "ahumada",
    },
    {
        "query": "Doctor Simi farmacia",
        "marca": "Dr. Simi",
        "cat":   "farmacia",
        "dense": True,
        "name_hint": "simi",
    },
    {
        "query": "Copec bencinera",
        "marca": "Copec",
        "cat":   "combustible",
        "dense": True,
        "name_hint": "copec",
    },
    {
        "query": "Shell bencinera",
        "marca": "Shell",
        "cat":   "combustible",
        "dense": True,
        "name_hint": "shell",
    },
    {
        "query": "Aramco bencinera",
        "marca": "Aramco",
        "cat":   "combustible",
        "dense": True,
        "name_hint": "aramco",
    },
    {
        "query": "Unimarc supermercado",
        "marca": "Unimarc",
        "cat":   "supermercado",
        "dense": True,
        "name_hint": "unimarc",
    },
    {
        "query": "Santa Isabel supermercado",
        "marca": "Santa Isabel",
        "cat":   "supermercado",
        "dense": True,
        "name_hint": "santa isabel",
    },
    {
        "query": "BancoEstado",
        "marca": "BancoEstado",
        "cat":   "banco",
        "dense": True,
        "name_hint": None,  # también captura "Caja Vecina", "ServiEstado"
    },
    {
        "query": "Pronto Copec",
        "marca": "Pronto Copec",
        "cat":   "conveniencia",
        "dense": True,
        "name_hint": "pronto",
    },
    # ── Estándar (100-300 locales) — solo REGIONAL_ZONES ─────────────────────
    {
        "query": "OXXO tienda",
        "marca": "OXXO",
        "cat":   "conveniencia",
        "dense": False,
        "name_hint": "oxxo",
    },
    {
        "query": "Little Caesars pizza",
        "marca": "Little Caesars",
        "cat":   "restaurante",
        "dense": False,
        "name_hint": "little caesars",
    },
    {
        "query": "Lider supermercado",
        "marca": "Lider",
        "cat":   "supermercado",
        "dense": False,
        "name_hint": "lider",
    },
    {
        "query": "Ferretería Imperial",
        "marca": "Imperial",
        "cat":   "mejoramiento_hogar",
        "dense": False,
        "name_hint": "imperial",
    },
    {
        "query": "Banco Santander Chile",
        "marca": "Santander",
        "cat":   "banco",
        "dense": False,
        "name_hint": "santander",
    },
    {
        "query": "Super 10 supermercado",
        "marca": "Super 10",
        "cat":   "supermercado",
        "dense": False,
        "name_hint": "super 10",
    },
    {
        "query": "Knop Labomed farmacia",
        "marca": "Knop Labomed",
        "cat":   "farmacia",
        "dense": False,
        "name_hint": "knop",
    },
    {
        "query": "BCI banco",
        "marca": "BCI",
        "cat":   "banco",
        "dense": False,
        "name_hint": "bci",
    },
    {
        "query": "Banco de Chile",
        "marca": "Banco de Chile",
        "cat":   "banco",
        "dense": False,
        "name_hint": "banco de chile",
    },
    {
        "query": "McDonald's restaurante",
        "marca": "McDonald's",
        "cat":   "restaurante",
        "dense": False,
        "name_hint": "mcdonald",
    },
]

# ─────────────────────────────────────────────────────────────────────────────
# Zonas de búsqueda
# ─────────────────────────────────────────────────────────────────────────────
# Formato: (lat, lng, radius_m, label)

# Gran Santiago: 7 sectores urbanos a 7 km + 4 sectores periféricos a 20 km.
# A 7 km y densidad Cruz Verde ~0.34/km²: ~52 por círculo → bajo el cap de 60.
# Los solapamientos entre sectores garantizan que ningún local quede fuera.
_SCL_URBAN = [
    (-33.22, -70.68,  7_000, "SCL Sup Norte"),
    (-33.33, -70.64,  7_000, "SCL Sup Centro"),
    (-33.38, -70.80,  7_000, "SCL Sup Poniente"),
    (-33.43, -70.55,  7_000, "SCL Sup Oriente"),
    (-33.48, -70.68,  7_000, "SCL Sup Centro-Sur"),
    (-33.55, -70.74,  7_000, "SCL Sup Sur Pte"),
    (-33.58, -70.58,  7_000, "SCL Sup Sur Ote"),
]
_SCL_PERIPHERY = [
    (-33.10, -70.72, 20_000, "SCL Sup Colina/Lampa"),
    (-33.68, -70.55, 20_000, "SCL Sup Pirque/SJM"),
    (-33.55, -71.30, 20_000, "SCL Sup Melipilla"),
    (-34.00, -70.80, 20_000, "SCL Sup Buin/Paine"),
]
_VPO = [
    (-33.05, -71.62,  7_000, "VPO Sup Valparaíso"),
    (-33.03, -71.55,  7_000, "VPO Sup Viña del Mar"),
    (-33.14, -71.51,  7_000, "VPO Sup Quilpué/V.Alemana"),
]
_CCP = [
    (-36.80, -73.06,  7_000, "CCP Sup Conce/Talcahuano"),
    (-36.91, -73.06,  7_000, "CCP Sup Chiguayante/S.Pedro"),
    (-36.93, -73.13,  7_000, "CCP Sup Coronel/Lota"),
]

DENSE_ZONES: list[tuple[float, float, int, str]] = (
    _SCL_URBAN + _SCL_PERIPHERY + _VPO + _CCP
)

# Ciudades de provincia — misma cobertura que el Nearby Search pero como
# Text Search específico por marca, así el cap de 20 no bloquea ninguna cadena.
# Ciudades dobles (N+S) se consolidan en un punto con radio mayor.
REGIONAL_ZONES: list[tuple[float, float, int, str]] = [
    # Valparaíso región (fuera del Gran Valparaíso)
    (-33.60, -71.62, 15_000, "San Antonio"),
    (-32.85, -71.50, 12_000, "Quillota / La Calera"),
    (-32.83, -70.75, 12_000, "Los Andes / San Felipe"),

    # Coquimbo / La Serena
    (-29.91, -71.26,  8_000, "La Serena"),
    (-29.97, -71.34,  8_000, "Coquimbo"),
    (-30.73, -71.20, 15_000, "Ovalle"),
    (-31.64, -71.07, 15_000, "Illapel"),

    # Atacama
    (-27.37, -70.33, 12_000, "Copiapó"),
    (-26.83, -70.15, 15_000, "Vallenar"),

    # Antofagasta (consolidado N+S)
    (-23.68, -70.40, 12_000, "Antofagasta"),
    (-22.46, -68.93, 12_000, "Calama"),

    # Tarapacá (consolidado N+S)
    (-20.24, -70.12, 10_000, "Iquique"),
    (-19.84, -69.95, 12_000, "Alto Hospicio"),

    # Arica (consolidado N+S)
    (-18.50, -70.31, 10_000, "Arica"),

    # O'Higgins (Rancagua consolidado)
    (-34.20, -70.74, 10_000, "Rancagua"),
    (-34.58, -71.00, 15_000, "San Fernando"),
    (-34.38, -71.40, 15_000, "Pichilemu / Santa Cruz"),

    # Maule
    (-35.46, -71.66, 10_000, "Talca"),
    (-34.98, -71.23,  8_000, "Curicó"),
    (-35.85, -71.60, 15_000, "Linares"),
    (-35.32, -71.61, 15_000, "Molina"),

    # Ñuble
    (-36.64, -72.10, 10_000, "Chillán"),

    # Biobío (fuera del Gran Concepción)
    (-37.10, -72.60, 12_000, "Los Ángeles"),
    (-37.62, -72.38, 15_000, "Mulchén"),

    # La Araucanía
    (-38.77, -72.60, 10_000, "Temuco"),
    (-38.91, -72.68,  8_000, "Padre Las Casas"),
    (-39.23, -72.33, 12_000, "Villarrica / Pucón"),
    (-37.80, -72.70, 15_000, "Angol"),
    (-38.43, -72.35, 15_000, "Victoria / Curacautín"),

    # Los Ríos
    (-39.85, -73.24, 10_000, "Valdivia"),
    (-40.29, -72.40, 15_000, "La Unión / Río Bueno"),

    # Los Lagos
    (-40.60, -73.13, 10_000, "Osorno"),
    (-41.50, -72.93, 10_000, "Puerto Montt"),
    (-41.31, -72.98,  8_000, "Puerto Varas"),
    (-42.48, -73.76, 15_000, "Castro (Chiloé)"),
    (-41.87, -73.95, 15_000, "Ancud (Chiloé)"),

    # Aysén
    (-45.57, -72.07, 15_000, "Coyhaique"),

    # Magallanes
    (-53.19, -70.92, 12_000, "Punta Arenas"),
    (-51.73, -72.50, 15_000, "Puerto Natales"),
]


# ─────────────────────────────────────────────────────────────────────────────
# API helper: Text Search con paginación
# ─────────────────────────────────────────────────────────────────────────────

def _text_search_page(
    query: str,
    lat: float,
    lng: float,
    radius_m: int,
    page_token: str | None = None,
) -> tuple[list[dict], str | None]:
    """
    Llama a Places Text Search para una marca + ubicación.
    Retorna (places, next_page_token).
    """
    body: dict[str, Any] = {
        "textQuery":      query,
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius_m),
            }
        },
        "languageCode": "es",
    }
    if page_token:
        body["pageToken"] = page_token

    headers = {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
    }

    try:
        resp = requests.post(PLACES_TEXT_URL, json=body, headers=headers, timeout=30)

        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", "30"))
            log.warning("Rate limit Text Search — esperando %ds", wait)
            time.sleep(wait)
            return _text_search_page(query, lat, lng, radius_m, page_token)

        resp.raise_for_status()
        data   = resp.json()
        places = data.get("places", [])
        return places, data.get("nextPageToken")

    except requests.RequestException as exc:
        log.error("  Error Text Search '%s' (%s,%s): %s", query, lat, lng, exc)
        return [], None


def _search_all_pages(
    query: str,
    lat: float,
    lng: float,
    radius_m: int,
    max_pages: int = 3,
) -> list[dict]:
    """Text Search con paginación (hasta max_pages × 20 = 60 resultados máx)."""
    all_places: list[dict] = []
    page_token: str | None = None

    for _ in range(max_pages):
        places, next_token = _text_search_page(query, lat, lng, radius_m, page_token)
        all_places.extend(places)

        # Si la página devuelve < 20 resultados, no hay página siguiente
        if not next_token or len(places) < 20:
            break

        page_token = next_token
        time.sleep(0.05)  # pausa mínima entre páginas de la misma búsqueda

    return all_places


# ─────────────────────────────────────────────────────────────────────────────
# Función principal
# ─────────────────────────────────────────────────────────────────────────────

def run_supplement(seen_ids: set[str]) -> list[dict[str, Any]]:
    """
    Ejecuta Text Search para cada marca en BRANDS y retorna los registros
    nuevos (place_id no visto en el Nearby Search).

    Args:
        seen_ids: conjunto de osm_id ("gp_{place_id}") ya capturados
                  por el Nearby Search. Usados para deduplicar.

    Returns:
        Lista de registros nuevos listos para upsert en comercio_poi.
    """
    new_records: list[dict] = []
    local_seen:  set[str]   = set()  # dedup dentro del propio suplemento

    dense_brands    = [b for b in BRANDS if b["dense"]]
    standard_brands = [b for b in BRANDS if not b["dense"]]

    log.info(
        "Suplemento Text Search: %d marcas dense / %d standard  "
        "| %d DENSE_ZONES + %d REGIONAL_ZONES",
        len(dense_brands), len(standard_brands),
        len(DENSE_ZONES), len(REGIONAL_ZONES),
    )

    total_api_calls = 0

    # ── Marcas densas: buscan en todas las zonas ──────────────────────────────
    for brand in dense_brands:
        zones = DENSE_ZONES + REGIONAL_ZONES
        brand_new = 0
        brand_api = 0

        for lat, lng, radius, label in zones:
            places = _search_all_pages(brand["query"], lat, lng, radius)
            brand_api += 1  # mínimo 1 llamada (puede ser más con paginación)
            time.sleep(0.05)

            for place in places:
                rec = _record_if_valid(place, brand, seen_ids, local_seen)
                if rec:
                    local_seen.add(rec["osm_id"])
                    new_records.append(rec)
                    brand_new += 1

        total_api_calls += brand_api
        log.info(
            "  %-22s → %3d nuevos  (zonas=%d, calls≥%d)",
            brand["marca"], brand_new, len(zones), brand_api,
        )

    # ── Marcas estándar: solo REGIONAL_ZONES ─────────────────────────────────
    for brand in standard_brands:
        zones = REGIONAL_ZONES
        brand_new = 0
        brand_api = 0

        for lat, lng, radius, label in zones:
            places = _search_all_pages(brand["query"], lat, lng, radius)
            brand_api += 1
            time.sleep(0.05)

            for place in places:
                rec = _record_if_valid(place, brand, seen_ids, local_seen)
                if rec:
                    local_seen.add(rec["osm_id"])
                    new_records.append(rec)
                    brand_new += 1

        total_api_calls += brand_api
        log.info(
            "  %-22s → %3d nuevos  (zonas=%d, calls≥%d)",
            brand["marca"], brand_new, len(zones), brand_api,
        )

    log.info(
        "═══ Suplemento completado: %d registros nuevos  (~%d API calls) ═══",
        len(new_records), total_api_calls,
    )
    return new_records


# ─────────────────────────────────────────────────────────────────────────────
# Helpers internos
# ─────────────────────────────────────────────────────────────────────────────

def _record_if_valid(
    place: dict,
    brand: dict,
    seen_ids: set[str],
    local_seen: set[str],
) -> dict[str, Any] | None:
    """
    Convierte un place dict en registro si:
      1. No está ya en seen_ids ni local_seen (dedup)
      2. El displayName contiene el name_hint de la marca (evita falsos positivos)
      3. El catálogo OSM asigna la marca esperada, O la categoría coincide
         y el catálogo no reconoció otra marca (evita sobreescribir Salcobrand
         con "Cruz Verde" si ambos están en el radio)
    """
    place_id = place.get("id")
    if not place_id:
        return None

    osm_id = f"gp_{place_id}"
    if osm_id in seen_ids or osm_id in local_seen:
        return None

    # ── Filtro por nombre (evita falsos positivos) ────────────────────────────
    display_name: str = (
        place.get("displayName", {}).get("text", "")
        or place.get("name", "")
    ).strip().lower()

    hint = brand.get("name_hint")
    if hint and hint not in display_name:
        # El resultado no corresponde a esta marca — lo descartamos
        return None

    # ── Convertir a registro usando el pipeline estándar ─────────────────────
    rec = _extractor._place_to_record(place, forced_categoria=brand["cat"])
    if rec is None:
        return None

    # ── Verificar coherencia de marca ─────────────────────────────────────────
    marca_ok = rec["marca_estandar"] == brand["marca"]
    # Aceptar también si el catálogo no reconoció la marca (Otros) pero la
    # categoría es correcta Y el name_hint ya filtró el nombre del local.
    cat_ok  = (rec["marca_estandar"] == "Otros" and rec["categoria"] == brand["cat"])

    if not marca_ok and not cat_ok:
        # El catálogo asignó una marca distinta → falso positivo
        log.debug(
            "    Descartado (marca esperada '%s', obtenida '%s'): %s",
            brand["marca"], rec["marca_estandar"],
            place.get("displayName", {}).get("text", ""),
        )
        return None

    # Si el catálogo dijo "Otros" pero el name_hint coincide, asignar la marca
    # correcta para que no quede como Otros en la DB.
    if cat_ok and not marca_ok:
        rec["marca_estandar"] = brand["marca"]
        log.debug(
            "    Corrigiendo marca: 'Otros' → '%s' para '%s'",
            brand["marca"], place.get("displayName", {}).get("text", ""),
        )

    return rec
