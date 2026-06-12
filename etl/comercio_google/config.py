"""
config.py — Configuración para el ETL Red Comercial Nacional → Google Places (New).

Variables de entorno (.env o GitHub Secrets):
  VITE_GOOGLE_MAPS_KEY  (o GOOGLE_MAPS_API_KEY) — clave con Places API habilitada
  SUPABASE_URL          — URL del proyecto Supabase
  SYNC_API_TOKEN        — Token compartido con la Edge Function sync-comercio-osm
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
# Acepta el mismo nombre de var que el frontend (VITE_*) o el nombre canónico.
GOOGLE_API_KEY: str = (
    os.environ.get("GOOGLE_MAPS_API_KEY", "")
    or os.environ.get("VITE_GOOGLE_MAPS_KEY", "")
)

PLACES_SEARCH_URL   = "https://places.googleapis.com/v1/places:searchText"
PLACES_MAX_RESULTS  = 20   # máximo por página que soporta la API
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
# Supabase / Edge Function  (misma que OSM — no requiere cambios)
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
    "ice_cream_shop":        "restaurante",
    "shopping_mall":         "centro_comercial",
}

# ─────────────────────────────────────────────────────────────────────────────
# Búsquedas por marca (Text Search)
# Cada entrada: (query_text, categoría_de_respaldo)
# El catálogo normaliza el nombre final; la categoría_de_respaldo solo aplica
# cuando ninguna regla del catálogo coincide.
# ─────────────────────────────────────────────────────────────────────────────
BRAND_SEARCHES: list[tuple[str, str]] = [

    # ── Supermercados ─────────────────────────────────────────────────────────
    ("Jumbo supermercado Chile",           "supermercado"),
    ("Lider supermercado Chile",           "supermercado"),
    ("Lider Express Chile",                "supermercado"),
    ("Santa Isabel supermercado Chile",    "supermercado"),
    ("Unimarc Chile",                      "supermercado"),
    ("Acuenta mayorista Chile",            "supermercado"),
    ("Tottus supermercado Chile",          "supermercado"),
    ("Mayorista 10 Chile",                 "supermercado"),
    ("Alvi mayorista Chile",               "supermercado"),
    ("Super 10 Chile",                     "supermercado"),

    # ── Conveniencia ─────────────────────────────────────────────────────────
    ("OXXO tienda Chile",                  "conveniencia"),
    ("Pronto Copec Chile",                 "conveniencia"),
    ("Shell Heliós Chile",                 "conveniencia"),

    # ── Farmacias ─────────────────────────────────────────────────────────────
    ("Cruz Verde farmacia Chile",          "farmacia"),
    ("Salcobrand farmacia Chile",          "farmacia"),
    ("Farmacias Ahumada Chile",            "farmacia"),
    ("Farmacia Dr. Simi Chile",            "farmacia"),
    ("Farmacia Dr. Ahorro Chile",          "farmacia"),
    ("Knop Labomed farmacia Chile",        "farmacia"),
    ("Farmacenter Chile",                  "farmacia"),

    # ── Combustible ──────────────────────────────────────────────────────────
    ("Copec gasolinera Chile",             "combustible"),
    ("Shell bencinera Chile",              "combustible"),
    ("Aramco gasolinera Chile",            "combustible"),
    ("Petrobras bencinera Chile",          "combustible"),
    ("Puma Energy bencinera Chile",        "combustible"),
    ("Terpel gasolinera Chile",            "combustible"),

    # ── Mejoramiento del hogar ────────────────────────────────────────────────
    ("Sodimac Chile",                      "mejoramiento_hogar"),
    ("Easy tienda hogar Chile",            "mejoramiento_hogar"),
    ("Construmart Chile",                  "mejoramiento_hogar"),
    ("Imperial ferretería Chile",          "mejoramiento_hogar"),
    ("Chilemat ferretería Chile",          "mejoramiento_hogar"),

    # ── Retail departamental ──────────────────────────────────────────────────
    ("Falabella tienda Chile",             "retail_departamental"),
    ("Paris tienda Chile",                 "retail_departamental"),
    ("Ripley tienda Chile",                "retail_departamental"),
    ("La Polar tienda Chile",              "retail_departamental"),
    ("Hites tienda Chile",                 "retail_departamental"),
    ("ABC Din Chile",                      "retail_departamental"),
    ("Johnson's tienda Chile",             "retail_departamental"),
    ("Zara Chile",                         "retail_departamental"),
    ("H&M Chile",                          "retail_departamental"),
    ("Corona tienda Chile",                "retail_departamental"),
    ("Tricot Chile",                       "retail_departamental"),

    # ── Bancos ────────────────────────────────────────────────────────────────
    ("Banco de Chile sucursal",            "banco"),
    ("BancoEstado Chile",                  "banco"),
    ("Banco Santander Chile",              "banco"),
    ("BCI banco Chile",                    "banco"),
    ("Banco Itaú Chile",                   "banco"),
    ("Scotiabank Chile",                   "banco"),
    ("Banco Falabella Chile",              "banco"),
    ("Banco Ripley Chile",                 "banco"),
    ("Coopeuch cooperativa Chile",         "banco"),
    ("Banco Security Chile",               "banco"),
    ("BICE banco Chile",                   "banco"),
    ("Banco Consorcio Chile",              "banco"),
    ("Banco Internacional Chile",          "banco"),
    ("Redbanc cajero Chile",               "banco"),

    # ── Restaurantes ─────────────────────────────────────────────────────────
    ("McDonald's Chile",                   "restaurante"),
    ("Burger King Chile",                  "restaurante"),
    ("KFC Chile",                          "restaurante"),
    ("Starbucks Chile",                    "restaurante"),
    ("Subway Chile",                       "restaurante"),
    ("Pizza Hut Chile",                    "restaurante"),
    ("Domino's Pizza Chile",               "restaurante"),
    ("Papa John's Chile",                  "restaurante"),
    ("Telepizza Chile",                    "restaurante"),
    ("Doggis Chile",                       "restaurante"),
    ("Juan Maestro Chile",                 "restaurante"),
    ("Dunkin' Chile",                      "restaurante"),
    ("Pollo Feliz Chile",                  "restaurante"),

    # ── Centros comerciales ───────────────────────────────────────────────────
    ("Mall Plaza Chile",                   "centro_comercial"),
    ("Cenco Mall Chile",                   "centro_comercial"),
    ("Arauco mall Chile",                  "centro_comercial"),
    ("Open Plaza Chile",                   "centro_comercial"),
    ("Espacio Urbano Chile",               "centro_comercial"),
    ("Vivo Mall Chile",                    "centro_comercial"),
    ("Costanera Center Chile",             "centro_comercial"),
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
            f"Verifica el .env o los Secrets de GitHub Actions."
        )
