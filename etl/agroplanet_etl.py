#!/usr/bin/env python3
"""
AGROPLANET ETL — Score Comunal Nacional v2.0
═══════════════════════════════════════════════════════════════════════════════
Genera score IDPA 0–100 por comuna para retail de repuestos de maquinaria
agrícola en Chile.

FUENTES:
  1. superficie-categoría-cultivo-región-comuna.xlsx  ← INE Censo 2021
  2. seccion_9_frutales.csv  + otros seccion_9_*.csv  ← microdata CAF 2021
  3. seccion_13_maquinaria.csv                        ← CAF 2021 maquinaria
  4. catastro_fruticola_2025.csv                      ← ODEPA (descarga auto)
  5. Atlas_Rural_de_Chile.zip                         ← INDAP tipologías

VARIABLES IDPA v2.0:
  tractores_total         Ruedas + cadenas por commune (CAF 2021 §13, 30%)
  total_explotaciones     N° predios únicos (CAF 2021 §9, 25%)
  ha_frutales_riego       Fruticultura intensiva (Catastro ODEPA, 20%)
  ha_cereales_total       Cereales + industriales (INE xlsx, 15%)
  ha_vinas_riego          Viñas — sector muy mecanizado (INE xlsx, 7%)
  ha_forestal_total       Plantaciones forestales (CAF 2021 §9, 3%)

USO:
  pip install -r requirements.txt
  python agroplanet_etl.py
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
# RUTAS
# ─────────────────────────────────────────────────────────────────────────────

REPO_ROOT    = Path(__file__).resolve().parent.parent
DATA_DIR     = Path(__file__).parent / "data"
OUTPUT_DIR   = Path(__file__).parent / "output"
ONEDRIVE_AGR = Path(
    "/Users/mstrubee/Library/CloudStorage/OneDrive-GrupoPlanetSpA"
    "/Locales Grupo Planet/Varios/Geoloc/Agroplanet"
)

FUENTES = {
    "xlsx_superficie": ONEDRIVE_AGR / "superficie-categoría-cultivo-región-comuna.xlsx",
    "csv_frutales":    ONEDRIVE_AGR / "seccion_9_frutales.csv",
    "maquinaria":      ONEDRIVE_AGR / "seccion_13_maquinaria.csv",
    "forestal":        ONEDRIVE_AGR / "seccion_9_forestal.csv",
    "atlas_rural_zip": Path("/Users/mstrubee/Downloads/Atlas_Rural_de_Chile.zip"),
    "codigos_csv":     REPO_ROOT / "public" / "codigos_territoriales.csv",
    "comunas_geojson": REPO_ROOT / "public" / "comunas.geojson",
}

# Archivos seccion_9 para lookup commune (tractores + explotaciones)
SECCION9_SUFIJOS = [
    "cereales", "frutales", "vinas", "forrajeras",
    "praderas", "hortalizas", "industriales", "forestal",
]

URL_CATASTRO = (
    "https://datos.odepa.gob.cl/dataset/"
    "ea82304e-917f-4cdb-abf6-555782483dc1/resource/"
    "1bbc9838-6032-4b89-96e5-8c2ed5d91e3f/download/catastro_fruticola_2025.csv"
)

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
MODEL_VERSION = "v2.0"

DATA_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# PESOS DEL MODELO v2.0 — IDPA (Índice de Demanda Potencial Agrícola)
# ─────────────────────────────────────────────────────────────────────────────

PESOS_GRANDES = {
    "tractores_total":        0.30,  # Demanda directa de repuestos — variable clave
    "total_explotaciones":    0.25,  # Volumen de clientes (predios únicos)
    "ha_frutales_riego":      0.20,  # Alta inversión en maquinaria especializada
    "ha_cereales_total":      0.15,  # Maquinaria pesada: combinadas, tractores
    "ha_vinas_riego":         0.07,  # Sector muy mecanizado en Chile
    "ha_forestal_total":      0.03,  # Motosierras, skidders, forwarders
}

PESOS_INDAP = {
    "total_explotaciones":    0.30,  # INDAP: muchos predios pequeños → más clientes
    "tractores_total":        0.15,  # INDAP: menor dotación de tractores
    "ha_cereales_total":      0.25,  # Cultivo principal INDAP: trigo, avena, cebada
    "ha_forrajeras_total":    0.20,  # Sur INDAP: ganadería mecanizada
    "ha_frutales_riego":      0.07,  # Algunos frutales en pequeña escala
    "ha_forestal_total":      0.03,  # Pequeña forestación
}

# Columnas del xlsx INE Censo 2021 (índices 0-based confirmados empíricamente)
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


NAME_ALIASES: dict[str, str] = {
    "iquique/alto hospicio":        "iquique",
    "o higgins":                    "o'higgins",
    "ohiggins":                     "o'higgins",
    "padre las casas":              "padre las casas",
    "p. las casas":                 "padre las casas",
    "la calera":                    "calera",
    "cabo de hornos (ex navarino)": "cabo de hornos",
    "antartica":                    "antartica",
    "la antartica":                 "antartica",
}


def clean_name(name: str) -> str:
    n = normalize_name(name)
    return NAME_ALIASES.get(n, n)


def to_float(val) -> float:
    if pd.isna(val):
        return 0.0
    try:
        return float(str(val).replace(",", ".").replace(" ", ""))
    except (ValueError, TypeError):
        return 0.0


def parse_ha_series(series: pd.Series) -> pd.Series:
    """Convierte decimal coma chilena ('1,30') a float."""
    return pd.to_numeric(
        series.astype(str).str.replace(",", ".", regex=False),
        errors="coerce",
    ).fillna(0).clip(lower=0)


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
    """Busca en DATA_DIR primero, luego en la ruta original."""
    original = FUENTES[key]
    local    = DATA_DIR / original.name
    if local.exists():
        return local
    if original.exists():
        return original
    return None


# ─────────────────────────────────────────────────────────────────────────────
# PASO 1 — Tabla maestra de CUT codes (346 comunas)
# ─────────────────────────────────────────────────────────────────────────────

def load_cut_lookup() -> pd.DataFrame:
    log.info("PASO 1 — Cargando tabla CUT codes …")
    df = pd.read_csv(FUENTES["codigos_csv"], dtype=str)
    df.columns = ["region_id", "region", "province_id", "province", "cut", "nombre"]
    df["cut"]         = df["cut"].str.zfill(5)
    df["region_id"]   = df["region_id"].str.zfill(2)
    df["nombre_norm"] = df["nombre"].apply(clean_name)
    log.info(f"  {len(df)} comunas")
    return df[["cut", "nombre", "region", "region_id", "nombre_norm"]]


def build_name_to_cut(lookup: pd.DataFrame) -> dict[str, str]:
    return dict(zip(lookup["nombre_norm"], lookup["cut"]))


# ─────────────────────────────────────────────────────────────────────────────
# PASO 2 — xlsx: Superficie por categoría de cultivo y comuna (INE Censo 2021)
# ─────────────────────────────────────────────────────────────────────────────

def load_xlsx_superficie(name_to_cut: dict) -> pd.DataFrame:
    log.info("PASO 2 — xlsx superficie cultivos …")
    path = resolve_path("xlsx_superficie")
    if path is None:
        raise FileNotFoundError("superficie-categoría-cultivo-región-comuna.xlsx")

    raw = pd.read_excel(path, header=None)
    log.info(f"  Shape raw: {raw.shape}")

    EXCLUIR = {"Total Región", "Total Nacional", "Comuna 5,6", "nan", ""}
    mask = (
        raw.iloc[:, 2].notna()
        & (~raw.iloc[:, 2].astype(str).isin(EXCLUIR))
        & (~raw.iloc[:, 1].astype(str).str.startswith("21."))
    )
    comunas = raw[mask].copy().reset_index(drop=True)
    log.info(f"  Filas de comunas: {len(comunas)}")

    col_rename = {v: k for k, v in XLSX_COLS.items()}
    comunas = comunas.rename(columns=col_rename)

    COLS_NUM = {k for k in XLSX_COLS if k not in ("region", "comuna")}
    for col in COLS_NUM:
        if col in comunas.columns:
            comunas[col] = comunas[col].apply(to_float)

    comunas["ha_cereales_total"]   = (
        comunas["cereales_riego"] + comunas["cereales_secano"]
        + comunas["industriales_riego"] + comunas["industriales_secano"]
    )
    comunas["ha_frutales_total"]   = comunas["frutales_riego"] + comunas["frutales_secano"]
    comunas["ha_frutales_riego"]   = comunas["frutales_riego"]
    comunas["ha_vinas_riego"]      = comunas["vinas_riego"]
    comunas["ha_vinas_total"]      = comunas["vinas_riego"] + comunas["vinas_secano"]
    comunas["ha_forrajeras_total"] = (
        comunas["forrajeras_riego"] + comunas["forrajeras_secano"]
        + comunas["praderas_riego"] + comunas["praderas_secano"]
    )
    comunas["indice_mecanizable"]  = (
        comunas["ha_cereales_total"]
        + comunas["ha_frutales_total"]
        + comunas["ha_vinas_total"]
    )

    comunas["nombre_norm"] = comunas["comuna"].astype(str).apply(clean_name)
    comunas["cut"] = comunas["nombre_norm"].map(name_to_cut)

    sin_cut = comunas[comunas["cut"].isna()]["comuna"].unique()
    if len(sin_cut) > 0:
        log.warning(f"  Comunas sin CUT match ({len(sin_cut)}): {list(sin_cut[:8])}")

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
        f"  Comunas con datos: {len(result)} | "
        f"ha frutales riego: {result['ha_frutales_riego'].sum():,.0f} | "
        f"ha cereales: {result['ha_cereales_total'].sum():,.0f}"
    )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# PASO 2B — CAF 2021 §13 + §9: tractores y explotaciones por comuna
# ─────────────────────────────────────────────────────────────────────────────

def load_caf_by_commune() -> pd.DataFrame:
    """
    Estrategia de 3 pasos:
      1. Construir lookup (GUID, Establecimiento) → CUT_COMUNA desde todos los
         archivos seccion_9_*.csv (84.8% de los 140k establecimientos queda
         asignado a una comuna).
      2. Unir con seccion_13_maquinaria.csv (AC233_1=tractores ruedas,
         AC233_2=tractores cadenas) — valores -77 = "no aplica" → 0.
      3. Agregar por CUT_COMUNA:
           total_explotaciones: establecimientos únicos
           tractores_total:     suma de tractores de ruedas + cadenas
    """
    log.info("PASO 2B — CAF 2021: tractores y explotaciones por comuna …")

    # ── Construir commune lookup ──────────────────────────────────────────────
    frames = []
    for suf in SECCION9_SUFIJOS:
        path = ONEDRIVE_AGR / f"seccion_9_{suf}.csv"
        if not path.exists():
            path = DATA_DIR / f"seccion_9_{suf}.csv"
        if not path.exists():
            continue
        try:
            tmp = pd.read_csv(
                path, sep=";", low_memory=False,
                usecols=["GUID", "Establecimiento", "CUT_COMUNA"],
            )
            tmp = tmp.drop_duplicates(["GUID", "Establecimiento"])
            frames.append(tmp)
            log.info(f"  seccion_9_{suf}: {len(tmp):,} establecimientos únicos")
        except Exception as e:
            log.warning(f"  {path.name}: {e}")

    if not frames:
        log.warning("  Ningún archivo seccion_9 disponible → explotaciones=0, tractores=0")
        return pd.DataFrame(columns=["cut", "total_explotaciones", "tractores_total"])

    lookup_s9 = (
        pd.concat(frames, ignore_index=True)
        .drop_duplicates(["GUID", "Establecimiento"])
        .copy()
    )
    lookup_s9["cut"] = lookup_s9["CUT_COMUNA"].astype(str).str.zfill(5)
    log.info(f"  Lookup total: {len(lookup_s9):,} establecimientos únicos con CUT_COMUNA")

    # ── Explotaciones por comuna ──────────────────────────────────────────────
    explot = (
        lookup_s9.groupby("cut")
        .size()
        .reset_index(name="total_explotaciones")
        .astype({"total_explotaciones": float})
    )
    log.info(
        f"  total_explotaciones: {int(explot['total_explotaciones'].sum()):,} "
        f"en {len(explot)} comunas | "
        f"top: {explot.nlargest(3, 'total_explotaciones')[['cut','total_explotaciones']].to_dict('records')}"
    )

    # ── Tractores por comuna ──────────────────────────────────────────────────
    maq_path = resolve_path("maquinaria")
    if maq_path is None:
        log.warning("  seccion_13_maquinaria.csv no encontrado → tractores_total=0")
        explot["tractores_total"] = 0.0
        return explot[["cut", "total_explotaciones", "tractores_total"]]

    try:
        maq = pd.read_csv(
            maq_path, sep=";", low_memory=False,
            usecols=["GUID", "Establecimiento", "AC233_1", "AC233_2"],
        )
        # -77 = "no aplica" en encuestas INE → tratar como 0
        maq["AC233_1"] = maq["AC233_1"].clip(lower=0).fillna(0)
        maq["AC233_2"] = maq["AC233_2"].clip(lower=0).fillna(0)
        maq["tractores_estab"] = maq["AC233_1"] + maq["AC233_2"]

        # Join con commune lookup
        maq_geo = maq.merge(
            lookup_s9[["GUID", "Establecimiento", "cut"]],
            on=["GUID", "Establecimiento"],
            how="inner",
        )
        cobertura = 100 * len(maq_geo) / len(maq)

        tractores = (
            maq_geo.groupby("cut")["tractores_estab"]
            .sum()
            .reset_index(name="tractores_total")
        )
        log.info(
            f"  tractores_total: {int(maq_geo['tractores_estab'].sum()):,} tractores "
            f"({cobertura:.1f}% de establecimientos asignados a una comuna)"
        )
        result = explot.merge(tractores, on="cut", how="left")
        result["tractores_total"] = result["tractores_total"].fillna(0)

    except Exception as e:
        log.warning(f"  Error procesando maquinaria: {e} → tractores_total=0")
        explot["tractores_total"] = 0.0
        result = explot

    return result[["cut", "total_explotaciones", "tractores_total"]]


# ─────────────────────────────────────────────────────────────────────────────
# PASO 2C — CAF 2021 §9: superficie forestal por comuna
# ─────────────────────────────────────────────────────────────────────────────

def load_forestal() -> pd.DataFrame:
    """
    Agrega SS145 (ha de plantaciones forestales por predio) por CUT_COMUNA.
    Usa decimal coma (1.234,56 → parse_ha_series).
    """
    log.info("PASO 2C — CAF 2021: superficie forestal por comuna …")
    path = resolve_path("forestal")
    if path is None:
        log.warning("  seccion_9_forestal.csv no encontrado → ha_forestal_total=0")
        return pd.DataFrame(columns=["cut", "ha_forestal_total"])

    try:
        df = pd.read_csv(
            path, sep=";", low_memory=False,
            usecols=["CUT_COMUNA", "SS145"],
        )
        df["cut"]           = df["CUT_COMUNA"].astype(str).str.zfill(5)
        df["ha_forestal"]   = parse_ha_series(df["SS145"])

        result = (
            df.groupby("cut")["ha_forestal"]
            .sum()
            .reset_index(name="ha_forestal_total")
        )
        log.info(
            f"  ha_forestal_total: {result['ha_forestal_total'].sum():,.0f} ha "
            f"en {len(result)} comunas"
        )
        return result

    except Exception as e:
        log.warning(f"  Error procesando forestal: {e} → ha_forestal_total=0")
        return pd.DataFrame(columns=["cut", "ha_forestal_total"])


# ─────────────────────────────────────────────────────────────────────────────
# PASO 3 — CSV frutales: Diversidad de especies por comuna
# ─────────────────────────────────────────────────────────────────────────────

def load_diversidad_especies() -> pd.DataFrame:
    log.info("PASO 3 — CSV frutales: diversidad de especies …")
    path = resolve_path("csv_frutales")
    if path is None:
        log.warning("  CSV frutales no encontrado → diversidad_especies=0")
        return pd.DataFrame(columns=["cut", "diversidad_especies"])

    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            df = pd.read_csv(path, sep=";", decimal=",", encoding=enc, low_memory=False)
            break
        except UnicodeDecodeError:
            continue
    else:
        return pd.DataFrame(columns=["cut", "diversidad_especies"])

    df.columns = [c.strip().strip('"').lstrip("﻿") for c in df.columns]

    if "CUT_COMUNA" not in df.columns:
        log.error(f"  CUT_COMUNA no encontrada. Columnas: {list(df.columns[:8])}")
        return pd.DataFrame(columns=["cut", "diversidad_especies"])

    df["cut"] = df["CUT_COMUNA"].astype(str).str.strip().str.zfill(5)

    especie_col = next(
        (c for c in ["SS92_Glo", "SS92_GLO", "ESPECIE"] if c in df.columns), None
    )
    if not especie_col:
        return pd.DataFrame(columns=["cut", "diversidad_especies"])

    div = (
        df[df[especie_col].notna()]
        .groupby("cut")[especie_col]
        .nunique()
        .reset_index(name="diversidad_especies")
    )
    log.info(
        f"  Comunas con frutales: {len(div)} | "
        f"máx especies: {div['diversidad_especies'].max()}"
    )
    return div


# ─────────────────────────────────────────────────────────────────────────────
# PASO 4 — Catastro Frutícola 2025 (ODEPA)
# ─────────────────────────────────────────────────────────────────────────────

def load_catastro_fruticola_2025(name_to_cut: dict) -> pd.DataFrame:
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

    cols = {c.lower().strip(): c for c in df.columns}

    def find(*cands):
        for c in cands:
            if c in cols:
                return cols[c]
        for c in cands:
            for k, v in cols.items():
                if c in k:
                    return v
        return None

    col_comuna  = find("comuna", "nombre_comuna", "nmcomuna")
    col_especie = find("especie", "nom_especie", "especie_nombre")
    col_total   = find("superficie (ha)", "superficie_total", "ha_total",
                       "superficie", "superficiehectareas")
    col_riego   = None   # Catastro 2025 no tiene ha_riego como columna numérica

    if not col_comuna:
        log.warning("  Columna COMUNA no encontrada en catastro 2025")
        return pd.DataFrame(columns=["cut", "ha_frutales_riego_2025", "diversidad_esp_2025"])

    df["nombre_norm"] = df[col_comuna].apply(clean_name)
    df["cut"] = df["nombre_norm"].map(name_to_cut)

    if col_riego:
        df["_riego"] = parse_ha_series(df[col_riego])
    elif col_total:
        df["_riego"] = parse_ha_series(df[col_total])
    else:
        df["_riego"] = 0

    agg = df.dropna(subset=["cut"]).groupby("cut").agg(
        ha_frutales_riego_2025=("_riego", "sum"),
        diversidad_esp_2025=(col_especie, pd.Series.nunique)
        if col_especie else ("_riego", "count"),
    ).reset_index()

    log.info(
        f"  Catastro 2025: {len(agg)} comunas | "
        f"ha riego total: {agg['ha_frutales_riego_2025'].sum():,.0f}"
    )
    return agg


# ─────────────────────────────────────────────────────────────────────────────
# PASO 5 — Atlas Rural: tipología territorial por comuna
# ─────────────────────────────────────────────────────────────────────────────

def load_tipologia_rural() -> pd.DataFrame:
    log.info("PASO 5 — Atlas Rural: tipología territorial …")

    atlas_zip = FUENTES["atlas_rural_zip"]
    if not atlas_zip.exists():
        log.warning(f"  ZIP no encontrado: {atlas_zip}. Saltando tipología.")
        return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

    try:
        import geopandas as gpd
    except ImportError:
        log.warning("  pip install geopandas  (saltando tipología)")
        return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(atlas_zip, "r") as zf:
            zf.extractall(tmp)
        shp_files = list(Path(tmp).glob("*.shp"))
        if not shp_files:
            return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

        atlas = gpd.read_file(shp_files[0], encoding="utf-8")
        if atlas.crs is None or atlas.crs.to_epsg() != 4326:
            atlas = atlas.to_crs(epsg=4326)

        comunas_geo_path = FUENTES["comunas_geojson"]
        if not comunas_geo_path.exists():
            return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

        comunas_geo = gpd.read_file(comunas_geo_path)
        if comunas_geo.crs is None or comunas_geo.crs.to_epsg() != 4326:
            comunas_geo = comunas_geo.to_crs(epsg=4326)

        cut_col = next(
            (c for c in ["codigo_comuna", "cod_comuna", "CUT", "cut"] if c in comunas_geo.columns),
            None,
        )
        if not cut_col:
            return pd.DataFrame(columns=["cut", "macrozona", "tipologia", "codigo_tipologia"])

        comunas_geo["cut"] = comunas_geo[cut_col].astype(str).str.zfill(5)
        centroides = comunas_geo[["cut", "geometry"]].copy()
        centroides["geometry"] = centroides.geometry.centroid

        joined = gpd.sjoin(
            centroides,
            atlas[["MACROZONA", "TIPOLOGIA", "CODIGO", "geometry"]],
            how="left",
            predicate="within",
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
        log.info(f"  Tipología asignada a {result['macrozona'].notna().sum()}/{len(result)} comunas")
        return result


# ─────────────────────────────────────────────────────────────────────────────
# PASO 6 — Merge de todas las fuentes
# ─────────────────────────────────────────────────────────────────────────────

def merge_all(
    lookup:       pd.DataFrame,
    superficie:   pd.DataFrame,
    caf_maq:      pd.DataFrame,
    forestal:     pd.DataFrame,
    diversidad:   pd.DataFrame,
    catastro_25:  pd.DataFrame,
    tipologia:    pd.DataFrame,
) -> pd.DataFrame:
    log.info("PASO 6 — Merging fuentes …")

    df = lookup.copy()

    for label, src in [
        ("xlsx superficie",        superficie),
        ("CAF maquinaria/explt",   caf_maq),
        ("CAF forestal",           forestal),
        ("diversidad especies",    diversidad),
        ("catastro 2025",          catastro_25),
        ("tipología rural",        tipologia),
    ]:
        before = len(df)
        df = df.merge(src, on="cut", how="left")
        log.info(f"  Merge {label}: {len(src)} filas → {before} → {len(df)}")

    # ── ha_frutales_riego: Catastro 2025 tiene prioridad sobre xlsx ──────────
    if "ha_frutales_riego_2025" in df.columns:
        df["ha_frutales_riego"] = np.where(
            df["ha_frutales_riego_2025"].notna() & (df["ha_frutales_riego_2025"] > 0),
            df["ha_frutales_riego_2025"],
            df.get("ha_frutales_riego", 0),
        )
        if "diversidad_esp_2025" in df.columns:
            df["diversidad_especies"] = df[["diversidad_especies", "diversidad_esp_2025"]].max(axis=1)

    # ── Rellenar NaN ─────────────────────────────────────────────────────────
    VARS_TODAS = [
        "ha_frutales_riego", "ha_frutales_total",
        "ha_cereales_total", "ha_vinas_riego", "ha_vinas_total",
        "ha_forrajeras_total", "ha_forestal_total",
        "diversidad_especies", "indice_mecanizable",
        "total_explotaciones", "tractores_total",
    ]
    for col in VARS_TODAS:
        if col not in df.columns:
            df[col] = 0.0
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

    log.info(
        f"  Merge final: {len(df)} comunas | "
        f"tractores total nacional: {df['tractores_total'].sum():,.0f} | "
        f"explotaciones total: {int(df['total_explotaciones'].sum()):,}"
    )
    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 7 — Calcular scores IDPA y quintiles
# ─────────────────────────────────────────────────────────────────────────────

def compute_scores(df: pd.DataFrame) -> pd.DataFrame:
    log.info("PASO 7 — Calculando scores IDPA v2.0 …")

    VARIABLES = list(PESOS_GRANDES.keys())  # orden canónico

    # Normalizar cada variable (min-max con clip p97)
    norm = {
        var: normalize_score(df[var]) if var in df.columns
        else pd.Series(0.0, index=df.index)
        for var in VARIABLES
    }

    df["score_grandes"]  = sum(PESOS_GRANDES[v] * norm[v] for v in VARIABLES) * 100
    df["score_indap"]    = sum(PESOS_INDAP.get(v, 0) * norm[v] for v in VARIABLES) * 100
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
        f"max: {df['score_combined'].max():.1f} ({df.loc[df['score_combined'].idxmax(), 'nombre']}) | "
        f"min: {df['score_combined'].min():.1f}"
    )

    # Contribución de cada variable al score nacional
    for var in VARIABLES:
        pct_zero = (df[var] == 0).mean() * 100
        if pct_zero > 60:
            log.warning(f"  '{var}': {pct_zero:.0f}% comunas en 0 — revisar cobertura")

    return df


# ─────────────────────────────────────────────────────────────────────────────
# PASO 8 — Validar resultados
# ─────────────────────────────────────────────────────────────────────────────

def validate(df: pd.DataFrame, lookup: pd.DataFrame) -> None:
    log.info("PASO 8 — Validación …")
    log.info(f"  Comunas en output: {len(df)} (esperadas: 346)")
    if len(df) != 346:
        in_output  = set(df["cut"])
        in_lookup  = set(lookup["cut"])
        missing    = in_lookup - in_output
        log.warning(f"  CUTs faltantes ({len(missing)}): {sorted(missing)[:10]}")

    top = df.nlargest(20, "score_combined")[
        ["nombre", "region", "score_combined", "tractores_total",
         "total_explotaciones", "quintil_combined"]
    ]
    log.info(f"\n  TOP 20 COMUNAS (IDPA v2.0):\n{top.to_string(index=False)}\n")

    reg = df.groupby("region")["score_combined"].mean().sort_values(ascending=False)
    log.info(f"\n  Score promedio por región:\n{reg.to_string()}\n")

    log.info(f"  Quintiles combined: {df['quintil_combined'].value_counts().sort_index().to_dict()}")

    # Resumen de tractores
    log.info(
        f"  Tractores: {df['tractores_total'].sum():,.0f} total | "
        f"{(df['tractores_total'] > 0).sum()} comunas con datos"
    )
    log.info(
        f"  Explotaciones: {int(df['total_explotaciones'].sum()):,} total | "
        f"{(df['total_explotaciones'] > 0).sum()} comunas con datos"
    )


# ─────────────────────────────────────────────────────────────────────────────
# PASO 9 — Guardar CSV
# ─────────────────────────────────────────────────────────────────────────────

COLUMNAS_SALIDA = [
    "cut", "nombre", "region", "region_id",
    # Variables base
    "ha_frutales_riego", "ha_frutales_total",
    "ha_cereales_total", "ha_vinas_riego", "ha_vinas_total",
    "ha_forrajeras_total", "ha_forestal_total",
    "diversidad_especies", "indice_mecanizable",
    # Nuevas variables v2.0
    "total_explotaciones", "tractores_total",
    # Scores IDPA
    "score_grandes", "score_indap", "score_combined",
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
# PASO 9B — Generar SQL para Lovable (INSERT + migración)
# ─────────────────────────────────────────────────────────────────────────────

def generate_sql(df: pd.DataFrame) -> None:
    """
    Genera:
      output/migrate_v2.sql     → ALTER TABLE para nuevas columnas
      output/insert_v2_p1.sql … output/insert_v2_p4.sql  → INSERT batches
    """
    log.info("PASO 9B — Generando SQL para Lovable …")

    # ── Migración de schema ────────────────────────────────────────────────────
    migrate_sql = """\
