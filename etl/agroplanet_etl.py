#!/usr/bin/env python3
"""
AGROPLANET ETL — Score Comunal Nacional (Fase 1)
═══════════════════════════════════════════════════════════════════════════════
Score 0-100 por comuna para retail de repuestos de maquinaria agrícola.

FUENTES:
  1. Catastro Frutícola 2025        → ODEPA/CIREN (descarga automática)
  2. Censo Agropecuario 2021 (INE)  → descarga MANUAL (ver PASO 3)
  3. ODEPA Cultivos Regionales 2025 → descarga automática (factor ajuste)
  4. Suelos Agrológicos CIREN       → OPCIONAL (ver PASO 4b)

USO:
  pip install -r requirements.txt
  python agroplanet_etl.py

  # Con carga automática a Supabase:
  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... python agroplanet_etl.py

SALIDA:
  etl/output/agroplanet_comunas.csv       ← tabla completa (346 comunas)
  etl/output/agroplanet_model_config.csv  ← pesos del modelo activo
═══════════════════════════════════════════════════════════════════════════════
"""

import os
import sys
import logging
import unicodedata
import warnings
from pathlib import Path
from io import BytesIO, StringIO

import numpy as np
import pandas as pd
import requests

warnings.filterwarnings("ignore", category=UserWarning)

# ─────────────────────────────────────────────────────────────────────────────
# RUTAS Y CONFIGURACIÓN
# ─────────────────────────────────────────────────────────────────────────────

REPO_ROOT   = Path(__file__).resolve().parent.parent
DATA_DIR    = Path(__file__).parent / "data"
OUTPUT_DIR  = Path(__file__).parent / "output"
SQL_DIR     = Path(__file__).parent / "sql"
CODIGOS_CSV = REPO_ROOT / "public" / "codigos_territoriales.csv"

DATA_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Credenciales Supabase (opcionales — solo para carga automática)
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")  # service_role key
MODEL_VERSION = "v1.0"

# ── URLS ──────────────────────────────────────────────────────────────────────
URLS = {
    "catastro_2025": (
        "https://datos.odepa.gob.cl/dataset/"
        "ea82304e-917f-4cdb-abf6-555782483dc1/resource/"
        "1bbc9838-6032-4b89-96e5-8c2ed5d91e3f/download/catastro_fruticola_2025.csv"
    ),
    "odepa_regional_2025": (
        "https://bibliotecadigital.odepa.gob.cl/bitstream/handle/"
        "20.500.12650/74178/CultivosRegional072025.xls"
    ),
}

# ── PESOS DEL MODELO ──────────────────────────────────────────────────────────
PESOS_GRANDES = {
    "tractores_x100ha":        0.30,
    "ha_frutales_riego":       0.20,
    "ha_cereales_oleaginosas": 0.15,
    "pct_predios_grandes":     0.20,
    "num_explot_medianas":     0.05,
    "diversidad_especies":     0.05,
    "ha_suelo_clase_I_II":     0.05,
}
PESOS_INDAP = {
    "tractores_x100ha":        0.35,
    "ha_frutales_riego":       0.10,
    "ha_cereales_oleaginosas": 0.30,
    "pct_predios_grandes":     0.05,
    "num_explot_medianas":     0.15,
    "diversidad_especies":     0.00,
    "ha_suelo_clase_I_II":     0.05,
}

# Cereales + oleaginosas que buscaremos en el Censo 2021
CEREALES_COLS = [
    "trigo", "maiz", "maíz", "cebada", "avena", "centeno",
    "triticale", "raps", "canola", "girasol", "remolacha", "arroz",
]

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
    """
    Normaliza nombre de comuna para matching robusto.
    'Los Ángeles' → 'los angeles' | 'Ñuble' → 'nuble'
    """
    if pd.isna(name):
        return ""
    nfkd = unicodedata.normalize("NFKD", str(name))
    ascii_str = nfkd.encode("ASCII", "ignore").decode("ASCII")
    return ascii_str.lower().strip()


# Alias para comunas con nombres problemáticos entre fuentes
NOMBRE_ALIASES: dict[str, str] = {
    "ohiggins":              "o higgins",
    "o'higgins":             "o higgins",
    "padre las casas":       "padre las casas",
    "p. las casas":          "padre las casas",
    "cabo de hornos":        "cabo de hornos",
    "la calera":             "calera",
    "san pedro de atacama":  "san pedro de atacama",
    "la serena":             "la serena",
    "coelemu":               "coelemu",
}


def clean_name(name: str) -> str:
    n = normalize_name(name)
    return NOMBRE_ALIASES.get(n, n)


