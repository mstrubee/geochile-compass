#!/usr/bin/env python3
"""
AGROPLANET ETL — Score Comunal Nacional v1.1
═══════════════════════════════════════════════════════════════════════════════
Genera score 0–100 por comuna para retail de repuestos de maquinaria agrícola.

FUENTES REALES (confirmadas):
  1. superficie-categoría-cultivo-región-comuna.xlsx  ← INE Censo 2021, comunal
  2. seccion_9_frutales.csv                           ← microdata predial Censo 2021
  3. catastro_fruticola_2025.csv                      ← ODEPA (descarga automática)
  4. Atlas_Rural_de_Chile.zip                         ← INDAP tipologías territoriales

VARIABLES DEL SCORE (v1.1 — sin datos de tamaño predial):
  ha_frutales_riego    Fruticultura intensiva bajo riego
  ha_cereales_total    Cereales + cultivos industriales (raps, tomate)
  ha_vinas_riego       Viñas — sector con mayor mecanización especializada
  diversidad_especies  N° especies frutícolas — proxy de variedad de maquinaria
  ha_forrajeras_total  Forrajeras + praderas — ganadería mecanizada (sur)

USO:
  pip install -r requirements.txt
  python agroplanet_etl.py

  # Con carga a Supabase:
  VITE_SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... python agroplanet_etl.py
═══════════════════════════════════════════════════════════════════════════════
"""

import os
import sys
import logging
import unicodedata
import warnings
import zipfile
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import requests

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# RUTAS — ajustar si los archivos están en otra ubicación
# ─────────────────────────────────────────────────────────────────────────────

REPO_ROOT  = Path(__file__).resolve().parent.parent
DATA_DIR   = Path(__file__).parent / "data"
OUTPUT_DIR = Path(__file__).parent / "output"

# Archivos fuente (el script los busca primero en DATA_DIR, luego aquí)
FUENTES = {
    "xlsx_superficie": Path(
        "/Users/mstrubee/Library/CloudStorage/OneDrive-GrupoPlanetSpA"
        "/Locales Grupo Planet/Varios/Geoloc/Agroplanet"
        "/superficie-categoría-cultivo-región-comuna.xlsx"
    ),
    "csv_frutales": Path(
        "/Users/mstrubee/Library/CloudStorage/OneDrive-GrupoPlanetSpA"
        "/Locales Grupo Planet/Varios/Geoloc/Agroplanet"
        "/seccion_9_frutales.csv"
    ),
    "atlas_rural_zip": Path("/Users/mstrubee/Downloads/Atlas_Rural_de_Chile.zip"),
    "codigos_csv":    REPO_ROOT / "public" / "codigos_territoriales.csv",
    "comunas_geojson": REPO_ROOT / "public" / "comunas.geojson",
}

# Catastro Frutícola 2025 (descarga automática)
URL_CATASTRO = (
    "https://datos.odepa.gob.cl/dataset/"
    "ea82304e-917f-4cdb-abf6-555782483dc1/resource/"
    "1bbc9838-6032-4b89-96e5-8c2ed5d91e3f/download/catastro_fruticola_2025.csv"
)

# Credenciales Supabase
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
MODEL_VERSION = "v1.1"

DATA_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# PESOS DEL MODELO v1.1
# (sin tractores ni tamaño predial — datos no disponibles en este dataset)
# ─────────────────────────────────────────────────────────────────────────────

PESOS_GRANDES = {
    "ha_frutales_riego":   0.35,  # Fruticultura = maquinaria especializada y costosa
    "ha_cereales_total":   0.20,  # Cereales + raps → combinadas, tractores pesados
    "ha_vinas_riego":      0.20,  # Viñas = mayor densidad de maquinaria de Chile
    "diversidad_especies": 0.15,  # Variedad de frutas → variedad de repuestos
    "ha_forrajeras_total": 0.10,  # Ganadería mecanizada (menos relevante en sur)
}

PESOS_INDAP = {
    "ha_frutales_riego":   0.15,  # Menor peso: fruticultura industrial es de grandes
    "ha_cereales_total":   0.40,  # Principal cultivo INDAP: trigo, avena, cebada
    "ha_vinas_riego":      0.05,
    "diversidad_especies": 0.10,
    "ha_forrajeras_total": 0.30,  # INDAP sur = ganadería + forrajeras
}

