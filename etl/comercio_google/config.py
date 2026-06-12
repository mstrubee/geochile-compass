"""
config.py — Configuración ETL Red Comercial Nacional → Google Places (New).

Estrategia: Nearby Search en grilla geográfica densa.
  - Gran Santiago: grilla 7×7 = 49 puntos con radio 3km (espaciado 6km).
    Radio 3km → max ~8 farmacias del mismo tipo por punto → NUNCA alcanza
    el límite de 20 resultados de la API.
  - Otras ciudades: radio 6-20km según densidad urbana.
  - Total: ~117 puntos × 9 categorías ≈ 1053 requests (~$33/sync trimestral).
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
# Gran Santiago: grilla 7×7 = 49 puntos con radio 3km.
#   Cobertura: Quilicura/Pudahuel (norte) → San Bernardo/Puente Alto (sur)
#              Pudahuel Pte. (oeste) → La Florida/Peñalolén (este)
#   Espaciado lat: 0.054° ≈ 6km  /  Espaciado lon: 0.066° ≈ 6km
#   Radio 3km → círculos adyacentes se tocan (gap 0km en aristas,
#   ~1.2km en esquinas — aceptable en ciudad donde tiendas están en calles).
#   Farmacias esperadas por punto: ~4-8 → nunca satura el cap de 20.
# ─────────────────────────────────────────────────────────────────────────────
CHILE_GRID: list[tuple[float, float, int, str]] = [

    # ── Gran Santiago — grilla 7×7, radio 3km ────────────────────────────────
    # Espaciado: 0.054°lat (~6km) × 0.066°lon (~6km).
    # A radio 3km los círculos se tocan pero no se solapan → sin zonas muertas
    # en calles. Sin solapamiento real en interiores (parques, cerros).
    # Resultado esperado: ~4-8 farmacias/tipo por punto → nunca llega a 20.
    #
    # Cubre: Quilicura/Pudahuel (norte) → San Bernardo/Puente Alto (sur)
    #        Pudahuel Pte. (oeste) → La Florida/Peñalolén (este)
    #
    # Fila 1 — norte (Quilicura, Pudahuel, Conchalí, Huechuraba, Las Condes N)
    (-33.22, -70.88, 3_000, "SCL N1-Pudahuel Pte."),
    (-33.22, -70.81, 3_000, "SCL N1-Renca"),
    (-33.22, -70.75, 3_000, "SCL N1-Conchalí"),
    (-33.22, -70.68, 3_000, "SCL N1-Huechuraba"),
    (-33.22, -70.62, 3_000, "SCL N1-Vitacura N"),
    (-33.22, -70.55, 3_000, "SCL N1-Las Condes N"),
    (-33.22, -70.49, 3_000, "SCL N1-Lo Barnechea"),
    # Fila 2 — (Maipú N, Quinta Normal, Independencia, Providencia, Las Condes)
    (-33.28, -70.88, 3_000, "SCL N2-Pudahuel/Maipú N"),
    (-33.28, -70.81, 3_000, "SCL N2-Quinta Normal"),
    (-33.28, -70.75, 3_000, "SCL N2-Independencia/Recoleta"),
    (-33.28, -70.68, 3_000, "SCL N2-Santiago Centro N"),
    (-33.28, -70.62, 3_000, "SCL N2-Providencia"),
    (-33.28, -70.55, 3_000, "SCL N2-Las Condes"),
    (-33.28, -70.49, 3_000, "SCL N2-Las Condes E"),
    # Fila 3 — (Maipú, Cerrillos, Centro, Ñuñoa, La Reina)
    (-33.34, -70.88, 3_000, "SCL C1-Maipú Pte."),
    (-33.34, -70.81, 3_000, "SCL C1-Cerrillos/Maipú"),
    (-33.34, -70.75, 3_000, "SCL C1-Santiago Centro"),
    (-33.34, -70.68, 3_000, "SCL C1-Centro Sur/San Borja"),
    (-33.34, -70.62, 3_000, "SCL C1-Ñuñoa N"),
    (-33.34, -70.55, 3_000, "SCL C1-La Reina"),
    (-33.34, -70.49, 3_000, "SCL C1-Peñalolén N"),
    # Fila 4 — (Maipú S, San Joaquín, San Miguel, Macul, La Florida N)
    (-33.40, -70.88, 3_000, "SCL C2-Maipú Sur"),
    (-33.40, -70.81, 3_000, "SCL C2-Cerrillos Sur"),
    (-33.40, -70.75, 3_000, "SCL C2-San Joaquín"),
    (-33.40, -70.68, 3_000, "SCL C2-San Miguel/PdeA"),
    (-33.40, -70.62, 3_000, "SCL C2-Ñuñoa S/Macul"),
    (-33.40, -70.55, 3_000, "SCL C2-La Florida N"),
    (-33.40, -70.49, 3_000, "SCL C2-Peñalolén S"),
    # Fila 5 — (Maipú S, La Cisterna, El Bosque, La Granja, La Florida C)
    (-33.46, -70.88, 3_000, "SCL S1-Maipú SW"),
    (-33.46, -70.81, 3_000, "SCL S1-Lo Espejo"),
    (-33.46, -70.75, 3_000, "SCL S1-La Cisterna"),
    (-33.46, -70.68, 3_000, "SCL S1-El Bosque N"),
    (-33.46, -70.62, 3_000, "SCL S1-La Granja"),
    (-33.46, -70.55, 3_000, "SCL S1-La Florida C"),
    (-33.46, -70.49, 3_000, "SCL S1-La Florida E"),
    # Fila 6 — (San Bernardo N, Pedro A. Cerda, La Pintana, Puente Alto N)
    (-33.52, -70.88, 3_000, "SCL S2-Talagante E"),
    (-33.52, -70.81, 3_000, "SCL S2-San Bernardo N"),
    (-33.52, -70.75, 3_000, "SCL S2-San Ramón"),
    (-33.52, -70.68, 3_000, "SCL S2-La Pintana N"),
    (-33.52, -70.62, 3_000, "SCL S2-La Pintana S"),
    (-33.52, -70.55, 3_000, "SCL S2-Puente Alto N"),
    (-33.52, -70.49, 3_000, "SCL S2-Puente Alto E"),
    # Fila 7 — sur (San Bernardo, El Bosque S, Puente Alto)
    (-33.58, -70.88, 3_000, "SCL S3-Calera de Tango"),
    (-33.58, -70.81, 3_000, "SCL S3-San Bernardo"),
    (-33.58, -70.75, 3_000, "SCL S3-San Bernardo E"),
    (-33.58, -70.68, 3_000, "SCL S3-El Bosque S"),
    (-33.58, -70.62, 3_000, "SCL S3-La Pintana S"),
    (-33.58, -70.55, 3_000, "SCL S3-Puente Alto C"),
    (-33.58, -70.49, 3_000, "SCL S3-Puente Alto S"),

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
