#!/usr/bin/env python3
"""
AGROPLANET — Fase 2: Competidores vía Overpass API
═══════════════════════════════════════════════════════════════════════════════
Extrae dealers y tiendas de maquinaria agrícola en Chile desde OpenStreetMap
(Overpass API) y genera SQL para cargar en la tabla agroplanet_competitors.

SALIDA:
  etl/output/competitors_raw.csv          ← todos los puntos crudos
  etl/output/insert_competitors.sql       ← INSERT para Lovable SQL editor

USO:
  python3 etl/overpass_competitors.py

DEPENDENCIAS:
  pip install requests pandas geopandas shapely
═══════════════════════════════════════════════════════════════════════════════
"""

import json
import logging
import sys
import time
import uuid
from pathlib import Path

import pandas as pd
import requests

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURACIÓN
# ─────────────────────────────────────────────────────────────────────────────

REPO_ROOT   = Path(__file__).resolve().parent.parent
OUTPUT_DIR  = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

OVERPASS_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
    "http://overpass-api.de/api/interpreter",         # HTTP fallback
    "https://overpass-api.de/api/interpreter",
]
TIMEOUT_S    = 90
RETRY_WAIT_S = 15

# Comunas GeoJSON para enriquecer con CUT
COMUNAS_GEOJSON = REPO_ROOT / "public" / "comunas.geojson"
CODIGOS_CSV     = REPO_ROOT / "public" / "codigos_territoriales.csv"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("overpass-competitors")

# ─────────────────────────────────────────────────────────────────────────────
# MARCAS Y CATEGORÍAS
# ─────────────────────────────────────────────────────────────────────────────

# (marca_key, marca_display, categoria)
MARCAS = [
    ("John Deere",        "John Deere",        "dealer_john_deere"),
    ("New Holland",       "New Holland",        "dealer_new_holland"),
    ("Case IH",           "Case IH",            "dealer_case_ih"),
    ("Massey Ferguson",   "Massey Ferguson",    "dealer_massey_ferguson"),
    ("Claas",             "Claas",              "dealer_claas"),
    ("Kubota",            "Kubota",             "dealer_kubota"),
    ("Deutz",             "Deutz-Fahr",         "dealer_deutz"),
    ("AGCO",              "AGCO",               "dealer_agco"),
    ("Krone",             "Krone",              "dealer_krone"),
    ("Fendt",             "Fendt",              "dealer_fendt"),
]

# Regex para búsqueda por nombre en OSM (cubre variantes tipográficas)
BRAND_REGEX = "|".join(
    m[0].replace(" ", "[ _-]?").replace(".", "\\.")
    for m in MARCAS
)

# ─────────────────────────────────────────────────────────────────────────────
# QUERIES OVERPASS
# ─────────────────────────────────────────────────────────────────────────────

def build_query() -> str:
    """
    Estrategia multi-capa:
      1. brand=~"John Deere|New Holland|..." → puntos con tag oficial de marca
      2. name=~"...regex..."                  → puntos con nombre que menciona marca
      3. shop=agrarian                        → tiendas agrarias genéricas en Chile
      4. amenity con keywords agrícolas       → talleres / servicios rurales
    Usa area[ISO3166-1=CL] como bounding box.
    """
    return f"""
[out:json][timeout:{TIMEOUT_S}];
area["ISO3166-1"="CL"]->.cl;

(
  // ── Por tag brand oficial ────────────────────────────────────────────────
  node["brand"~"{BRAND_REGEX}",i](area.cl);
  way["brand"~"{BRAND_REGEX}",i](area.cl);

  // ── Por nombre (captura distribuidores sin tag brand) ────────────────────
  node["name"~"{BRAND_REGEX}",i](area.cl);
  way["name"~"{BRAND_REGEX}",i](area.cl);

  // ── Tiendas agrarias (repuestos, insumos) ────────────────────────────────
  node["shop"="agrarian"](area.cl);
  way["shop"="agrarian"](area.cl);

  // ── Maquinaria agrícola explícita ────────────────────────────────────────
  node["shop"="agricultural_machinery"](area.cl);
  way["shop"="agricultural_machinery"](area.cl);
  node["craft"="agricultural_engineer"](area.cl);
  way["craft"="agricultural_engineer"](area.cl);
);
out center tags;
""".strip()


# ─────────────────────────────────────────────────────────────────────────────
# DESCARGA OVERPASS
# ─────────────────────────────────────────────────────────────────────────────

