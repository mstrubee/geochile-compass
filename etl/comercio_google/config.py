"""
config.py — Configuración ETL Red Comercial Nacional → Google Places (New).

Estrategia: Nearby Search en grilla geográfica densa.
  - Gran Santiago: grilla 5×5 con radio 5km → cubre toda el área sin superar
    el límite de 20 resultados por tipo en ningún punto.
  - Otras ciudades: radio 8-20km según densidad.
  - Total: ~95 puntos × 9 categorías ≈ 855 requests (~$27/sync trimestral).
"""

from __future__ import annotations
import logging, os, sys
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
# Grilla geográfica Chile
# Formato: (latitud, longitud, radio_metros, etiqueta)
#
# Gran Santiago: grilla 5×5 (25 puntos) con radio 5km.
#   Cobertura: desde Pudahuel (-70.88) hasta La Florida (-70.48)
#              desde Quilicura (-33.21) hasta Puente Alto (-33.57)
#   Espaciado: ~9km → overlap suficiente para no dejar zonas sin cubrir.
#
# Radio 5km en Santiago → máx ~15 farmacias, ~10 bencineras por punto → OK.
# ─────────────────────────────────────────────────────────────────────────────
CHILE_GRID: list[tuple[float, float, int, str]] = [

    # ── Gran Santiago — grilla 5×5, radio 5km ────────────────────────────────
    # Fila norte
    (-33.21, -70.88, 5_000, "SCL N-Poniente"),
    (-33.21, -70.78, 5_000, "SCL N-Pudahuel"),
    (-33.21, -70.68, 5_000, "SCL N-Renca/Conchali"),
    (-33.21, -70.58, 5_000, "SCL N-Huechuraba"),
    (-33.21, -70.48, 5_000, "SCL N-Vitacura/Las Condes N"),
    # Fila centro-norte
    (-33.30, -70.88, 5_000, "SCL CN-Maipú N"),
    (-33.30, -70.78, 5_000, "SCL CN-Cerrillos/Maipú"),
    (-33.30, -70.68, 5_000, "SCL CN-Quinta Normal/Estación C."),
    (-33.30, -70.58, 5_000, "SCL CN-Providencia"),
    (-33.30, -70.48, 5_000, "SCL CN-Las Condes"),
    # Fila centro
    (-33.39, -70.88, 5_000, "SCL C-Maipú Sur"),
    (-33.39, -70.78, 5_000, "SCL C-Cerrillos Sur"),
    (-33.39, -70.68, 5_000, "SCL C-Santiago Centro"),
    (-33.39, -70.58, 5_000, "SCL C-Ñuñoa/La Reina"),
    (-33.39, -70.48, 5_000, "SCL C-Peñalolén"),
    # Fila centro-sur
    (-33.48, -70.88, 5_000, "SCL CS-Buin/Paine N"),
    (-33.48, -70.78, 5_000, "SCL CS-San Bernardo N"),
    (-33.48, -70.68, 5_000, "SCL CS-San Miguel/La Cisterna"),
    (-33.48, -70.58, 5_000, "SCL CS-La Florida N"),
    (-33.48, -70.48, 5_000, "SCL CS-La Florida E"),
    # Fila sur
    (-33.57, -70.88, 5_000, "SCL S-Buin"),
    (-33.57, -70.78, 5_000, "SCL S-San Bernardo"),
    (-33.57, -70.68, 5_000, "SCL S-El Bosque/Pedro A.Cerda"),
    (-33.57, -70.58, 5_000, "SCL S-Puente Alto N"),
    (-33.57, -70.48, 5_000, "SCL S-Puente Alto"),

    # ── RM periférica ─────────────────────────────────────────────────────────
    (-33.10, -70.72, 15_000, "RM - Colina/Lampa"),
    (-33.68, -70.55, 15_000, "RM - San José de Maipo/Pirque"),
    (-33.55, -71.30, 15_000, "RM - Melipilla"),
    (-34.00, -70.80, 15_000, "RM - Buin/Paine Sur"),

    # ── Valparaíso / Viña del Mar ─────────────────────────────────────────────
    (-33.04, -71.62, 6_000,  "Valparaíso N"),
    (-33.08, -71.62, 6_000,  "Valparaíso S"),
    (-33.01, -71.55, 6_000,  "Viña del Mar N"),
    (-33.05, -71.55, 6_000,  "Viña del Mar S"),
    (-33.12, -71.55, 8_000,  "Quilpué"),
    (-33.16, -71.47, 8_000,  "Villa Alemana"),
    (-33.60, -71.62, 15_000, "San Antonio"),
    (-32.85, -71.50, 15_000, "Quillota / La Calera"),
    (-32.83, -70.75, 15_000, "Los Andes / San Felipe"),

    # ── Coquimbo / La Serena ──────────────────────────────────────────────────
    (-29.91, -71.26, 8_000,  "La Serena"),
    (-29.97, -71.34, 8_000,  "Coquimbo"),
    (-30.73, -71.20, 15_000, "Ovalle"),
    (-31.64, -71.07, 15_000, "Illapel"),

    # ── Atacama ───────────────────────────────────────────────────────────────
    (-27.37, -70.33, 12_000, "Copiapó"),
    (-26.83, -70.15, 15_000, "Vallenar"),

    # ── Antofagasta ───────────────────────────────────────────────────────────
    (-23.65, -70.40, 8_000,  "Antofagasta N"),
    (-23.72, -70.40, 8_000,  "Antofagasta S"),
    (-22.46, -68.93, 12_000, "Calama"),

    # ── Tarapacá ──────────────────────────────────────────────────────────────
    (-20.22, -70.14, 8_000,  "Iquique N"),
    (-20.27, -70.10, 8_000,  "Iquique S"),
    (-19.84, -69.95, 12_000, "Alto Hospicio"),

    # ── Arica ─────────────────────────────────────────────────────────────────
    (-18.48, -70.31, 8_000,  "Arica N"),
    (-18.53, -70.31, 8_000,  "Arica S"),

    # ── O'Higgins ─────────────────────────────────────────────────────────────
    (-34.17, -70.74, 8_000,  "Rancagua N"),
    (-34.23, -70.74, 8_000,  "Rancagua S"),
    (-34.58, -71.00, 15_000, "San Fernando"),
    (-34.38, -71.40, 15_000, "Pichilemu / Santa Cruz"),

    # ── Maule ─────────────────────────────────────────────────────────────────
    (-35.43, -71.66, 8_000,  "Talca N"),
    (-35.49, -71.66, 8_000,  "Talca S"),
    (-34.98, -71.23, 8_000,  "Curicó"),
    (-35.85, -71.60, 15_000, "Linares"),
    (-35.32, -71.61, 15_000, "Molina"),

    # ── Ñuble ─────────────────────────────────────────────────────────────────
    (-36.61, -72.10, 8_000,  "Chillán N"),
    (-36.67, -72.10, 8_000,  "Chillán S"),

    # ── Biobío / Gran Concepción ──────────────────────────────────────────────
    (-36.77, -73.05, 6_000,  "Concepción N"),
    (-36.84, -73.05, 6_000,  "Concepción S"),
    (-36.77, -73.12, 6_000,  "Talcahuano"),
    (-36.91, -73.03, 6_000,  "Chiguayante / San Pedro"),
    (-36.80, -72.95, 6_000,  "Hualpén / Penco"),
    (-36.93, -73.13, 8_000,  "Coronel / Lota"),
    (-37.10, -72.60, 12_000, "Los Ángeles"),
    (-37.62, -72.38, 15_000, "Mulchén"),

    # ── La Araucanía ─────────────────────────────────────────────────────────
    (-38.74, -72.60, 8_000,  "Temuco N"),
    (-38.80, -72.60, 8_000,  "Temuco S"),
    (-38.91, -72.68, 8_000,  "Padre Las Casas"),
    (-39.23, -72.33, 12_000, "Villarrica / Pucón"),
    (-37.80, -72.70, 15_000, "Angol"),
    (-38.43, -72.35, 15_000, "Victoria / Curacautín"),

    # ── Los Ríos ──────────────────────────────────────────────────────────────
    (-39.82, -73.24, 8_000,  "Valdivia N"),
    (-39.88, -73.24, 8_000,  "Valdivia S"),
    (-40.29, -72.40, 15_000, "La Unión / Río Bueno"),

    # ── Los Lagos ─────────────────────────────────────────────────────────────
    (-40.57, -73.13, 8_000,  "Osorno N"),
    (-40.63, -73.13, 8_000,  "Osorno S"),
    (-41.47, -72.93, 8_000,  "Puerto Montt N"),
    (-41.53, -72.93, 8_000,  "Puerto Montt S"),
    (-41.31, -72.98, 8_000,  "Puerto Varas"),
    (-42.48, -73.76, 15_000, "Castro (Chiloé)"),
    (-41.87, -73.95, 15_000, "Ancud (Chiloé)"),

    # ── Aysén ─────────────────────────────────────────────────────────────────
    (-45.57, -72.07, 15_000, "Coyhaique"),

    # ── Magallanes ────────────────────────────────────────────────────────────
    (-53.16, -70.92, 10_000, "Punta Arenas N"),
    (-53.22, -70.92, 10_000, "Punta Arenas S"),
    (-51.73, -72.50, 15_000, "Puerto Natales"),
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
            f"Variables faltantes: {', '.join(missing)}\n"
            "Verifica el .env o los Secrets de GitHub Actions."
        )
