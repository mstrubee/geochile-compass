"""
config.py — Configuración ETL Red Comercial Nacional → Google Places (New).

Estrategia: Nearby Search en grilla geográfica uniforme con radio 1km.

  A radio 1km nunca hay más de ~6-8 farmacias del mismo tipo en el área
  de búsqueda → el límite de 20 resultados de la API NUNCA se alcanza,
  garantizando captura completa de Cruz Verde, Salcobrand, Copec, etc.

  Grillas auto-generadas (2-3km de espaciado):
    Gran Santiago      418 pts  2km spacing  radio 1km
    Gran Valparaíso     99 pts  2km spacing  radio 1km
    Gran Concepción     90 pts  3km spacing  radio 1km
    Ciudades resto      54 pts  radio 6-20km (nunca saturan el cap)
    ─────────────────────────────────────────────────────
    TOTAL              661 pts  × 9 categ. = 5 949 requests
    Costo/sync:        USD $190  (trimestral)
    Costo/año:         USD $762  (dentro del crédito gratis $2 400/año)
    Runtime estimado:  40-59 min (timeout workflow: 90 min)
"""

from __future__ import annotations
import logging, math, os, sys
from pathlib import Path
from dotenv import load_dotenv

ETL_DIR   = Path(__file__).resolve().parent
REPO_ROOT = ETL_DIR.parent.parent
load_dotenv(REPO_ROOT / ".env")

# ─────────────────────────────────────────────────────────────────────────────
# Google Places API
# ─────────────────────────────────────────────────────────────────────────────
GOOGLE_API_KEY: str = (
    os.environ.get("GOOGLE_MAPS_API_KEY", "")
    or os.environ.get("VITE_GOOGLE_MAPS_KEY", "")
)

PLACES_NEARBY_URL  = "https://places.googleapis.com/v1/places:searchNearby"
PLACES_MAX_RESULTS = 20
FIELD_MASK = ",".join([
    "places.id",
    "places.displayName",
    "places.location",
    "places.shortFormattedAddress",
    "places.addressComponents",
    "places.types",
    "places.primaryType",
])

# ─────────────────────────────────────────────────────────────────────────────
# Supabase / Edge Function
# ─────────────────────────────────────────────────────────────────────────────
SUPABASE_URL      = os.environ.get("SUPABASE_URL", "").rstrip("/")
SYNC_API_TOKEN    = os.environ.get("SYNC_API_TOKEN", "")
SYNC_API_ENDPOINT = f"{SUPABASE_URL}/functions/v1/sync-comercio-osm"
UPSERT_BATCH_SIZE = 500

# ─────────────────────────────────────────────────────────────────────────────
# Tipos Google Places → categoría interna
# ─────────────────────────────────────────────────────────────────────────────
GOOGLE_TYPE_CATEGORY: dict[str, str] = {
    "supermarket":           "supermercado",
    "grocery_store":         "supermercado",
    "convenience_store":     "conveniencia",
    "pharmacy":              "farmacia",
    "drugstore":             "farmacia",
    "gas_station":           "combustible",
    "home_goods_store":      "mejoramiento_hogar",
    "hardware_store":        "mejoramiento_hogar",
    "furniture_store":       "mejoramiento_hogar",
    "department_store":      "retail_departamental",
    "clothing_store":        "retail_departamental",
    "shoe_store":            "retail_departamental",
    "bank":                  "banco",
    "atm":                   "banco",
    "restaurant":            "restaurante",
    "fast_food_restaurant":  "restaurante",
    "cafe":                  "restaurante",
    "shopping_mall":         "centro_comercial",
}

CATEGORY_TYPES: dict[str, list[str]] = {
    "supermercado":          ["supermarket", "grocery_store"],
    "conveniencia":          ["convenience_store"],
    "farmacia":              ["pharmacy", "drugstore"],
    "combustible":           ["gas_station"],
    "mejoramiento_hogar":    ["home_goods_store", "hardware_store"],
    "retail_departamental":  ["department_store", "clothing_store", "shoe_store"],
    "banco":                 ["bank"],
    "restaurante":           ["restaurant", "fast_food_restaurant"],
    "centro_comercial":      ["shopping_mall"],
}