def download_file(url: str, dest: Path, label: str) -> Path:
    """Descarga un archivo si no existe ya en cache."""
    if dest.exists():
        log.info(f"  {label}: usando cache → {dest.name}")
        return dest
    log.info(f"  {label}: descargando desde ODEPA/INE …")
    try:
        r = requests.get(url, timeout=120, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        dest.write_bytes(r.content)
        log.info(f"  {label}: guardado ({dest.stat().st_size // 1024} KB)")
        return dest
    except Exception as e:
        log.error(f"  {label}: ERROR descargando — {e}")
        raise


def normalize_score(series: pd.Series, clip_pct: float = 98) -> pd.Series:
    """
    Normalización min-max con clip al percentil clip_pct para robustez
    ante outliers (ej: Curicó con 10× más frutales que la media).
    Retorna valores 0.0–1.0.
    """
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
    """
    Quintiles nacionales 1–5 (1 = más bajo, 5 = más alto).
    Usa qcut con labels para distribuir las 346 comunas en 5 grupos iguales.
    """
    return pd.qcut(scores, q=5, labels=[1, 2, 3, 4, 5], duplicates="drop").astype(int)


# ─────────────────────────────────────────────────────────────────────────────
# PASO 1: Tabla maestra de CUT codes
# ─────────────────────────────────────────────────────────────────────────────

def load_cut_lookup() -> pd.DataFrame:
    """
    Carga codigos_territoriales.csv del repo.
    Retorna DataFrame con columnas: cut, nombre, region, region_id
    """
    log.info("PASO 1 — Cargando tabla de CUT codes …")
    df = pd.read_csv(CODIGOS_CSV, dtype=str)
    df.columns = ["region_id", "region", "province_id", "province", "cut", "nombre"]
    df["cut"]       = df["cut"].str.zfill(5)
    df["region_id"] = df["region_id"].str.zfill(2)
    df["nombre_norm"] = df["nombre"].apply(clean_name)
    log.info(f"  {len(df)} comunas cargadas")
    return df[["cut", "nombre", "region", "region_id", "nombre_norm"]]


def build_name_to_cut(lookup: pd.DataFrame) -> dict[str, str]:
    """Diccionario nombre_normalizado → cut para JOIN desde fuentes externas."""
    return dict(zip(lookup["nombre_norm"], lookup["cut"]))


# ─────────────────────────────────────────────────────────────────────────────
# PASO 2: Catastro Frutícola 2025
# ─────────────────────────────────────────────────────────────────────────────

def load_catastro_fruticola(name_to_cut: dict) -> pd.DataFrame:
    """
    Fuente: ODEPA open data (descarga automática)
    Variables extraídas por comuna:
      ha_frutales_total, ha_frutales_riego, diversidad_especies, especie_dominante
    """
    log.info("PASO 2 — Catastro Frutícola 2025 …")
    dest = DATA_DIR / "catastro_fruticola_2025.csv"
    download_file(URLS["catastro_2025"], dest, "Catastro Frutícola 2025")

    # Intentar distintos encodings (los archivos ODEPA varían)
    for enc in ("utf-8", "latin-1", "iso-8859-1", "cp1252"):
        try:
            df = pd.read_csv(dest, encoding=enc, low_memory=False)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("No se pudo leer el CSV con ningún encoding estándar")

    log.info(f"  Columnas disponibles: {list(df.columns)}")

    # ── Detectar columnas clave (ODEPA cambia nombres entre versiones) ────────
    col_map = _detect_catastro_columns(df)
    log.info(f"  Columnas detectadas: {col_map}")

    df = df.rename(columns=col_map)

    # ── Normalizar nombre de comuna y hacer JOIN con CUT ─────────────────────
    df["nombre_norm"] = df["comuna"].apply(clean_name)
    df["cut"] = df["nombre_norm"].map(name_to_cut)

    unmatched = df[df["cut"].isna()]["comuna"].unique()
    if len(unmatched) > 0:
        log.warning(f"  Comunas sin match CUT ({len(unmatched)}): {list(unmatched[:10])}")

    df = df.dropna(subset=["cut"])

    # ── Convertir hectáreas a numérico ────────────────────────────────────────
    for col in ["ha_total", "ha_riego", "ha_secano"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # ── Agregar por comuna ────────────────────────────────────────────────────
    agg = df.groupby("cut").agg(
        ha_frutales_total=("ha_total", "sum"),
        ha_frutales_riego=("ha_riego", "sum"),
        diversidad_especies=("especie", pd.Series.nunique),
    ).reset_index()

    # Especie dominante (mayor superficie total por comuna)
    if "especie" in df.columns:
        dom = (
            df.groupby(["cut", "especie"])["ha_total"]
            .sum()
            .reset_index()
            .sort_values("ha_total", ascending=False)
            .drop_duplicates("cut")[["cut", "especie"]]
            .rename(columns={"especie": "especie_dominante"})
        )
        agg = agg.merge(dom, on="cut", how="left")
    else:
        agg["especie_dominante"] = None

    log.info(
        f"  Comunas con datos frutícolas: {len(agg)} | "
        f"ha totales: {agg['ha_frutales_total'].sum():,.0f}"
    )
    return agg


def _detect_catastro_columns(df: pd.DataFrame) -> dict:
    """
    Detecta nombres de columnas del CSV de Catastro Frutícola.
    ODEPA ha cambiado los nombres entre 2022, 2024 y 2025.
    """
    cols_lower = {c.lower().strip(): c for c in df.columns}

    def find_col(*candidates) -> str | None:
        for c in candidates:
            if c in cols_lower:
                return cols_lower[c]
        return None

    col_map = {}

    c = find_col("comuna", "nombre_comuna", "nom_comuna", "nmcomuna")
    if c:
        col_map[c] = "comuna"

    c = find_col("especie", "nombre_especie", "nom_especie", "especie_nombre")
    if c:
        col_map[c] = "especie"

    for cand, std in [
        (("superficie_total", "sup_total", "ha_total", "hectareas_total",
          "superficiehectareas", "superficie"), "ha_total"),
        (("superficie_riego", "sup_riego", "ha_riego", "hectareas_riego",
          "riego"), "ha_riego"),
        (("superficie_secano", "sup_secano", "ha_secano", "secano"), "ha_secano"),
    ]:
        c = find_col(*cand)
        if c:
            col_map[c] = std

    # Validar que tenemos lo mínimo
    needed = {"comuna", "especie", "ha_total"}
    mapped = set(col_map.values())
    missing = needed - mapped
    if missing:
        log.warning(
            f"  Columnas no encontradas: {missing}. "
            f"Columnas disponibles: {list(df.columns)}"
        )
    return col_map


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3: Censo Agropecuario 2021 (INE)
# ─────────────────────────────────────────────────────────────────────────────
#
# DESCARGA MANUAL REQUERIDA
# ─────────────────────────────────────────────────────────────────────────────
# 1. Ir a https://www.ine.gob.cl/censoagropecuario → "Resultados del Censo"
# 2. Descargar las siguientes tablas y guardarlas en etl/data/:
#
#   ARCHIVO ESPERADO              TABLA INE
#   censo2021_maquinaria.xlsx  →  Maquinaria y equipos agrícolas por comuna
#   censo2021_explotaciones.xlsx  Explotaciones por tramos de superficie y comuna
#   censo2021_cultivos.xlsx    →  Superficie sembrada/plantada por cultivo y comuna
#
# Los archivos pueden tener nombres distintos (ej: "Cuadro_10_Maquinaria...xlsx").
# Renombrarlos o ajustar las rutas en CENSO_FILES abajo.
# ─────────────────────────────────────────────────────────────────────────────

CENSO_FILES = {
    "maquinaria":    DATA_DIR / "censo2021_maquinaria.xlsx",
    "explotaciones": DATA_DIR / "censo2021_explotaciones.xlsx",
    "cultivos":      DATA_DIR / "censo2021_cultivos.xlsx",
}


def _read_censo_excel(path: Path, label: str) -> pd.DataFrame | None:
    """Lee un Excel del Censo 2021, intentando múltiples sheets."""
    if not path.exists():
        log.warning(f"  {label}: archivo no encontrado → {path.name}. Saltando.")
        return None
    try:
        xl = pd.ExcelFile(path)
        # Buscar sheet con datos (no portada)
        target_sheet = None
        for s in xl.sheet_names:
            if any(k in s.lower() for k in ["datos", "comunal", "resultado", "tabla"]):
                target_sheet = s
                break
        target_sheet = target_sheet or xl.sheet_names[-1]
        df = pd.read_excel(path, sheet_name=target_sheet, header=None)
        # Detectar fila de encabezado (primera fila que empiece con código o nombre)
        df = _fix_censo_header(df)
        log.info(f"  {label}: {len(df)} filas | {list(df.columns[:6])}")
        return df
    except Exception as e:
        log.error(f"  {label}: error al leer — {e}")
        return None


def _fix_censo_header(df: pd.DataFrame) -> pd.DataFrame:
    """
    Los Excel del INE suelen tener filas de título antes del encabezado real.
    Detecta la fila que contiene 'código' o 'cut' o 'región' y la usa como header.
    """
    for i, row in df.iterrows():
        row_vals = [str(v).lower() for v in row.values if not pd.isna(v)]
        if any(k in " ".join(row_vals) for k in ["código", "codigo", "cut", "región", "region"]):
            new_df = df.iloc[i + 1:].copy()
            new_df.columns = df.iloc[i].values
            new_df.columns = [
                str(c).strip().lower().replace(" ", "_").replace("ó", "o")
                .replace("é", "e").replace("á", "a").replace("í", "i")
                .replace("ú", "u").replace("ñ", "n")
                for c in new_df.columns
            ]
            return new_df.reset_index(drop=True)
    # Si no se encontró header, usar la primera fila
    df.columns = [str(c).strip().lower() for c in df.iloc[0]]
    return df.iloc[1:].reset_index(drop=True)


def _extract_cut_column(df: pd.DataFrame) -> pd.Series | None:
    """Busca la columna de CUT code en un DataFrame del Censo."""
    for col in df.columns:
        sample = df[col].dropna().astype(str).str.strip()
        # CUT codes: 5 dígitos, empieza con 01-16
        if sample.str.match(r"^(0[1-9]|1[0-6])\d{3}$").mean() > 0.5:
            return df[col].astype(str).str.zfill(5)
    return None


def load_censo_maquinaria(name_to_cut: dict) -> pd.DataFrame:
    """
    Extrae por comuna: total_tractores, ha_agricola_total
    Variables derivadas: tractores_x100ha
    """
    log.info("PASO 3a — Censo 2021: Maquinaria …")
    df = _read_censo_excel(CENSO_FILES["maquinaria"], "Maquinaria")
    if df is None:
        log.warning("  Usando datos de maquinaria = 0 (archivo no disponible)")
        return pd.DataFrame(columns=["cut", "total_tractores"])

    cut_col = _extract_cut_column(df)
    if cut_col is None:
        # Fallback: buscar por nombre de comuna
        nombre_col = _find_column(df, ["nombre_comuna", "comuna", "nom_comuna"])
        if nombre_col:
            df["cut"] = df[nombre_col].apply(clean_name).map(name_to_cut)
        else:
            log.error("  No se encontró columna de identificación en maquinaria.xlsx")
            return pd.DataFrame(columns=["cut", "total_tractores"])
    else:
        df["cut"] = cut_col

    # Buscar columna de tractores
    tractor_col = _find_column(df, [
        "tractores_de_ruedas", "tractor_ruedas", "tractores_ruedas",
        "tractores", "n_tractores", "numero_tractores",
        "tractor", "ruedas"
    ])
    if tractor_col:
        df["tractores_ruedas"] = pd.to_numeric(df[tractor_col], errors="coerce").fillna(0)
    else:
        df["tractores_ruedas"] = 0
        log.warning("  Columna de tractores de ruedas no encontrada")

    oruga_col = _find_column(df, [
        "tractores_de_oruga", "tractor_oruga", "tractores_oruga", "oruga"
    ])
    if oruga_col:
        df["tractores_oruga"] = pd.to_numeric(df[oruga_col], errors="coerce").fillna(0)
    else:
        df["tractores_oruga"] = 0

    # Buscar hectáreas agrícolas totales (para calcular tractores/100ha)
    ha_col = _find_column(df, [
        "superficie_total", "ha_total", "superficie_agricola",
        "total_hectareas", "hectareas"
    ])
    if ha_col:
        df["ha_agricola"] = pd.to_numeric(df[ha_col], errors="coerce").fillna(0)
    else:
        df["ha_agricola"] = 0
        log.warning("  Columna de superficie agrícola no encontrada en maquinaria")

    agg = (
        df.dropna(subset=["cut"])
        .groupby("cut")
        .agg(
            total_tractores=("tractores_ruedas", "sum"),
            total_tractores_oruga=("tractores_oruga", "sum"),
            ha_agricola_total=("ha_agricola", "sum"),
        )
        .reset_index()
    )
    agg["total_tractores"] += agg["total_tractores_oruga"]
    agg = agg.drop(columns=["total_tractores_oruga"])

    log.info(f"  Comunas con maquinaria: {len(agg)} | tractores: {agg['total_tractores'].sum():,.0f}")
    return agg


def load_censo_explotaciones(name_to_cut: dict) -> pd.DataFrame:
    """
    Extrae por comuna:
      pct_predios_grandes (% explot >= 20ha)
      num_explot_medianas (n° explot 5-50ha)
      total_explotaciones
    """
    log.info("PASO 3b — Censo 2021: Explotaciones por tramo …")
    df = _read_censo_excel(CENSO_FILES["explotaciones"], "Explotaciones")
    if df is None:
        return pd.DataFrame(columns=[
            "cut", "total_explotaciones", "pct_predios_grandes", "num_explot_medianas"
        ])

    cut_col = _extract_cut_column(df)
    if cut_col is not None:
        df["cut"] = cut_col
    else:
        nombre_col = _find_column(df, ["nombre_comuna", "comuna"])
        if nombre_col:
            df["cut"] = df[nombre_col].apply(clean_name).map(name_to_cut)
        else:
            log.error("  No se encontró columna de identificación en explotaciones.xlsx")
            return pd.DataFrame(columns=[
                "cut", "total_explotaciones", "pct_predios_grandes", "num_explot_medianas"
            ])

    # Mapeo flexible de tramos de superficie
    TRAMOS = {
        # Clave estándar: posibles nombres en el Excel
        "tramo_menos_1ha": [
            "menos_de_1", "0-1", "0_a_1", "menores_1",
            "inferior_a_1", "menos_1", "<1"
        ],
        "tramo_1_5ha": ["1_a_5", "1-5", "de_1_a_5", "1_menos_5"],
        "tramo_5_10ha": ["5_a_10", "5-10", "de_5_a_10"],
        "tramo_10_20ha": ["10_a_20", "10-20", "de_10_a_20"],
        "tramo_20_50ha": ["20_a_50", "20-50", "de_20_a_50"],
        "tramo_50_100ha": ["50_a_100", "50-100", "de_50_a_100"],
        "tramo_100_200ha": ["100_a_200", "100-200", "de_100_a_200"],
        "tramo_mas_200ha": ["200_y_mas", "200+", "mas_de_200", ">200", "mayores_200"],
        "total": ["total", "total_explotaciones", "total_explot"],
    }
    for std_name, candidates in TRAMOS.items():
        c = _find_column(df, candidates)
        if c:
            df[std_name] = pd.to_numeric(df[c], errors="coerce").fillna(0)
        else:
            df[std_name] = 0

    agg = (
        df.dropna(subset=["cut"])
        .groupby("cut")
        .agg({k: "sum" for k in TRAMOS.keys()})
        .reset_index()
    )

    # Total explotaciones: usar columna total si existe, sino sumar tramos
    agg["total_explotaciones"] = np.where(
        agg["total"] > 0,
        agg["total"],
        agg[[c for c in TRAMOS.keys() if c != "total"]].sum(axis=1),
    )

    # Predios grandes: >= 20 ha
    agg["explot_grandes"] = (
        agg["tramo_20_50ha"] +
        agg["tramo_50_100ha"] +
        agg["tramo_100_200ha"] +
        agg["tramo_mas_200ha"]
    )
    agg["pct_predios_grandes"] = np.where(
        agg["total_explotaciones"] > 0,
        agg["explot_grandes"] / agg["total_explotaciones"] * 100,
        0,
    )

    # Explotaciones medianas: 5-50 ha (cliente INDAP)
    agg["num_explot_medianas"] = agg["tramo_5_10ha"] + agg["tramo_10_20ha"] + agg["tramo_20_50ha"]

    result = agg[["cut", "total_explotaciones", "pct_predios_grandes", "num_explot_medianas"]]
    log.info(
        f"  Comunas con explotaciones: {len(result)} | "
        f"total explot: {result['total_explotaciones'].sum():,.0f}"
    )
    return result


def load_censo_cultivos(name_to_cut: dict) -> pd.DataFrame:
    """
    Extrae por comuna: ha_cereales_oleaginosas (trigo + maíz + raps + cebada + avena...)
    """
    log.info("PASO 3c — Censo 2021: Cultivos anuales …")
    df = _read_censo_excel(CENSO_FILES["cultivos"], "Cultivos")
    if df is None:
        return pd.DataFrame(columns=["cut", "ha_cereales_oleaginosas"])

    cut_col = _extract_cut_column(df)
    if cut_col is not None:
        df["cut"] = cut_col
    else:
        nombre_col = _find_column(df, ["nombre_comuna", "comuna"])
        if nombre_col:
            df["cut"] = df[nombre_col].apply(clean_name).map(name_to_cut)
        else:
            log.error("  No se encontró columna de identificación en cultivos.xlsx")
            return pd.DataFrame(columns=["cut", "ha_cereales_oleaginosas"])

    # Sumar todas las columnas de cereales/oleaginosas presentes
    cereal_cols_found = []
    for col in df.columns:
        if any(c in col.lower() for c in CEREALES_COLS):
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            cereal_cols_found.append(col)

    if not cereal_cols_found:
        log.warning(
            "  No se encontraron columnas de cereales. "
            f"Columnas disponibles: {list(df.columns[:15])}"
        )
        df["ha_cereales_oleaginosas"] = 0
    else:
        log.info(f"  Columnas de cereales encontradas: {cereal_cols_found}")
        df["ha_cereales_oleaginosas"] = df[cereal_cols_found].sum(axis=1)

    agg = (
        df.dropna(subset=["cut"])
        .groupby("cut")["ha_cereales_oleaginosas"]
        .sum()
        .reset_index()
    )
    log.info(
        f"  Comunas con cultivos: {len(agg)} | "
        f"ha cereales: {agg['ha_cereales_oleaginosas'].sum():,.0f}"
    )
    return agg


def _find_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    """Busca la primera columna que coincida con alguno de los candidatos."""
    cols_lower = {c.lower().replace(" ", "_"): c for c in df.columns}
    for cand in candidates:
        if cand.lower() in cols_lower:
            return cols_lower[cand.lower()]
    # Búsqueda parcial (contains)
    for cand in candidates:
        for col_lower, col_orig in cols_lower.items():
            if cand.lower() in col_lower:
                return col_orig
    return None


# ─────────────────────────────────────────────────────────────────────────────
# PASO 4: Factor de ajuste ODEPA regional (cereales 2021 → 2024)
# ─────────────────────────────────────────────────────────────────────────────

def load_odepa_factor_ajuste() -> dict[str, float]:
    """
    Descarga el Excel regional de ODEPA y calcula el factor de crecimiento
    de cereales + oleaginosas entre la temporada del Censo 2021 y 2024.

    Retorna dict {region_id: factor} para aplicar a ha_cereales del Censo.
    Default: 1.0 (sin ajuste) si la descarga falla.
    """
    log.info("PASO 4 — ODEPA: factor de ajuste regional cereales …")
    dest = DATA_DIR / "odepa_cultivos_regional_2025.xls"
    try:
        download_file(URLS["odepa_regional_2025"], dest, "ODEPA Cultivos Regional 2025")
    except Exception:
        log.warning("  Usando factor de ajuste = 1.0 (descarga falló)")
        return {}

    try:
        xl = pd.ExcelFile(dest)
        # El Excel tiene múltiples sheets (una por cultivo o una general)
        # Buscar la sheet que tenga datos regionales
        target = None
        for s in xl.sheet_names:
            s_lower = s.lower()
            if any(k in s_lower for k in ["region", "regional", "total"]):
                target = s
                break
        target = target or xl.sheet_names[0]

        df = pd.read_excel(dest, sheet_name=target, header=None)
        df = _fix_censo_header(df)

        # Buscar columnas de año 2020/21 (Censo) y 2023/24 (más reciente)
        year_cols = {}
        for col in df.columns:
            col_str = str(col).replace("/", "_")
            if "2020" in col_str or "2021" in col_str:
                year_cols["base"] = col
            if "2023" in col_str or "2024" in col_str:
                year_cols["reciente"] = col

        if "base" not in year_cols or "reciente" not in year_cols:
            log.warning(
                f"  No se encontraron columnas de año en ODEPA. "
                f"Usando factor = 1.0. Columnas: {list(df.columns[:10])}"
            )
            return {}

        region_col = _find_column(df, ["region", "nombre_region", "region_nombre"])
        if not region_col:
            return {}

        # Mapa de nombre de región a region_id
        REGION_IDS = {
            "tarapaca": "01", "antofagasta": "02", "atacama": "03",
            "coquimbo": "04", "valparaiso": "05", "metropolitana": "13",
            "ohiggins": "06", "maule": "07", "biobio": "08", "nuble": "16",
            "araucania": "09", "los rios": "14", "los lagos": "10",
            "aysen": "11", "magallanes": "12",
        }

        factors = {}
        for _, row in df.iterrows():
            region_name = clean_name(str(row.get(region_col, "")))
            region_id = REGION_IDS.get(region_name)
            if not region_id:
                continue
            val_base = pd.to_numeric(row.get(year_cols["base"], 0), errors="coerce") or 0
            val_rec  = pd.to_numeric(row.get(year_cols["reciente"], 0), errors="coerce") or 0
            if val_base > 0:
                factors[region_id] = val_rec / val_base
            else:
                factors[region_id] = 1.0

        log.info(f"  Factores de ajuste por región: {factors}")
        return factors

    except Exception as e:
        log.warning(f"  Error procesando ODEPA: {e}. Usando factor = 1.0")
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# PASO 5: Merge de todas las fuentes
# ─────────────────────────────────────────────────────────────────────────────

def merge_all_sources(
    lookup:          pd.DataFrame,
    catastro:        pd.DataFrame,
    maquinaria:      pd.DataFrame,
    explotaciones:   pd.DataFrame,
    cultivos:        pd.DataFrame,
    odepa_factores:  dict,
) -> pd.DataFrame:
    """
    Une todas las fuentes sobre la tabla maestra de 346 comunas.
    Comunas sin datos en alguna fuente reciben 0 (no se descartan).
    """
    log.info("PASO 5 — Merging fuentes …")

    df = lookup.copy()

    for src, src_df in [
        ("catastro",      catastro),
        ("maquinaria",    maquinaria),
        ("explotaciones", explotaciones),
        ("cultivos",      cultivos),
    ]:
        df = df.merge(src_df, on="cut", how="left")
        log.info(f"  Merge {src}: {src_df.shape[0]} filas → {df.shape[0]} total")

    # ── Aplicar factor de ajuste ODEPA a ha_cereales ─────────────────────────
    if odepa_factores:
        df["factor_ajuste"] = df["region_id"].map(odepa_factores).fillna(1.0)
        df["ha_cereales_oleaginosas"] = (
            df["ha_cereales_oleaginosas"].fillna(0) * df["factor_ajuste"]
        )
    else:
        df["ha_cereales_oleaginosas"] = df["ha_cereales_oleaginosas"].fillna(0)
        df["factor_ajuste"] = 1.0

    # ── Rellenar NaN con 0 ────────────────────────────────────────────────────
    numeric_cols = [
        "ha_frutales_total", "ha_frutales_riego", "diversidad_especies",
        "total_tractores", "ha_agricola_total",
        "pct_predios_grandes", "num_explot_medianas", "total_explotaciones",
        "ha_cereales_oleaginosas",
    ]
    for col in numeric_cols:
        if col not in df.columns:
            df[col] = 0.0
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # ── Variable derivada: tractores por 100 ha agrícola ─────────────────────
    df["tractores_x100ha"] = np.where(
        df["ha_agricola_total"] > 0,
        df["total_tractores"] / df["ha_agricola_total"] * 100,
        df["total_tractores"] / 100.0  # fallback si no hay dato de superficie
    )

    # Suelos Agrológicos: placeholder 0.0 (se completa si hay datos)
    if "ha_suelo_clase_I_II" not in df.columns:
        df["ha_suelo_clase_I_II"] = 0.0

    log.info(f"  Merge final: {len(df)} comunas | {len(df.columns)} columnas")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 6: Calcular scores
# ─────────────────────────────────────────────────────────────────────────────

def compute_scores(df: pd.DataFrame) -> pd.DataFrame:
    """
    1. Normaliza cada variable (min-max con clip al percentil 98)
    2. Aplica pesos para Score A (grandes) y Score B (INDAP)
    3. Score combinado = 0.6 × A + 0.4 × B (ajustable con ventas reales)
    4. Multiplica por 100 → escala 0-100
    5. Asigna quintiles nacionales
    """
    log.info("PASO 6 — Calculando scores …")

    VARIABLES = list(PESOS_GRANDES.keys())

    # Normalización
    norm = pd.DataFrame({"cut": df["cut"]})
    for var in VARIABLES:
        if var in df.columns:
            norm[f"norm_{var}"] = normalize_score(df[var])
        else:
            norm[f"norm_{var}"] = 0.0
            log.warning(f"  Variable '{var}' no disponible → 0")

    # Score grandes
    df["score_grandes"] = sum(
        PESOS_GRANDES[var] * norm[f"norm_{var}"] for var in VARIABLES
    ) * 100

    # Score INDAP
    df["score_indap"] = sum(
        PESOS_INDAP[var] * norm[f"norm_{var}"] for var in VARIABLES
    ) * 100

    # Score combinado (pesos ajustables con ventas → tabla agroplanet_model_config)
    df["score_combined"] = 0.6 * df["score_grandes"] + 0.4 * df["score_indap"]

    # Quintiles
    for score_col, quintil_col in [
        ("score_grandes",  "quintil_grandes"),
        ("score_indap",    "quintil_indap"),
        ("score_combined", "quintil_combined"),
    ]:
        df[quintil_col] = assign_quintiles(df[score_col])

    log.info(
        f"  Score combined — media: {df['score_combined'].mean():.1f} | "
        f"max: {df['score_combined'].max():.1f} | "
        f"min: {df['score_combined'].min():.1f}"
    )
    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 7: Validar output
# ─────────────────────────────────────────────────────────────────────────────

def validate_output(df: pd.DataFrame, lookup: pd.DataFrame) -> None:
    log.info("PASO 7 — Validación …")

    # 346 comunas esperadas
    total = len(df)
    log.info(f"  Comunas en output: {total} (esperadas: 346)")
    if total != 346:
        log.warning(f"  ⚠️  Diferencia de {abs(total - 346)} comunas vs total esperado")

    # CUT codes faltantes
    missing_cuts = set(lookup["cut"]) - set(df["cut"])
    if missing_cuts:
        missing_names = lookup[lookup["cut"].isin(missing_cuts)]["nombre"].tolist()
        log.warning(f"  Comunas sin score: {missing_names[:10]}")

    # Variables con alto porcentaje de ceros (posible problema de datos)
    for var in PESOS_GRANDES.keys():
        if var in df.columns:
            pct_zero = (df[var] == 0).mean() * 100
            if pct_zero > 60:
                log.warning(
                    f"  '{var}': {pct_zero:.0f}% de comunas con valor 0 "
                    f"(revisar si Censo 2021 fue cargado)"
                )

    # Top 20 comunas
    top20 = (
        df.nlargest(20, "score_combined")[["nombre", "region", "score_combined", "quintil_combined"]]
        .to_string(index=False)
    )
    log.info(f"\n  TOP 20 COMUNAS:\n{top20}\n")

    # Distribución de quintiles
    dist = df["quintil_combined"].value_counts().sort_index()
    log.info(f"  Quintiles: {dist.to_dict()}")


# ─────────────────────────────────────────────────────────────────────────────
# PASO 8: Guardar output
# ─────────────────────────────────────────────────────────────────────────────

COLUMNAS_SALIDA = [
    "cut", "nombre", "region", "region_id",
    # Variables raw
    "tractores_x100ha", "ha_frutales_total", "ha_frutales_riego",
    "ha_cereales_oleaginosas", "pct_predios_grandes", "num_explot_medianas",
    "diversidad_especies", "ha_suelo_clase_I_II",
    # Auxiliares
    "total_tractores", "total_explotaciones", "ha_agricola_total", "especie_dominante",
    # Scores
    "score_grandes", "score_indap", "score_combined",
    # Quintiles
    "quintil_grandes", "quintil_indap", "quintil_combined",
]


def save_output(df: pd.DataFrame) -> Path:
    # Ordenar columnas de salida (ignorar las que no existan)
    cols = [c for c in COLUMNAS_SALIDA if c in df.columns]
    out = df[cols].sort_values("score_combined", ascending=False)

    out_path = OUTPUT_DIR / "agroplanet_comunas.csv"
    out.to_csv(out_path, index=False, encoding="utf-8")
    log.info(f"PASO 8 — Output guardado: {out_path} ({out_path.stat().st_size // 1024} KB)")
    return out_path


# ─────────────────────────────────────────────────────────────────────────────
# PASO 9: Subir a Supabase
# ─────────────────────────────────────────────────────────────────────────────

def upload_to_supabase(df: pd.DataFrame) -> None:
    """
    Carga la tabla en Supabase usando upsert por CUT code.
    Requiere SUPABASE_URL y SUPABASE_SERVICE_KEY como variables de entorno.
    La SUPABASE_KEY debe ser la service_role key (no la anon key).
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.info("PASO 9 — Supabase: credenciales no configuradas, saltando carga.")
        log.info(
            "  Para cargar, ejecutar:\n"
            "  VITE_SUPABASE_URL=https://xxx.supabase.co "
            "SUPABASE_SERVICE_KEY=eyJ... python agroplanet_etl.py"
        )
        return

    log.info("PASO 9 — Subiendo a Supabase …")
    try:
        from supabase import create_client
        client = create_client(SUPABASE_URL, SUPABASE_KEY)

        cols = [c for c in COLUMNAS_SALIDA if c in df.columns]
        records = (
            df[cols]
            .where(pd.notna(df[cols]), other=None)
            .assign(model_version=MODEL_VERSION)
            .to_dict(orient="records")
        )

        # Upsert en lotes de 100
        batch_size = 100
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            client.table("agroplanet_comunas").upsert(batch, on_conflict="cut").execute()
            log.info(f"  Lote {i // batch_size + 1}/{-(-len(records) // batch_size)} cargado")

        log.info(f"  ✓ {len(records)} comunas cargadas en Supabase")

    except ImportError:
        log.error("  supabase no instalado. Ejecutar: pip install supabase")
    except Exception as e:
        log.error(f"  Error Supabase: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    log.info("═" * 70)
    log.info("  AGROPLANET ETL — Score Comunal Nacional v1.0")
    log.info("═" * 70)

    # 1. Tabla maestra de CUT codes
    lookup = load_cut_lookup()
    name_to_cut = build_name_to_cut(lookup)

    # 2. Catastro Frutícola (descarga automática)
    catastro = load_catastro_fruticola(name_to_cut)

    # 3. Censo Agropecuario 2021 (requiere descarga manual → ver instrucciones)
    maquinaria    = load_censo_maquinaria(name_to_cut)
    explotaciones = load_censo_explotaciones(name_to_cut)
    cultivos      = load_censo_cultivos(name_to_cut)

    # 4. Factor de ajuste ODEPA (descarga automática, no crítico)
    odepa_factores = load_odepa_factor_ajuste()

    # 5. Merge
    df = merge_all_sources(
        lookup, catastro, maquinaria, explotaciones, cultivos, odepa_factores
    )

    # 6. Scores
    df = compute_scores(df)

    # 7. Validar
    validate_output(df, lookup)

    # 8. Guardar
    save_output(df)

    # 9. Supabase (solo si hay credenciales)
    upload_to_supabase(df)

    log.info("═" * 70)
    log.info("  ETL completado exitosamente")
    log.info("═" * 70)


if __name__ == "__main__":
    main()