def fetch_overpass(query: str) -> list[dict]:
    log.info("Consultando Overpass API (probando mirrors) …")
    headers = {"User-Agent": "AGROPLANET-ETL/2.0 (+github.com/mstrubee/geochile-compass)"}

    for mirror in OVERPASS_MIRRORS:
        log.info(f"  → {mirror}")
        for attempt in range(1, 3):
            try:
                r = requests.post(
                    mirror,
                    data={"data": query},
                    timeout=TIMEOUT_S + 10,
                    headers=headers,
                    verify=True,
                )
                if r.status_code == 429:
                    log.warning(f"  Rate limit — esperando {RETRY_WAIT_S}s …")
                    time.sleep(RETRY_WAIT_S)
                    continue
                if r.status_code >= 500:
                    log.warning(f"  HTTP {r.status_code} — siguiente mirror")
                    break
                r.raise_for_status()
                elements = r.json().get("elements", [])
                log.info(f"  ✓ {len(elements)} elementos desde {mirror}")
                return elements
            except requests.exceptions.SSLError:
                log.warning(f"  SSL error — siguiente mirror")
                break
            except requests.exceptions.Timeout:
                log.warning(f"  Timeout (intento {attempt})")
                time.sleep(5)
            except Exception as e:
                log.warning(f"  {type(e).__name__}: {e} — siguiente mirror")
                break

    log.error("Todos los mirrors fallaron")
    return []


# ─────────────────────────────────────────────────────────────────────────────
# PARSEAR ELEMENTOS OSM → DataFrame
# ─────────────────────────────────────────────────────────────────────────────

def guess_marca(tags: dict) -> tuple[str | None, str]:
    """Infiere (marca_display, categoria) desde los tags OSM."""
    brand_tag = tags.get("brand", "") or tags.get("name", "") or ""
    brand_low  = brand_tag.lower()

    for key, display, cat in MARCAS:
        if key.lower().replace(" ", "") in brand_low.replace(" ", "").replace("-", ""):
            return display, cat

    # Tienda agraria genérica
    shop = tags.get("shop", "")
    if shop == "agrarian":
        return None, "tienda_agraria"
    if shop == "agricultural_machinery":
        return None, "maquinaria_agricola"
    if tags.get("craft") == "agricultural_engineer":
        return None, "taller_agricola"

    return None, "otro"


def parse_elements(elements: list[dict]) -> pd.DataFrame:
    log.info("Parseando elementos …")
    rows = []
    for el in elements:
        tags = el.get("tags", {})

        # Coordenadas (way → center)
        if el["type"] == "node":
            lat = el.get("lat")
            lng = el.get("lon")
        elif el["type"] == "way" and "center" in el:
            lat = el["center"]["lat"]
            lng = el["center"]["lon"]
        else:
            continue

        if lat is None or lng is None:
            continue

        # Nombre
        nombre = (
            tags.get("name") or tags.get("brand") or
            tags.get("operator") or f"OSM:{el['id']}"
        )

        marca, categoria = guess_marca(tags)

        rows.append({
            "osm_id":    el["id"],
            "osm_type":  el["type"],
            "nombre":    nombre,
            "lat":       round(float(lat), 6),
            "lng":       round(float(lng), 6),
            "marca":     marca,
            "categoria": categoria,
            "direccion": tags.get("addr:full") or tags.get("addr:street") or None,
            "telefono":  tags.get("phone") or tags.get("contact:phone") or None,
            "url":       tags.get("website") or tags.get("contact:website") or None,
            "fuente":    "overpass_osm",
        })

    df = pd.DataFrame(rows)
    log.info(f"  {len(df)} puntos parseados")
    if len(df):
        log.info(f"  Categorías: {df['categoria'].value_counts().to_dict()}")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# ENRIQUECER CON CUT Y REGIÓN
# ─────────────────────────────────────────────────────────────────────────────

def enrich_with_cut(df: pd.DataFrame) -> pd.DataFrame:
    """Spatial join: cada punto → CUT de la comuna que lo contiene."""
    if df.empty:
        df["cut"]    = None
        df["region"] = None
        return df

    try:
        import geopandas as gpd
        from shapely.geometry import Point
    except ImportError:
        log.warning("  geopandas no disponible — cut/region quedarán vacíos")
        df["cut"]    = None
        df["region"] = None
        return df

    if not COMUNAS_GEOJSON.exists():
        log.warning(f"  {COMUNAS_GEOJSON} no encontrado — cut/region vacíos")
        df["cut"]    = None
        df["region"] = None
        return df

    log.info("  Spatial join con comunas.geojson …")
    comunas = gpd.read_file(COMUNAS_GEOJSON)
    if comunas.crs is None or comunas.crs.to_epsg() != 4326:
        comunas = comunas.to_crs(epsg=4326)

    # Detectar columnas de CUT y región
    cut_col    = next((c for c in ["codigo_comuna", "cod_comuna", "CUT", "cut"] if c in comunas.columns), None)
    region_col = next((c for c in ["region", "REGION", "nom_region"] if c in comunas.columns), None)

    gdf = gpd.GeoDataFrame(
        df,
        geometry=[Point(row.lng, row.lat) for row in df.itertuples()],
        crs="EPSG:4326",
    )
    joined = gpd.sjoin(gdf, comunas[[col for col in [cut_col, region_col, "geometry"] if col]], how="left", predicate="within")

    df["cut"]    = joined[cut_col].astype(str).str.zfill(5) if cut_col else None
    df["region"] = joined[region_col] if region_col else None

    assigned = df["cut"].notna().sum()
    log.info(f"  CUT asignado: {assigned}/{len(df)} puntos ({100*assigned/max(len(df),1):.0f}%)")
    return df.drop(columns=["geometry"], errors="ignore")


