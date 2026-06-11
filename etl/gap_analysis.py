#!/usr/bin/env python3
"""
AGROPLANET — Fase 3: Gap Analysis IDPA × Cobertura de Dealers
═══════════════════════════════════════════════════════════════════════════════
Calcula el score de oportunidad por comuna:

    oportunidad_score = score_combined × cobertura_gap_factor

donde cobertura_gap_factor refleja qué tan lejos está la comuna del dealer
más cercano (proxy de isócrona 45-min en carretera rural chilena).

Modelo de cobertura (lineal por tramos):
  dist < COBERTURA_PLENA_KM  → cubierta (factor = 0, sin oportunidad de dealer)
  dist > SIN_COBERTURA_KM    → sin cobertura (factor = 1, máxima oportunidad)
  entre ambos                → interpolación lineal

Valores por defecto:
  COBERTURA_PLENA_KM = 35   (~35 min a 60 km/h en ruta rural)
  SIN_COBERTURA_KM   = 90   (~90 min, zona sin cobertura real)

SALIDA:
  etl/output/gap_analysis.csv          ← ranking completo 346 comunas
  etl/output/update_oportunidad.sql    ← UPDATE para Lovable SQL editor

USO:
  python3 etl/gap_analysis.py
═══════════════════════════════════════════════════════════════════════════════
"""

import logging
import math
import sys
from pathlib import Path

import pandas as pd

# ─────────────────────────────────────────────────────────────────────────────
REPO_ROOT   = Path(__file__).resolve().parent.parent
DATA_DIR    = Path(__file__).parent / "data"
OUTPUT_DIR  = Path(__file__).parent / "output"

COMUNAS_GEOJSON     = REPO_ROOT / "public" / "comunas.geojson"
AGROPLANET_CSV      = OUTPUT_DIR / "agroplanet_comunas.csv"
COMPETITORS_CSV     = OUTPUT_DIR / "competitors_raw.csv"

COBERTURA_PLENA_KM = 35
SIN_COBERTURA_KM   = 90

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("gap-analysis")

# ─────────────────────────────────────────────────────────────────────────────
# UTILIDADES
# ─────────────────────────────────────────────────────────────────────────────

def haversine_km(lat1, lng1, lat2, lng2) -> float:
    """Distancia en km entre dos puntos (WGS84)."""
    R = 6371.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lng2 - lng1)
    a = math.sin(Δφ/2)**2 + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def coverage_gap_factor(min_dist_km: float) -> float:
    """
    0.0 = totalmente cubierto (cerca de un dealer)
    1.0 = sin cobertura (lejos de cualquier dealer)
    """
    if min_dist_km <= COBERTURA_PLENA_KM:
        return 0.0
    if min_dist_km >= SIN_COBERTURA_KM:
        return 1.0
    return (min_dist_km - COBERTURA_PLENA_KM) / (SIN_COBERTURA_KM - COBERTURA_PLENA_KM)


# ─────────────────────────────────────────────────────────────────────────────
# PASO 1 — Centroides de comunas desde GeoJSON
# ─────────────────────────────────────────────────────────────────────────────

def load_commune_centroids() -> pd.DataFrame:
    log.info("PASO 1 — Centroides de comunas desde GeoJSON …")
    try:
        import geopandas as gpd
        gdf = gpd.read_file(COMUNAS_GEOJSON)
        if gdf.crs is None or gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        cut_col = next(
            (c for c in ["codigo_comuna", "cod_comuna", "CUT", "cut"] if c in gdf.columns),
            None,
        )
        if not cut_col:
            raise ValueError(f"No se encontró columna CUT. Columnas: {list(gdf.columns)}")

        centroids = gdf.copy()
        centroids["geometry"] = gdf.geometry.centroid
        centroids["cut"]      = centroids[cut_col].astype(str).str.zfill(5)
        centroids["cent_lat"] = centroids.geometry.y
        centroids["cent_lng"] = centroids.geometry.x

        result = centroids[["cut", "cent_lat", "cent_lng"]].drop_duplicates("cut")
        log.info(f"  {len(result)} centroides cargados")
        return result

    except ImportError:
        log.warning("  geopandas no disponible — usando centroides aproximados del CSV AGROPLANET")
        return pd.DataFrame(columns=["cut", "cent_lat", "cent_lng"])


