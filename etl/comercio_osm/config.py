"""
config.py — Configuración centralizada para el ETL de Red Comercial Nacional.

Variables de entorno requeridas (.env en la raíz del repo):
  SUPABASE_URL      → URL del proyecto Supabase (https://xxx.supabase.co)
  SYNC_API_TOKEN    → Token secreto compartido con la Edge Function sync-comercio-osm

La Edge Function (desplegada en Lovable/Supabase) gestiona internamente el
service_role key. El ETL nunca necesita acceso directo a la DB.
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
# Supabase / Edge Function
# ─────────────────────────────────────────────────────────────────────────────
SUPABASE_URL    = os.environ.get("SUPABASE_URL", "").rstrip("/")
SYNC_API_TOKEN  = os.environ.get("SYNC_API_TOKEN", "")

# Endpoint derivado automáticamente de SUPABASE_URL
SYNC_API_ENDPOINT = f"{SUPABASE_URL}/functions/v1/sync-comercio-osm"

# ─────────────────────────────────────────────────────────────────────────────
# Overpass API
# ─────────────────────────────────────────────────────────────────────────────
OVERPASS_ENDPOINTS: list[str] = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
OVERPASS_TIMEOUT_S: int   = 180
OVERPASS_RETRY_WAIT: int  = 20
OVERPASS_MAX_RETRIES: int = 3

# Bounding box de Chile continental + Isla de Pascua  (S, W, N, E)
CHILE_BBOX = (-56.0, -76.0, -17.5, -65.5)

# ─────────────────────────────────────────────────────────────────────────────
# Tabla destino
# ─────────────────────────────────────────────────────────────────────────────
TABLE_COMERCIO_POI  = "comercio_poi"
TABLE_BRAND_CATALOG = "brand_catalog"
TABLE_SYNC_LOG      = "comercio_poi_sync_log"

# Tamaño de batch para upserts (registros por llamada HTTP)
UPSERT_BATCH_SIZE = 500

# ─────────────────────────────────────────────────────────────────────────────
# Categorías OSM → modelo interno
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

CATEGORY_DEFAULTS: dict[str, dict] = {
    "supermercado":         {"color": "#0046AD", "icon": "🛒"},
    "conveniencia":         {"color": "#F59E0B", "icon": "🏪"},
    "farmacia":             {"color": "#00A651", "icon": "💊"},
    "combustible":          {"color": "#EF4444", "icon": "⛽"},
    "mejoramiento_hogar":   {"color": "#F5821F", "icon": "🔨"},
    "retail_departamental": {"color": "#7C3AED", "icon": "🛍️"},
    "banco":                {"color": "#1D4ED8", "icon": "🏦"},
    "restaurante":          {"color": "#EA580C", "icon": "🍽️"},
    "centro_comercial":     {"color": "#BE123C", "icon": "🏬"},
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
    if not SYNC_API_TOKEN:
        missing.append("SYNC_API_TOKEN")
    if missing:
        raise EnvironmentError(
            f"Variables de entorno faltantes: {', '.join(missing)}\n"
            f"Verifica {ENV_FILE}"
        )