# ─────────────────────────────────────────────────────────────────────────────
# Helper: generador de grilla uniforme
# ─────────────────────────────────────────────────────────────────────────────

def _gen_grid(
    lat_s: float, lat_n: float,
    lon_w: float, lon_e: float,
    spacing_km: float,
    radius_m: int,
    prefix: str,
) -> list[tuple[float, float, int, str]]:
    """
    Genera grilla rectangular uniforme para Nearby Search.

    Args:
        lat_s / lat_n : límites sur / norte  (lat_s < lat_n en valor geográfico,
                         pero lat_s es MÁS negativo, p.ej. -33.58 / -33.20)
        lon_w / lon_e : límites oeste / este
        spacing_km    : distancia entre centros (km)
        radius_m      : radio de búsqueda (metros)
        prefix        : etiqueta de zona para logging

    La grilla garantiza que cualquier punto del área está a ≤ spacing_km/√2
    del centro más cercano; a radio ≥ spacing_km/√2 la cobertura es completa.
    Con spacing=2km y radius=1km el gap en esquinas es ~0.41km — aceptable
    porque las tiendas están en avenidas, no en esquinas de cuadrícula vacías.
    """
    mid_lat = (lat_s + lat_n) / 2
    d_lat   = spacing_km / 111.1
    d_lon   = spacing_km / (111.1 * math.cos(math.radians(mid_lat)))

    lats = [lat_s + i * d_lat
            for i in range(int((lat_n - lat_s) / d_lat) + 2)
            if lat_s + i * d_lat <= lat_n + 1e-5]
    lons = [lon_w + j * d_lon
            for j in range(int((lon_e - lon_w) / d_lon) + 2)
            if lon_w + j * d_lon <= lon_e + 1e-5]

    return [
        (round(lat, 4), round(lon, 4), radius_m,
         f"{prefix} r{ri+1:02d}c{ci+1:02d}")
        for ri, lat in enumerate(lats)
        for ci, lon in enumerate(lons)
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Grilla geográfica Chile
# ─────────────────────────────────────────────────────────────────────────────
CHILE_GRID: list[tuple[float, float, int, str]] = (

    # ── Gran Santiago — 418 pts, 2km spacing, radio 1km ──────────────────────
    # Cubre: Quilicura/Pudahuel (norte) → San Bernardo/Puente Alto (sur)
    #        Pudahuel Pte. (oeste) → La Florida/Peñalolén (este)
    # A radio 1km: ~1-2 farmacias/tipo por punto → NUNCA satura el límite de 20
    _gen_grid(-33.58, -33.20, -70.88, -70.48, 2.0, 1_000, "SCL") +

    # ── Gran Valparaíso / Viña del Mar — 99 pts, 2km spacing, radio 1km ──────
    # Cubre: Valparaíso, Viña del Mar, Quilpué, Villa Alemana
    _gen_grid(-33.16, -33.00, -71.67, -71.44, 2.0, 1_000, "VPO") +

    # ── Gran Concepción — 90 pts, 3km spacing, radio 1km ─────────────────────
    # Cubre: Talcahuano, Concepción, Hualpén, Chiguayante, San Pedro, Coronel
    _gen_grid(-36.97, -36.72, -73.17, -72.90, 3.0, 1_000, "CCP") +

    # ── Resto de Chile ────────────────────────────────────────────────────────
    # Radio más grande porque la densidad es menor y nunca se satura el cap.
    [
        # RM periférica
        (-33.10, -70.72, 15_000, "RM - Colina/Lampa"),
        (-33.68, -70.55, 15_000, "RM - San José de Maipo/Pirque"),
        (-33.55, -71.30, 15_000, "RM - Melipilla"),
        (-34.00, -70.80, 15_000, "RM - Buin/Paine Sur"),

        # Valparaíso región (fuera del Gran Valparaíso)
        (-33.60, -71.62, 15_000, "San Antonio"),
        (-32.85, -71.50, 15_000, "Quillota / La Calera"),
        (-32.83, -70.75, 15_000, "Los Andes / San Felipe"),

        # Coquimbo / La Serena
        (-29.91, -71.26,  8_000, "La Serena"),
        (-29.97, -71.34,  8_000, "Coquimbo"),
        (-30.73, -71.20, 15_000, "Ovalle"),
        (-31.64, -71.07, 15_000, "Illapel"),

        # Atacama
        (-27.37, -70.33, 12_000, "Copiapó"),
        (-26.83, -70.15, 15_000, "Vallenar"),

        # Antofagasta
        (-23.65, -70.40,  8_000, "Antofagasta N"),
        (-23.72, -70.40,  8_000, "Antofagasta S"),
        (-22.46, -68.93, 12_000, "Calama"),

        # Tarapacá
        (-20.22, -70.14,  8_000, "Iquique N"),
        (-20.27, -70.10,  8_000, "Iquique S"),
        (-19.84, -69.95, 12_000, "Alto Hospicio"),

        # Arica
        (-18.48, -70.31,  8_000, "Arica N"),
        (-18.53, -70.31,  8_000, "Arica S"),

        # O'Higgins
        (-34.17, -70.74,  8_000, "Rancagua N"),
        (-34.23, -70.74,  8_000, "Rancagua S"),
        (-34.58, -71.00, 15_000, "San Fernando"),
        (-34.38, -71.40, 15_000, "Pichilemu / Santa Cruz"),

        # Maule
        (-35.43, -71.66,  8_000, "Talca N"),
        (-35.49, -71.66,  8_000, "Talca S"),
        (-34.98, -71.23,  8_000, "Curicó"),
        (-35.85, -71.60, 15_000, "Linares"),
        (-35.32, -71.61, 15_000, "Molina"),

        # Ñuble
        (-36.61, -72.10,  8_000, "Chillán N"),
        (-36.67, -72.10,  8_000, "Chillán S"),

        # Biobío (fuera del Gran Concepción)
        (-37.10, -72.60, 12_000, "Los Ángeles"),
        (-37.62, -72.38, 15_000, "Mulchén"),

        # La Araucanía
        (-38.74, -72.60,  8_000, "Temuco N"),
        (-38.80, -72.60,  8_000, "Temuco S"),
        (-38.91, -72.68,  8_000, "Padre Las Casas"),
        (-39.23, -72.33, 12_000, "Villarrica / Pucón"),
        (-37.80, -72.70, 15_000, "Angol"),
        (-38.43, -72.35, 15_000, "Victoria / Curacautín"),

        # Los Ríos
        (-39.82, -73.24,  8_000, "Valdivia N"),
        (-39.88, -73.24,  8_000, "Valdivia S"),
        (-40.29, -72.40, 15_000, "La Unión / Río Bueno"),

        # Los Lagos
        (-40.57, -73.13,  8_000, "Osorno N"),
        (-40.63, -73.13,  8_000, "Osorno S"),
        (-41.47, -72.93,  8_000, "Puerto Montt N"),
        (-41.53, -72.93,  8_000, "Puerto Montt S"),
        (-41.31, -72.98,  8_000, "Puerto Varas"),
        (-42.48, -73.76, 15_000, "Castro (Chiloé)"),
        (-41.87, -73.95, 15_000, "Ancud (Chiloé)"),

        # Aysén
        (-45.57, -72.07, 15_000, "Coyhaique"),

        # Magallanes
        (-53.16, -70.92, 10_000, "Punta Arenas N"),
        (-53.22, -70.92, 10_000, "Punta Arenas S"),
        (-51.73, -72.50, 15_000, "Puerto Natales"),
    ]
)


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
def setup_logging(level: int = logging.INFO) -> logging.Logger:
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )
    return logging.getLogger("comercio_google")


def validate_env() -> None:
    missing = []
    if not GOOGLE_API_KEY:
        missing.append("VITE_GOOGLE_MAPS_KEY (o GOOGLE_MAPS_API_KEY)")
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SYNC_API_TOKEN:
        missing.append("SYNC_API_TOKEN")
    if missing:
        raise EnvironmentError(
            f"Variables faltantes: {', '.join(missing)}\n"
            "Verifica el .env o los Secrets de GitHub Actions."
        )