# ─────────────────────────────────────────────────────────────────────────────
# PASO 2 — Cargar scores AGROPLANET
# ─────────────────────────────────────────────────────────────────────────────

def load_agroplanet() -> pd.DataFrame:
    log.info("PASO 2 — Scores AGROPLANET v2.0 …")
    df = pd.read_csv(AGROPLANET_CSV, dtype={"cut": str})
    df["cut"] = df["cut"].str.zfill(5)
    log.info(f"  {len(df)} comunas cargadas")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3 — Cargar competidores
# ─────────────────────────────────────────────────────────────────────────────

def load_competitors() -> pd.DataFrame:
    log.info("PASO 3 — Competidores OSM …")
    df = pd.read_csv(COMPETITORS_CSV, dtype={"cut": str})
    df = df[df["lat"].notna() & df["lng"].notna()].copy()
    log.info(f"  {len(df)} competidores cargados")
    log.info(f"  Marcas: {df['marca'].dropna().value_counts().to_dict()}")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 4 — Calcular distancia mínima a dealer más cercano
# ─────────────────────────────────────────────────────────────────────────────

def compute_min_distances(centroids: pd.DataFrame, competitors: pd.DataFrame) -> pd.DataFrame:
    log.info("PASO 4 — Distancias mínimas a dealer más cercano …")

    comp_coords = list(zip(competitors["lat"], competitors["lng"]))

    results = []
    for _, row in centroids.iterrows():
        if pd.isna(row["cent_lat"]) or pd.isna(row["cent_lng"]):
            results.append({"cut": row["cut"], "dist_nearest_km": 9999.0, "nearest_competitor": None})
            continue

        min_dist   = float("inf")
        min_nombre = None
        for i, (clat, clng) in enumerate(comp_coords):
            d = haversine_km(row["cent_lat"], row["cent_lng"], clat, clng)
            if d < min_dist:
                min_dist   = d
                min_nombre = competitors.iloc[i]["nombre"]

        results.append({
            "cut":               row["cut"],
            "dist_nearest_km":   round(min_dist, 1),
            "nearest_competitor": min_nombre,
        })

    df = pd.DataFrame(results)
    log.info(
        f"  Distancia media: {df['dist_nearest_km'].mean():.0f} km | "
        f"mín: {df['dist_nearest_km'].min():.0f} km | "
        f"máx: {df['dist_nearest_km'].max():.0f} km"
    )
    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 5 — Calcular oportunidad_score
# ─────────────────────────────────────────────────────────────────────────────

def compute_opportunity(agro: pd.DataFrame, distances: pd.DataFrame) -> pd.DataFrame:
    log.info("PASO 5 — Calculando oportunidad_score …")

    df = agro.merge(distances, on="cut", how="left")
    df["dist_nearest_km"] = df["dist_nearest_km"].fillna(9999)

    df["cobertura_gap"]    = df["dist_nearest_km"].apply(coverage_gap_factor)
    df["oportunidad_score"] = (df["score_combined"] * df["cobertura_gap"]).round(2)

    # Normalizar a 0–100
    max_op = df["oportunidad_score"].max()
    if max_op > 0:
        df["oportunidad_norm"] = (df["oportunidad_score"] / max_op * 100).round(1)
    else:
        df["oportunidad_norm"] = 0.0

    top20 = df.nlargest(20, "oportunidad_score")[
        ["nombre", "region", "score_combined", "dist_nearest_km",
         "nearest_competitor", "cobertura_gap", "oportunidad_score", "oportunidad_norm"]
    ]
    log.info(f"\n  TOP 20 COMUNAS POR OPORTUNIDAD:\n{top20.to_string(index=False)}\n")

    # Resumen por región
    reg = df.groupby("region")["oportunidad_score"].mean().sort_values(ascending=False)
    log.info(f"\n  Oportunidad promedio por región:\n{reg.round(1).to_string()}\n")

    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 6 — Guardar CSV y SQL
