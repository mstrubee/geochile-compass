"""
config.py — Configuración ETL Red Comercial Nacional → Google Places (New).

Estrategia: Nearby Search por tipo en grilla geográfica.
  - Evita el límite de 20 resultados del Text Search global.
  - Santiago: 9 puntos con radio 10km (alta densidad).
  - Otras ciudades: radio 20-25km.
  - Total: ~38 puntos × 9 categorías ≈ 342 requests (~$11/sync).
"""

from __future__ import annotations
import logging
import os
import sys
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
PLACES_MAX_RESULTS = 20   # máximo soportado por la API por request
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
# Supabase / Edge Function (misma que OSM)
# ─────────────────────────────────────────────────────────────────────────────
SUPABASE_URL      = os.environ.get("SUPABASE_URL", "").rstrip("/")
SYNC_API_TOKEN    = os.environ.get("SYNC_API_TOKEN", "")
SYNC_API_ENDPOINT = f"{SUPABASE_URL}/functions/v1/sync-comercio-osm"
UPSERT_BATCH_SIZE = 500

# ─────────────────────────────────────────────────────────────────────────────
# Mapa tipo Google Places → categoría interna
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

# ─────────────────────────────────────────────────────────────────────────────
# Categorías → tipos Google Places a buscar
# ─────────────────────────────────────────────────────────────────────────────
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
# Grilla geográfica de Chile
# Cada punto: (latitud, longitud, radio_metros, etiqueta)
# Diseño: radio pequeño en zonas densas → nunca superamos 20 resultados/tipo
# ─────────────────────────────────────────────────────────────────────────────
CHILE_GRID: list[tuple[float, float, int, str]] = [

    # ── Gran Santiago — 9 puntos, radio 10km ─────────────────────────────────
    # Cubre toda el área metropolitana sin gaps ni exceder 20 resultados/tipo
    (-33.35, -70.74, 10_000, "Santiago NW - Pudahuel/Cerrillos"),
    (-33.35, -70.63, 10_000, "Santiago N - Providencia/Las Condes"),
    (-33.35, -70.52, 10_000, "Santiago NE - La Reina/Peñalolén"),
    (-33.46, -70.74, 10_000, "Santiago W - Maipú"),
    (-33.46, -70.63, 10_000, "Santiago C - Centro/Ñuñoa"),
    (-33.46, -70.52, 10_000, "Santiago E - La Florida/Macul"),
    (-33.57, -70.74, 10_000, "Santiago SW - San Bernardo"),
    (-33.57, -70.63, 10_000, "Santiago S - El Bosque/San Miguel"),
    (-33.57, -70.52, 10_000, "Santiago SE - Puente Alto"),

    # ── Región Metropolitana periférica ───────────────────────────────────────
    (-33.20, -70.75, 15_000, "RM - Quilicura/Til Til"),
    (-33.67, -70.58, 15_000, "RM - Pirque/San José de Maipo"),

    # ── Valparaíso / Aconcagua ────────────────────────────────────────────────
    (-33.04, -71.62, 15_000, "Valparaíso"),
    (-33.02, -71.55, 15_000, "Viña del Mar"),
    (-33.15, -71.55, 15_000, "Quilpué / Villa Alemana"),
    (-33.39, -71.20, 20_000, "San Felipe / Los Andes"),
    (-33.60, -71.62, 20_000, "San Antonio / Cartagena"),

    # ── Coquimbo ──────────────────────────────────────────────────────────────
    (-29.90, -71.26, 20_000, "La Serena / Coquimbo"),
    (-30.73, -71.20, 25_000, "Ovalle"),
    (-31.90, -71.25, 25_000, "Illapel / Los Vilos"),

    # ── Atacama ───────────────────────────────────────────────────────────────
    (-27.37, -70.33, 25_000, "Copiapó"),
    (-26.83, -70.15, 25_000, "Vallenar"),

    # ── Antofagasta ───────────────────────────────────────────────────────────
    (-23.65, -70.40, 20_000, "Antofagasta"),
    (-22.46, -68.93, 20_000, "Calama"),
    (-24.50, -70.33, 25_000, "Taltal / Chañaral"),

    # ── Tarapacá ──────────────────────────────────────────────────────────────
    (-20.21, -70.15, 20_000, "Iquique"),
    (-19.64, -70.13, 25_000, "Alto Hospicio"),

    # ── Arica y Parinacota ────────────────────────────────────────────────────
    (-18.48, -70.31, 20_000, "Arica"),

    # ── O'Higgins ─────────────────────────────────────────────────────────────
    (-34.17, -70.74, 20_000, "Rancagua"),
    (-34.58, -71.00, 25_000, "San Fernando"),

    # ── Maule ─────────────────────────────────────────────────────────────────
    (-35.43, -71.66, 20_000, "Talca"),
    (-34.98, -71.23, 20_000, "Curicó"),
    (-35.97, -71.60, 20_000, "Linares"),

    # ── Ñuble ─────────────────────────────────────────────────────────────────
    (-36.61, -72.10, 20_000, "Chillán"),

    # ── Biobío / Concepción ───────────────────────────────────────────────────
    (-36.83, -73.05, 12_000, "Concepción"),
    (-36.77, -73.10, 12_000, "Talcahuano / Hualpén"),
    (-36.93, -73.00, 12_000, "Chiguayante / San Pedro"),
    (-37.10, -72.60, 20_000, "Los Ángeles"),
    (-37.47, -72.35, 25_000, "Mulchén / Nacimiento"),

    # ── La Araucanía ─────────────────────────────────────────────────────────
    (-38.74, -72.60, 20_000, "Temuco"),
    (-38.91, -72.68, 15_000, "Padre Las Casas / Nueva Imperial"),
    (-39.23, -72.33, 20_000, "Villarrica / Pucón"),
    (-37.80, -72.70, 25_000, "Angol / Collipulli"),

    # ── Los Ríos ──────────────────────────────────────────────────────────────
    (-39.82, -73.24, 20_000, "Valdivia"),
    (-40.29, -72.40, 25_000, "La Unión / Río Bueno"),

    # ── Los Lagos ─────────────────────────────────────────────────────────────
    (-40.57, -73.13, 20_000, "Osorno"),
    (-41.47, -72.93, 20_000, "Puerto Montt"),
    (-41.31, -72.98, 15_000, "Puerto Varas"),
    (-42.48, -73.76, 25_000, "Castro (Chiloé)"),

    # ── Aysén ─────────────────────────────────────────────────────────────────
    (-45.57, -72.07, 25_000, "Coyhaique"),

    # ── Magallanes ────────────────────────────────────────────────────────────
    (-53.16, -70.92, 25_000, "Punta Arenas"),
    (-53.89, -70.92, 25_000, "Puerto Natales"),
]


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
            f"Variables de entorno faltantes: {', '.join(missing)}\n"
            "Verifica el .env o los Secrets de GitHub Actions."
        )