# Columnas del xlsx (índices 0-based confirmados empíricamente)
XLSX_COLS = {
    "region":              1,
    "comuna":              2,
    "cereales_riego":      6,
    "cereales_secano":     7,
    "industriales_riego":  12,
    "industriales_secano": 13,
    "frutales_riego":      18,
    "frutales_secano":     19,
    "vinas_riego":         21,
    "vinas_secano":        22,
    "forrajeras_riego":    33,
    "forrajeras_secano":   34,
    "praderas_riego":      36,
    "praderas_secano":     37,
}

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(OUTPUT_DIR / "etl.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("agroplanet-etl")

# ─────────────────────────────────────────────────────────────────────────────
# UTILIDADES
# ─────────────────────────────────────────────────────────────────────────────

def normalize_name(name: str) -> str:
    """'Los Ángeles' → 'los angeles' | 'Ñuble' → 'nuble'"""
    if pd.isna(name):
        return ""
    nfkd = unicodedata.normalize("NFKD", str(name))
    return nfkd.encode("ASCII", "ignore").decode("ASCII").lower().strip()


# Alias para comunas con nombre combinado o problemático en las fuentes
NAME_ALIASES: dict[str, str] = {
    "iquique/alto hospicio":     "iquique",      # xlsx combina dos comunas → quedarse con Iquique
    "o higgins":                 "o'higgins",
    "ohiggins":                  "o'higgins",
    "padre las casas":           "padre las casas",
    "p. las casas":              "padre las casas",
    "la calera":                 "calera",
    "cabo de hornos (ex navarino)": "cabo de hornos",
    "antartica":                 "antartica",
    "la antartica":              "antartica",
}


def clean_name(name: str) -> str:
    n = normalize_name(name)
    return NAME_ALIASES.get(n, n)


def to_float(val) -> float:
    """Convierte valor (puede ser str con coma, NaN, None) a float."""
    if pd.isna(val):
        return 0.0
    try:
        return float(str(val).replace(",", ".").replace(" ", ""))
    except (ValueError, TypeError):
        return 0.0


def normalize_score(series: pd.Series, clip_pct: float = 97) -> pd.Series:
    """Min-max con clip al percentil clip_pct para robustez ante outliers."""
    s = series.fillna(0.0)
    upper = s.quantile(clip_pct / 100)
    if upper == 0:
        return pd.Series(0.0, index=series.index)
    s = s.clip(upper=upper)
    mn, mx = s.min(), s.max()
    if mx == mn:
        return pd.Series(0.0, index=series.index)
    return (s - mn) / (mx - mn)


def assign_quintiles(scores: pd.Series) -> pd.Series:
    """Quintiles nacionales 1–5 (5 = mayor potencial)."""
    return pd.qcut(
        scores, q=5, labels=[1, 2, 3, 4, 5], duplicates="drop"
    ).astype(int)


def resolve_path(key: str) -> Path | None:
    """Busca archivo en DATA_DIR primero, luego en la ruta OneDrive original."""
    onedrive_path = FUENTES[key]
    local_copy    = DATA_DIR / onedrive_path.name
    if local_copy.exists():
        return local_copy
    if onedrive_path.exists():
        return onedrive_path
    return None


# ─────────────────────────────────────────────────────────────────────────────
# PASO 1 — Tabla maestra de CUT codes (346 comunas)
# ─────────────────────────────────────────────────────────────────────────────

def load_cut_lookup() -> pd.DataFrame:
    log.info("PASO 1 — Cargando tabla CUT codes …")
    df = pd.read_csv(FUENTES["codigos_csv"], dtype=str)
    df.columns = ["region_id", "region", "province_id", "province", "cut", "nombre"]
    df["cut"]        = df["cut"].str.zfill(5)
    df["region_id"]  = df["region_id"].str.zfill(2)
    df["nombre_norm"] = df["nombre"].apply(clean_name)
    log.info(f"  {len(df)} comunas")
    return df[["cut", "nombre", "region", "region_id", "nombre_norm"]]


def build_name_to_cut(lookup: pd.DataFrame) -> dict[str, str]:
    return dict(zip(lookup["nombre_norm"], lookup["cut"]))


# ─────────────────────────────────────────────────────────────────────────────
# PASO 2 — xlsx: Superficie por categoría de cultivo y comuna (INE Censo 2021)
# ─────────────────────────────────────────────────────────────────────────────

def load_xlsx_superficie(name_to_cut: dict) -> pd.DataFrame:
    """
    Parsea el Excel con estructura multi-header del INE.
    Extrae filas de comunas y renombra columnas por posición confirmada.
    """
    log.info("PASO 2 — Cargando xlsx superficie cultivos …")
    path = resolve_path("xlsx_superficie")
    if path is None:
        log.error("  ❌ archivo no encontrado. Verificar ruta en FUENTES['xlsx_superficie']")
        raise FileNotFoundError("superficie-categoría-cultivo-región-comuna.xlsx")

    raw = pd.read_excel(path, header=None)
    log.info(f"  Shape raw: {raw.shape}")

    # Filtrar filas de comunas (col 2 no nula y no totales)
    EXCLUIR = {"Total Región", "Total Nacional", "Comuna 5,6", "nan", ""}
    mask = (
        raw.iloc[:, 2].notna() &
        (~raw.iloc[:, 2].astype(str).isin(EXCLUIR)) &
        (~raw.iloc[:, 1].astype(str).str.startswith("21."))  # fila de título
    )
    comunas = raw[mask].copy().reset_index(drop=True)
    log.info(f"  Filas de comunas detectadas: {len(comunas)}")

    # Renombrar columnas clave por posición
    col_rename = {v: k for k, v in XLSX_COLS.items()}
    comunas = comunas.rename(columns=col_rename)

    # Convertir columnas numéricas a float (excluir region y comuna que son texto)
    COLS_NUMERICAS = {k for k in XLSX_COLS.keys() if k not in ("region", "comuna")}
    for col in COLS_NUMERICAS:
        if col in comunas.columns:
            comunas[col] = comunas[col].apply(to_float)

    # Calcular variables derivadas
    comunas["ha_cereales_total"]   = (
        comunas["cereales_riego"] + comunas["cereales_secano"] +
        comunas["industriales_riego"] + comunas["industriales_secano"]
    )
    comunas["ha_frutales_total"]   = comunas["frutales_riego"] + comunas["frutales_secano"]
    comunas["ha_frutales_riego"]   = comunas["frutales_riego"]
    comunas["ha_vinas_riego"]      = comunas["vinas_riego"]
    comunas["ha_vinas_total"]      = comunas["vinas_riego"] + comunas["vinas_secano"]
    comunas["ha_forrajeras_total"] = (
        comunas["forrajeras_riego"] + comunas["forrajeras_secano"] +
        comunas["praderas_riego"]  + comunas["praderas_secano"]
    )
    # Índice de mecanización (proxy tractores — para display/contexto)
    comunas["indice_mecanizable"] = (
        comunas["ha_cereales_total"] +
        comunas["ha_frutales_total"] +
        comunas["ha_vinas_total"]
    )

    # JOIN con CUT por nombre de comuna (col 2)
    comunas["nombre_norm"] = comunas["comuna"].astype(str).apply(clean_name)
    comunas["cut"] = comunas["nombre_norm"].map(name_to_cut)

    sin_cut = comunas[comunas["cut"].isna()]["comuna"].unique()
    if len(sin_cut) > 0:
        log.warning(f"  Comunas sin CUT match ({len(sin_cut)}): {list(sin_cut[:8])}")

    # Agregar por CUT (puede haber duplicados si un nombre matchea varias veces)
    vars_num = [
        "ha_cereales_total", "ha_frutales_total", "ha_frutales_riego",
        "ha_vinas_riego", "ha_vinas_total", "ha_forrajeras_total",
        "indice_mecanizable",
    ]
    result = (
        comunas.dropna(subset=["cut"])
        .groupby("cut")[vars_num]
        .sum()
        .reset_index()
    )
    log.info(
        f"  Comunas con datos superficie: {len(result)} | "
        f"ha frutales riego: {result['ha_frutales_riego'].sum():,.0f} | "
        f"ha cereales: {result['ha_cereales_total'].sum():,.0f}"
    )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3 — CSV frutales: Diversidad de especies por comuna
# ─────────────────────────────────────────────────────────────────────────────

def load_diversidad_especies() -> pd.DataFrame:
    """
    Cuenta n° de especies frutícolas distintas por CUT_COMUNA.
    Fuente: seccion_9_frutales.csv (microdata predial Censo 2021)
    """
    log.info("PASO 3 — CSV frutales: diversidad de especies …")
    path = resolve_path("csv_frutales")
    if path is None:
        log.warning("  CSV frutales no encontrado → diversidad_especies = 0")
        return pd.DataFrame(columns=["cut", "diversidad_especies"])

    # Probar encodings
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            df = pd.read_csv(path, sep=";", decimal=",", encoding=enc, low_memory=False)
            break
        except UnicodeDecodeError:
            continue
    else:
        log.error("  No se pudo leer el CSV con ningún encoding")
        return pd.DataFrame(columns=["cut", "diversidad_especies"])

    # Limpiar nombre de la primera columna (posible BOM)
    df.columns = [c.strip().strip('"').lstrip("﻿") for c in df.columns]

    # CUT_COMUNA como string 5 dígitos
    if "CUT_COMUNA" not in df.columns:
        log.error(f"  Columna CUT_COMUNA no encontrada. Columnas: {list(df.columns[:8])}")
        return pd.DataFrame(columns=["cut", "diversidad_especies"])

    df["cut"] = df["CUT_COMUNA"].astype(str).str.strip().str.zfill(5)

    # Limpiar nombre de especie
    especie_col = next(
        (c for c in ["SS92_Glo", "SS92_GLO", "ESPECIE"] if c in df.columns), None
    )
    if not especie_col:
        log.warning("  Columna de especie no encontrada")
        return pd.DataFrame(columns=["cut", "diversidad_especies"])

    div = (
        df[df[especie_col].notna()]
        .groupby("cut")[especie_col]
        .nunique()
        .reset_index(name="diversidad_especies")
    )
    log.info(
        f"  Comunas con frutales: {len(div)} | "
        f"máx especies: {div['diversidad_especies'].max()} "
        f"({div.loc[div['diversidad_especies'].idxmax(), 'cut']})"
    )
    return div


# ─────────────────────────────────────────────────────────────────────────────
# PASO 4 — Catastro Frutícola 2025: validación y actualización (ODEPA)
# ─────────────────────────────────────────────────────────────────────────────

def load_catastro_fruticola_2025(name_to_cut: dict) -> pd.DataFrame:
    """
    Descarga el Catastro Frutícola 2025 y extrae ha_frutales_riego actualizado.
    Si la descarga falla, retorna DataFrame vacío (el xlsx del Censo cubre este campo).
    """
    log.info("PASO 4 — Catastro Frutícola 2025 (ODEPA) …")
    dest = DATA_DIR / "catastro_fruticola_2025.csv"

    if not dest.exists():
        try:
            log.info("  Descargando …")
            r = requests.get(URL_CATASTRO, timeout=90, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            dest.write_bytes(r.content)
            log.info(f"  Guardado ({dest.stat().st_size // 1024} KB)")
        except Exception as e:
            log.warning(f"  Descarga fallida: {e}. Usando Censo 2021 para frutales.")
            return pd.DataFrame(columns=["cut", "ha_frutales_riego_2025", "diversidad_esp_2025"])
    else:
        log.info(f"  Usando cache → {dest.name}")

    for enc in ("utf-8", "latin-1", "utf-8-sig"):
        try:
            df = pd.read_csv(dest, encoding=enc, low_memory=False)
            break
        except UnicodeDecodeError:
            continue
    else:
        return pd.DataFrame(columns=["cut", "ha_frutales_riego_2025", "diversidad_esp_2025"])

    # Detectar columnas clave
    cols = {c.lower().strip(): c for c in df.columns}

    def find(*cands):
        for c in cands:
            if c in cols:
                return cols[c]
        # búsqueda parcial
        for c in cands:
            for k, v in cols.items():
                if c in k:
                    return v
        return None

    col_comuna  = find("comuna", "nombre_comuna", "nmcomuna")
    col_especie = find("especie", "nom_especie", "especie_nombre")
    col_metodo  = find("metodo de riego", "metodo_riego", "sistema_riego")   # string col
    col_total   = find("superficie (ha)", "superficie_total", "ha_total",
                       "superficie", "superficiehectareas")                  # numeric col
    col_riego   = None  # el catastro 2025 no tiene ha_riego como columna numérica

    if not col_comuna:
        log.warning("  Columna COMUNA no encontrada en catastro 2025")
        return pd.DataFrame(columns=["cut", "ha_frutales_riego_2025", "diversidad_esp_2025"])

    df["nombre_norm"] = df[col_comuna].apply(clean_name)
    df["cut"]         = df["nombre_norm"].map(name_to_cut)

    def parse_ha(series: pd.Series) -> pd.Series:
        """Convierte columnas con decimal coma chilena ('1,30') a float."""
        return pd.to_numeric(
            series.astype(str).str.replace(",", ".", regex=False),
            errors="coerce"
        ).fillna(0)

    if col_riego:
        df["_riego"] = parse_ha(df[col_riego])
    elif col_total:
        df["_riego"] = parse_ha(df[col_total])
    else:
        df["_riego"] = 0

    agg = df.dropna(subset=["cut"]).groupby("cut").agg(
        ha_frutales_riego_2025=("_riego", "sum"),
        diversidad_esp_2025=(col_especie, pd.Series.nunique) if col_especie else ("_riego", "count"),
    ).reset_index()

    log.info(
        f"  Catastro 2025: {len(agg)} comunas | "
        f"ha riego total: {agg['ha_frutales_riego_2025'].sum():,.0f}"
    )
    return agg


# ─────────────────────────────────────────────────────────────────────────────
# PASO 5 — Atlas Rural: tipología territorial por comuna (join espacial)
# ─────────────────────────────────────────────────────────────────────────────

def load_tipologia_rural() -> pd.DataFrame:
    """
    Join espacial: centroide de cada comuna → tipología territorial del Atlas Rural.
    Requiere geopandas. Si no está instalado, retorna DataFrame vacío.
    """
    log.info("PASO 5 — Atlas Rural: tipología territorial …")

    atlas_zip = FUENTES["atlas_rural_zip"]
    if not atlas_zip.exists():
        log.warning(f"  Atlas Rural ZIP no encontrado: {atlas_zip}. Saltando tipología.")
        return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

    try:
        import geopandas as gpd
    except ImportError:
        log.warning("  geopandas no instalado. Ejecutar: pip install geopandas")
        log.warning("  Saltando join de tipología rural.")
        return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

    # Extraer SHP a directorio temporal
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(atlas_zip, "r") as zf:
            zf.extractall(tmp)
        shp_files = list(Path(tmp).glob("*.shp"))
        if not shp_files:
            log.error("  No se encontró .shp dentro del ZIP")
            return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

        atlas = gpd.read_file(shp_files[0], encoding="utf-8")
        if atlas.crs is None or atlas.crs.to_epsg() != 4326:
            atlas = atlas.to_crs(epsg=4326)
        log.info(f"  Atlas Rural: {len(atlas)} tipologías | CRS: {atlas.crs}")

        # Cargar geometrías de comunas
        comunas_geo_path = FUENTES["comunas_geojson"]
        if not comunas_geo_path.exists():
            log.warning("  comunas.geojson no encontrado en repo")
            return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

        comunas_geo = gpd.read_file(comunas_geo_path)
        if comunas_geo.crs is None or comunas_geo.crs.to_epsg() != 4326:
            comunas_geo = comunas_geo.to_crs(epsg=4326)

        # Detectar columna CUT en el GeoJSON
        cut_col = next(
            (c for c in ["codigo_comuna", "cod_comuna", "CUT", "cut"]
             if c in comunas_geo.columns),
            None
        )
        if not cut_col:
            log.warning(f"  Columna CUT no encontrada. Columnas: {list(comunas_geo.columns[:8])}")
            return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

        comunas_geo["cut"] = comunas_geo[cut_col].astype(str).str.zfill(5)

        # Usar centroides para el join
        centroides = comunas_geo[["cut", "geometry"]].copy()
        centroides["geometry"] = centroides.geometry.centroid

        # Join espacial: centroide → tipología
        joined = gpd.sjoin(
            centroides, atlas[["MACROZONA", "TIPOLOGIA", "CODIGO", "geometry"]],
            how="left", predicate="within"
        )

        result = (
            joined[["cut", "MACROZONA", "TIPOLOGIA", "CODIGO"]]
            .drop_duplicates("cut")
            .rename(columns={
                "MACROZONA": "macrozona",
                "TIPOLOGIA": "tipologia",
                "CODIGO":    "codigo_tipologia",
            })
        )

        matched = result["macrozona"].notna().sum()
        log.info(f"  Tipología asignada a {matched}/{len(result)} comunas")
        return result


# ─────────────────────────────────────────────────────────────────────────────
# PASO 6 — Merge de todas las fuentes
# ─────────────────────────────────────────────────────────────────────────────

def merge_all(
    lookup:       pd.DataFrame,
    superficie:   pd.DataFrame,
    diversidad:   pd.DataFrame,
    catastro_25:  pd.DataFrame,
    tipologia:    pd.DataFrame,
) -> pd.DataFrame:
    log.info("PASO 6 — Merging fuentes …")

    df = lookup.copy()

    for label, src in [
        ("xlsx superficie",     superficie),
        ("diversidad especies", diversidad),
        ("catastro 2025",       catastro_25),
        ("tipología rural",     tipologia),
    ]:
        before = len(df)
        df = df.merge(src, on="cut", how="left")
        log.info(f"  Merge {label}: {len(src)} filas → {before} → {len(df)}")

    # ── Resolver ha_frutales_riego: usar Catastro 2025 si disponible, sino xlsx ──
    if "ha_frutales_riego_2025" in df.columns:
        df["ha_frutales_riego"] = np.where(
            df["ha_frutales_riego_2025"].notna() & (df["ha_frutales_riego_2025"] > 0),
            df["ha_frutales_riego_2025"],
            df.get("ha_frutales_riego", 0),
        )
        # Diversidad: usar Catastro 2025 si supera al Censo
        if "diversidad_esp_2025" in df.columns:
            df["diversidad_especies"] = df[["diversidad_especies", "diversidad_esp_2025"]].max(axis=1)

    # ── Rellenar NaN ────────────────────────────────────────────────────────────
    VARS_SCORE = [
        "ha_frutales_riego", "ha_cereales_total", "ha_vinas_riego",
        "diversidad_especies", "ha_forrajeras_total",
    ]
    VARS_AUX = [
        "ha_frutales_total", "ha_vinas_total", "indice_mecanizable",
    ]
    for col in VARS_SCORE + VARS_AUX:
        if col not in df.columns:
            df[col] = 0.0
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

    log.info(f"  Merge final: {len(df)} comunas | {len(df.columns)} columnas")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 7 — Calcular scores y quintiles
# ─────────────────────────────────────────────────────────────────────────────

def compute_scores(df: pd.DataFrame) -> pd.DataFrame:
    log.info("PASO 7 — Calculando scores …")

    VARIABLES = list(PESOS_GRANDES.keys())
    norm = {}
    for var in VARIABLES:
        norm[var] = normalize_score(df[var]) if var in df.columns else pd.Series(0.0, index=df.index)

    df["score_grandes"]  = sum(PESOS_GRANDES[v] * norm[v] for v in VARIABLES) * 100
    df["score_indap"]    = sum(PESOS_INDAP[v]   * norm[v] for v in VARIABLES) * 100
    df["score_combined"] = 0.60 * df["score_grandes"] + 0.40 * df["score_indap"]

    for score_col, quintil_col in [
        ("score_grandes",  "quintil_grandes"),
        ("score_indap",    "quintil_indap"),
        ("score_combined", "quintil_combined"),
    ]:
        df[quintil_col] = assign_quintiles(df[score_col])

    log.info(
        f"  Score combined — "
        f"media: {df['score_combined'].mean():.1f} | "
        f"max: {df['score_combined'].max():.1f} | "
        f"min: {df['score_combined'].min():.1f}"
    )
    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 8 — Validar
# ─────────────────────────────────────────────────────────────────────────────

def validate(df: pd.DataFrame, lookup: pd.DataFrame) -> None:
    log.info("PASO 8 — Validación …")
    log.info(f"  Comunas en output: {len(df)} (esperadas: 346)")
    if len(df) != 346:
        missing = set(lookup["nombre"]) - set(
            lookup.merge(df[["cut"]], on="cut", how="inner")["nombre"]
        )
        log.warning(f"  Comunas sin score: {sorted(missing)[:10]}")

    # Variables con demasiados ceros
    for var in PESOS_GRANDES:
        pct_zero = (df.get(var, pd.Series(0)) == 0).mean() * 100
        if pct_zero > 70:
            log.warning(f"  '{var}': {pct_zero:.0f}% de comunas en 0 — revisar fuente")

    # Top 30
    top = df.nlargest(30, "score_combined")[
        ["nombre", "region", "score_combined", "quintil_combined",
         "score_grandes", "score_indap"]
    ]
    log.info(f"\n  TOP 30 COMUNAS:\n{top.to_string(index=False)}\n")

    # Distribución quintiles
    log.info(f"  Quintiles combined: {df['quintil_combined'].value_counts().sort_index().to_dict()}")

    # Por región (top 5)
    reg = df.groupby("region")["score_combined"].mean().sort_values(ascending=False)
    log.info(f"\n  Score promedio por región (top 5):\n{reg.head(5).to_string()}\n")


# ─────────────────────────────────────────────────────────────────────────────
# PASO 9 — Guardar CSV
# ─────────────────────────────────────────────────────────────────────────────

COLUMNAS_SALIDA = [
    "cut", "nombre", "region", "region_id",
    # Variables raw
    "ha_frutales_riego", "ha_frutales_total",
    "ha_cereales_total", "ha_vinas_riego", "ha_vinas_total",
    "ha_forrajeras_total", "diversidad_especies", "indice_mecanizable",
    # Scores
    "score_grandes", "score_indap", "score_combined",
    # Quintiles
    "quintil_grandes", "quintil_indap", "quintil_combined",
    # Tipología
    "macrozona", "tipologia", "codigo_tipologia",
]


def save_output(df: pd.DataFrame) -> Path:
    cols = [c for c in COLUMNAS_SALIDA if c in df.columns]
    out  = df[cols].sort_values("score_combined", ascending=False)
    path = OUTPUT_DIR / "agroplanet_comunas.csv"
    out.to_csv(path, index=False, encoding="utf-8")
    log.info(f"PASO 9 — CSV guardado: {path.name} ({path.stat().st_size // 1024} KB)")
    return path


# ─────────────────────────────────────────────────────────────────────────────
# PASO 10 — Subir a Supabase
# ─────────────────────────────────────────────────────────────────────────────

def upload_supabase(df: pd.DataFrame) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.info(
            "PASO 10 — Supabase: sin credenciales. Para cargar:\n"
            "  VITE_SUPABASE_URL=https://xxx.supabase.co "
            "SUPABASE_SERVICE_KEY=eyJ... python agroplanet_etl.py"
        )
        return

    log.info("PASO 10 — Subiendo a Supabase …")
    try:
        from supabase import create_client
        client = create_client(SUPABASE_URL, SUPABASE_KEY)

        cols    = [c for c in COLUMNAS_SALIDA if c in df.columns]
        records = (
            df[cols]
            .where(pd.notna(df[cols]), other=None)
            .assign(model_version=MODEL_VERSION)
            .to_dict(orient="records")
        )

        for i in range(0, len(records), 100):
            batch = records[i: i + 100]
            client.table("agroplanet_comunas").upsert(batch, on_conflict="cut").execute()

        log.info(f"  ✓ {len(records)} comunas cargadas (versión {MODEL_VERSION})")

    except ImportError:
        log.error("  pip install supabase")
    except Exception as e:
        log.error(f"  Error: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    log.info("═" * 70)
    log.info(f"  AGROPLANET ETL — Score Comunal Nacional {MODEL_VERSION}")
    log.info("═" * 70)

    lookup       = load_cut_lookup()
    name_to_cut  = build_name_to_cut(lookup)

    superficie   = load_xlsx_superficie(name_to_cut)
    diversidad   = load_diversidad_especies()
    catastro_25  = load_catastro_fruticola_2025(name_to_cut)
    tipologia    = load_tipologia_rural()

    df = merge_all(lookup, superficie, diversidad, catastro_25, tipologia)
    df = compute_scores(df)

    validate(df, lookup)
    save_output(df)
    upload_supabase(df)

    log.info("═" * 70)
    log.info("  ETL completado. Output: etl/output/agroplanet_comunas.csv")
    log.info("═" * 70)


if __name__ == "__main__":
    main()