# ─────────────────────────────────────────────────────────────────────────────

def save_outputs(df: pd.DataFrame) -> None:
    # CSV completo
    COLS = [
        "cut", "nombre", "region",
        "score_combined", "score_grandes", "score_indap",
        "dist_nearest_km", "nearest_competitor",
        "cobertura_gap", "oportunidad_score", "oportunidad_norm",
        "quintil_combined",
    ]
    cols = [c for c in COLS if c in df.columns]
    out_csv = OUTPUT_DIR / "gap_analysis.csv"
    df[cols].sort_values("oportunidad_score", ascending=False).to_csv(out_csv, index=False)
    log.info(f"PASO 6 — CSV: {out_csv.name} ({len(df)} comunas)")

    # SQL UPDATE
    def val(v):
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return "NULL"
        if isinstance(v, (int, float)):
            return str(round(float(v), 4))
        return "'" + str(v).replace("'", "''") + "'"

    lines = []
    for _, row in df.iterrows():
        lines.append(
            f"  UPDATE agroplanet_comunas SET "
            f"dist_nearest_competitor={val(row['dist_nearest_km'])}, "
            f"nearest_competitor={val(row.get('nearest_competitor'))}, "
            f"oportunidad_score={val(row['oportunidad_score'])}, "
            f"oportunidad_norm={val(row['oportunidad_norm'])} "
            f"WHERE cut='{row['cut']}';"
        )

    migrate_sql = """\
-- AGROPLANET Fase 3 — Agregar columnas de gap analysis
ALTER TABLE agroplanet_comunas
  ADD COLUMN IF NOT EXISTS dist_nearest_competitor float,
  ADD COLUMN IF NOT EXISTS nearest_competitor      text,
  ADD COLUMN IF NOT EXISTS oportunidad_score       float,
  ADD COLUMN IF NOT EXISTS oportunidad_norm        float;
"""

    content = (
        "-- AGROPLANET Gap Analysis — UPDATE oportunidad_score (346 comunas)\n"
        "-- Pegar en Lovable SQL editor en DOS pasos:\n"
        "-- PASO A: primero el ALTER TABLE de abajo\n"
        "-- PASO B: luego el bloque de UPDATEs\n\n"
        + migrate_sql + "\n"
        + "\n".join(lines) + "\n"
    )

    sql_path = OUTPUT_DIR / "update_oportunidad.sql"
    sql_path.write_text(content, encoding="utf-8")
    log.info(f"  SQL: {sql_path.name} ({len(lines)} UPDATEs)")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    log.info("═" * 65)
    log.info("  AGROPLANET Gap Analysis — IDPA × Cobertura Dealers")
    log.info(f"  Modelo: cobertura plena < {COBERTURA_PLENA_KM} km | sin cobertura > {SIN_COBERTURA_KM} km")
    log.info("═" * 65)

    centroids   = load_commune_centroids()
    agro        = load_agroplanet()
    competitors = load_competitors()

    if centroids.empty:
        log.error("Sin centroides — instala geopandas: pip install geopandas")
        sys.exit(1)

    distances = compute_min_distances(centroids, competitors)
    df        = compute_opportunity(agro, distances)
    save_outputs(df)

    log.info("═" * 65)
    log.info("  Listo. Siguiente: pegar update_oportunidad.sql en Lovable")
    log.info("═" * 65)


if __name__ == "__main__":
    main()