-- AGROPLANET v2.0 — Migración schema (pegar en Lovable SQL editor)
-- Agrega columnas nuevas al esquema v1.1 existente

ALTER TABLE agroplanet_comunas
  ADD COLUMN IF NOT EXISTS total_explotaciones  float,
  ADD COLUMN IF NOT EXISTS tractores_total      float,
  ADD COLUMN IF NOT EXISTS ha_forestal_total    float;

-- Actualizar versión en model_config (si la tabla existe)
UPDATE agroplanet_model_config
SET    model_version = 'v2.0',
       notas         = 'IDPA v2.0: tractores (30%) + explotaciones (25%) + frutales (20%) + cereales (15%) + viñas (7%) + forestal (3%)'
WHERE  active = true;
"""
    migrate_path = OUTPUT_DIR / "migrate_v2.sql"
    migrate_path.write_text(migrate_sql, encoding="utf-8")
    log.info(f"  Migración SQL: {migrate_path.name}")

    # ── INSERT batches ─────────────────────────────────────────────────────────
    INSERT_COLS = [
        "cut", "nombre", "region", "region_id",
        "ha_frutales_total", "ha_frutales_riego",
        "ha_cereales_total", "ha_vinas_riego", "ha_vinas_total",
        "ha_forrajeras_total", "ha_forestal_total",
        "indice_mecanizable", "diversidad_especies",
        "total_explotaciones", "tractores_total",
        "macrozona", "tipologia", "codigo_tipologia",
        "score_grandes", "score_indap", "score_combined",
        "quintil_grandes", "quintil_indap", "quintil_combined",
    ]
    cols = [c for c in INSERT_COLS if c in df.columns]

    def val(v):
        if pd.isna(v):
            return "NULL"
        if isinstance(v, (int, float, np.integer, np.floating)):
            return f"{float(v):.6f}" if isinstance(v, (float, np.floating)) else str(int(v))
        return "'" + str(v).replace("'", "''") + "'"

    rows = []
    for _, row in df[cols].iterrows():
        rows.append("  (" + ", ".join(val(row[c]) for c in cols) + ")")

    col_list   = ", ".join(cols)
    update_set = ", ".join(
        f"{c}=EXCLUDED.{c}" for c in cols if c != "cut"
    )

    batch_size = 87   # ~4 partes de 346 communes
    n_parts    = (len(rows) + batch_size - 1) // batch_size

    for i in range(n_parts):
        batch   = rows[i * batch_size: (i + 1) * batch_size]
        content = (
            f"-- AGROPLANET v2.0 — INSERT parte {i+1}/{n_parts} "
            f"({len(batch)} filas)\n"
            f"-- Pegar en Lovable SQL editor\n\n"
            f"INSERT INTO agroplanet_comunas\n  ({col_list})\nVALUES\n"
            + ",\n".join(batch)
            + "\nON CONFLICT (cut) DO UPDATE SET\n  "
            + update_set
            + ";\n"
        )
        path = OUTPUT_DIR / f"insert_v2_p{i+1}.sql"
        path.write_text(content, encoding="utf-8")

    log.info(
        f"  INSERT SQL: {n_parts} partes × ~{batch_size} filas "
        f"→ insert_v2_p1.sql … insert_v2_p{n_parts}.sql"
    )


# ─────────────────────────────────────────────────────────────────────────────
# PASO 10 — Subir a Supabase (opcional)
# ─────────────────────────────────────────────────────────────────────────────

def upload_supabase(df: pd.DataFrame) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.info(
            "PASO 10 — Supabase: sin credenciales. Para cargar directo:\n"
            "  VITE_SUPABASE_URL=https://xxx.supabase.co "
            "SUPABASE_SERVICE_KEY=eyJ... python agroplanet_etl.py\n"
            "  (alternativa: pegar los SQL generados en Lovable SQL editor)"
        )
        return

    log.info("PASO 10 — Subiendo a Supabase …")
    try:
        from supabase import create_client
        client  = create_client(SUPABASE_URL, SUPABASE_KEY)
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
        log.info(f"  ✓ {len(records)} comunas cargadas ({MODEL_VERSION})")
    except ImportError:
        log.error("  pip install supabase")
    except Exception as e:
        log.error(f"  Error: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    log.info("═" * 70)
    log.info(f"  AGROPLANET ETL — IDPA Score Comunal Nacional {MODEL_VERSION}")
    log.info("═" * 70)

    lookup      = load_cut_lookup()
    name_to_cut = build_name_to_cut(lookup)

    superficie  = load_xlsx_superficie(name_to_cut)
    caf_maq     = load_caf_by_commune()
    forestal    = load_forestal()
    diversidad  = load_diversidad_especies()
    catastro_25 = load_catastro_fruticola_2025(name_to_cut)
    tipologia   = load_tipologia_rural()

    df = merge_all(lookup, superficie, caf_maq, forestal, diversidad, catastro_25, tipologia)
    df = compute_scores(df)

    validate(df, lookup)
    save_output(df)
    generate_sql(df)
    upload_supabase(df)

    log.info("═" * 70)
    log.info(f"  ETL completado. Output: etl/output/")
    log.info("═" * 70)


if __name__ == "__main__":
    main()
