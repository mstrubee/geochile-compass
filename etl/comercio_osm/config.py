"""
config.py — Configuración centralizada para el ETL de Red Comercial Nacional.

Variables de entorno requeridas (.env en la raíz del repo):
  SUPABASE_URL              → URL del proyecto Supabase (https://xxx.supabase.co)
  SUPABASE_SERVICE_ROLE_KEY → Service-role key (tiene escritura, NO exponer en frontend)
  SUPABASE_DB_URL           → Cadena de conexión directa PostgreSQL para bulk-inserts
                              postgresql://postgres:[pwd]@db.[ref].supabase.co:5432/postgres
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────
ETL_DIR   = Path(__file__).resolve().parent
REPO_ROOT = ETL_DIR.parent.parent
ENV_FILE  = REPO_ROOT / ".env"

load_dotenv(ENV_FILE)

# ─────────────────────────────────────────────────────────────────────────────
# Supabase / PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────
SUPABASE_URL              = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_DB_URL           = os.environ.get("SUPABASE_DB_URL", "")

# ─────────────────────────────────────────────────────────────────────────────
# Overpass API
# ─────────────────────────────────────────────────────────────────────────────
OVERPASS_ENDPOINTS: list[str] = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
OVERPASS_TIMEOUT_S: int  = 180   # segundos de timeout por petición
OVERPASS_RETRY_WAIT: int = 20    # segundos entre reintentos
OVERPASS_MAX_RETRIES: int = 3

# Bounding box de Chile continental + Isla de Pascua
# (Overpass: S, W, N, E)
CHILE_BBOX = (-56.0, -76.0, -17.5, -65.5)

# ─────────────────────────────────────────────────────────────────────────────
# Tabla destino
# ─────────────────────────────────────────────────────────────────────────────
TABLE_COMERCIO_POI  = "comercio_poi"
TABLE_BRAND_CATALOG = "brand_catalog"
TABLE_SYNC_LOG      = "comercio_poi_sync_log"

# Tamaño de batch para upserts (registros por transacción)
UPSERT_BATCH_SIZE = 500

# ─────────────────────────────────────────────────────────────────────────────
# Categorías OSM → modelo interno
#   clave: nombre interno de la categoría
#   valor: lista de (tag_key, tag_value) de OSM
# ─────────────────────────────────────────────────────────────────────────────
CATEGORY_TAG_MAP: dict[str, list[tuple[str, str]]] = {
    "supermercado": [
        ("shop", "supermarket"),
        ("shop", "wholesale"),
    ],
    "conveniencia": [
        ("shop", "convenience"),
    ],
    "farmacia": [
        ("amenity", "pharmacy"),
    ],
    "combustible": [
        ("amenity", "fuel"),
    ],
    "mejoramiento_hogar": [
        ("shop", "doityourself"),
        ("shop", "hardware"),
        ("shop", "building_materials"),
        ("shop", "trade"),
    ],
    "retail_departamental": [
        ("shop", "department_store"),
        ("shop", "clothes"),
        ("shop", "fashion"),
        ("shop", "general"),
    ],
    "banco": [
        ("amenity", "bank"),
        ("amenity", "atm"),
    ],
    "restaurante": [
        ("amenity", "fast_food"),
        ("amenity", "restaurant"),
        ("amenity", "cafe"),
        ("amenity", "ice_cream"),
    ],
    "centro_comercial": [
        ("shop", "mall"),
        ("building", "mall"),
        ("landuse", "retail"),
    ],
}

# Colores y emojis por defecto por categoría (fallback si la marca no tiene color)
CATEGORY_DEFAULTS: dict[str, dict] = {
    "supermercado":       {"color": "#0046AD", "icon": "🛒"},
    "conveniencia":       {"color": "#F59E0B", "icon": "🏪"},
    "farmacia":           {"color": "#00A651", "icon": "💊"},
    "combustible":        {"color": "#EF4444", "icon": "⛽"},
    "mejoramiento_hogar": {"color": "#F5821F", "icon": "🔨"},
    "retail_departamental":{"color": "#7C3AED", "icon": "🛍️"},
    "banco":              {"color": "#1D4ED8", "icon": "🏦"},
    "restaurante":        {"color": "#EA580C", "icon": "🍽️"},
    "centro_comercial":   {"color": "#BE123C", "icon": "🏬"},
}

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
    return logging.getLogger("comercio_osm")


def validate_env() -> None:
    """Aborta si faltan variables de entorno críticas."""
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not SUPABASE_DB_URL:
        missing.append("SUPABASE_DB_URL")
    if missing:
        raise EnvironmentError(
            f"Variables de entorno faltantes: {', '.join(missing)}\n"
            f"Verifica {ENV_FILE}"
        )