# ─────────────────────────────────────────────────────────────────────────────
# DEDUPLICAR
# ─────────────────────────────────────────────────────────────────────────────

def dedup(df: pd.DataFrame, dist_m: float = 100) -> pd.DataFrame:
    """
    Elimina duplicados dentro de `dist_m` metros con mismo nombre o marca.
    Usa comparación simple por grilla de 0.001° (~111m) para evitar dependencia
    de scipy/sklearn.
    """
    if df.empty:
        return df

    # Redondear coordenadas a grilla de ~100m
    df["_grid_lat"] = (df["lat"] * 1000).round().astype(int)
    df["_grid_lng"] = (df["lng"] * 1000).round().astype(int)
    df["_key"]      = (
        df["_grid_lat"].astype(str) + "_" + df["_grid_lng"].astype(str)
        + "_" + df["nombre"].str.lower().str[:20].str.strip()
    )
    before = len(df)
    df = df.drop_duplicates("_key").drop(columns=["_grid_lat", "_grid_lng", "_key"])
    log.info(f"  Dedup: {before} → {len(df)} (eliminados {before - len(df)})")
    return df.reset_index(drop=True)


# ─────────────────────────────────────────────────────────────────────────────
# GENERAR SQL
# ─────────────────────────────────────────────────────────────────────────────

def generate_sql(df: pd.DataFrame) -> None:
    if df.empty:
        log.warning("  Sin datos — no se genera SQL")
        return

    def val(v):
        if v is None or (isinstance(v, float) and __import__("math").isnan(v)):
            return "NULL"
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, (int, float)):
            return str(v)
        return "'" + str(v).replace("'", "''")[:500] + "'"

    COLS = ["id", "nombre", "lat", "lng", "marca", "categoria", "cut", "region",
            "direccion", "telefono", "url", "fuente", "verified"]

    rows = []
    for _, r in df.iterrows():
        row_id = str(uuid.uuid4())
        row = (
            val(row_id),
            val(str(r["nombre"])[:200]),
            val(r["lat"]),
            val(r["lng"]),
            val(r.get("marca")),
            val(str(r["categoria"])),
            val(r.get("cut")),
            val(r.get("region")),
            val(r.get("direccion")),
            val(r.get("telefono")),
            val(r.get("url")),
            val("overpass_osm"),
            "false",   # verified: requiere validación manual
        )
        rows.append("  (" + ", ".join(row) + ")")

    col_list   = ", ".join(COLS)
    update_set = ", ".join(f"{c}=EXCLUDED.{c}" for c in COLS if c != "id")

    # Partir en batches de 200
    batch_size = 200
    n_parts    = max(1, (len(rows) + batch_size - 1) // batch_size)

    for i in range(n_parts):
        batch   = rows[i * batch_size: (i + 1) * batch_size]
        content = (
            f"-- AGROPLANET Competidores OSM — parte {i+1}/{n_parts} ({len(batch)} filas)\n"
            f"-- Pegar en Lovable SQL editor\n\n"
            f"INSERT INTO agroplanet_competitors\n  ({col_list})\nVALUES\n"
            + ",\n".join(batch)
            + f"\nON CONFLICT (id) DO UPDATE SET\n  {update_set};\n"
        )
        out = OUTPUT_DIR / (f"insert_competitors_p{i+1}.sql" if n_parts > 1 else "insert_competitors.sql")
        out.write_text(content, encoding="utf-8")

    files = [OUTPUT_DIR / (f"insert_competitors_p{i+1}.sql" if n_parts > 1 else "insert_competitors.sql") for i in range(n_parts)]
    log.info(f"  SQL generado: {[f.name for f in files]}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    log.info("═" * 65)
    log.info("  AGROPLANET Competidores — Overpass OSM scraper")
    log.info("═" * 65)

    query    = build_query()
    elements = fetch_overpass(query)

    if not elements:
        log.error("Sin datos de Overpass — verifica conexión o aumenta timeout")
        sys.exit(1)

    df = parse_elements(elements)
    df = dedup(df)
    df = enrich_with_cut(df)

    # Guardar CSV raw
    raw_path = OUTPUT_DIR / "competitors_raw.csv"
    df.to_csv(raw_path, index=False, encoding="utf-8")
    log.info(f"  CSV raw: {raw_path.name} ({len(df)} filas)")

    # Resumen final
    log.info("\n  RESUMEN POR CATEGORÍA:")
    for cat, cnt in df["categoria"].value_counts().items():
        marcas_sample = df[df["categoria"] == cat]["marca"].dropna().unique()[:3]
        log.info(f"    {cat:<30} {cnt:>4}   {list(marcas_sample)}")

    log.info("\n  TOP 10 POR REGIÓN:")
    if "region" in df.columns and df["region"].notna().any():
        log.info("\n" + df["region"].value_counts().head(10).to_string())

    generate_sql(df)

    log.info("═" * 65)
    log.info(f"  Listo. {len(df)} competidores → etl/output/")
    log.info("  Siguiente: verificar CSV, luego pegar SQL en Lovable")
    log.info("═" * 65)


if __name__ == "__main__":
    main()
