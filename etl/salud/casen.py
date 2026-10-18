"""CASEN 2024: distribución del sistema previsional de salud (s13) por REGIÓN, con error muestral por linealización de Taylor. Sin base de datos aquí.

Diseño: docs/salud/DISENO.md §3.5. Solo regional (D6): la CASEN no es representativa a nivel comunal y aquí no se calcula nada comunal.
Se contrasta con el tabulado OFICIAL Salud_Casen_2024.xlsx (hoja 3: estimación, población expandida, error estándar y casos muestrales).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from statistics import NormalDist

from permisos.norm import norm

SOURCE_KEY = "mds_casen_2024_nacional"
DATA_URL = "https://observatorio.ministeriodesarrollosocial.gob.cl/storage/docs/casen/2024/casen_2024.sav"
TABULADO_URL = "https://observatorio.ministeriodesarrollosocial.gob.cl/storage/docs/casen/2024/Salud_Casen_2024.xlsx"
LANDING_URL = "https://observatorio.ministeriodesarrollosocial.gob.cl/encuesta-casen-2024"
MIN_CASES = 60                                    # nota técnica b del tabulado: no usar estimaciones con menos de 60 casos muestrales

# s13 (libro de códigos): 1 Fonasa · 2 Isapre · 3 FF.AA. y del Orden · 4 Ninguno (particular) · 5 Otro sistema · -88 No sabe
SISTEMAS = {1: "fonasa", 2: "isapre", 3: "ffaa", 4: "ninguno", 5: "otro", -88: "nosabe"}
SISTEMA_TABULADO = {"Sistema Público FONASA": "fonasa", "Isapre": "isapre", "FF.AA. y del Orden": "ffaa", "Ninguno (particular)": "ninguno",
                    "Otro sistema": "otro", "No sabe": "nosabe"}
SISTEMA_NOTA = {"otro sistema": "otro", "no sabe": "nosabe", "ninguno": "ninguno", "fonasa": "fonasa", "isapre": "isapre"}
# Etiqueta de región del tabulado -> CUT de región. Explícito: una etiqueta que no esté aquí detiene la carga.
REGION_TABULADO = {norm(k): v for k, v in {
    "Arica y Parinacota": "15", "Tarapacá": "01", "Antofagasta": "02", "Atacama": "03", "Coquimbo": "04", "Valparaíso": "05",
    "Región Metropolitana": "13", "O'Higgins": "06", "Maule": "07", "Ñuble": "16", "Biobío": "08", "La Araucanía": "09",
    "Los Ríos": "14", "Los Lagos": "10", "Aysén": "11", "Magallanes": "12",
    "Araucanía": "09"}.items()}                                  # el tabulado escribe «Araucanía» en un bloque y «La Araucanía» en otro
# Cómo las nombran las NOTAS del tabulado («Araucanía», «Metropolitana», «O´Higgins»)
REGION_NOTA = {"arica y parinacota": "15", "tarapaca": "01", "antofagasta": "02", "atacama": "03", "coquimbo": "04", "valparaiso": "05",
               "metropolitana": "13", "o'higgins": "06", "o higgins": "06",      # «O´Higgins» (acento agudo): NFKD lo deja como «o higgins»
                "maule": "07", "nuble": "16", "biobio": "08", "araucania": "09",
               "los rios": "14", "los lagos": "10", "aysen": "11", "magallanes": "12"}
REGIONS = sorted(set(REGION_TABULADO.values()))


class StructureError(Exception):
    pass


def t_quantile(df: float, p: float = 0.975) -> float:
    """Cuantil de la t de Student por la expansión de Cornish–Fisher (error < 1e-4 para df ≥ 30). Sin scipy; df menor se rechaza."""
    if df < 30:
        raise StructureError(f"grados de libertad insuficientes ({df}) para el intervalo de confianza")
    z = NormalDist().inv_cdf(p)
    return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)


@dataclass
class Estimate:
    region_cut: str
    sistema: str
    n_sample: int                     # personas de la muestra en la categoría
    pct: float
    se: float                         # error estándar en puntos porcentuales
    ci_lo: float
    ci_hi: float
    n_psu: int
    n_strata: int
    df: int
    lonely_strata: int
    publishable: bool = True
    reason: str | None = None
    official: dict | None = None


@dataclass
class Official:
    pct: dict[tuple[str, str], float] = field(default_factory=dict)
    pop: dict[tuple[str, str], int] = field(default_factory=dict)
    se: dict[tuple[str, str], float] = field(default_factory=dict)
    n: dict[tuple[str, str], int] = field(default_factory=dict)
    n_total: dict[str, int] = field(default_factory=dict)                      # región -> casos muestrales totales (fila «Total»)
    pop_total: dict[str, int] = field(default_factory=dict)                    # región -> población expandida total (fila «Total»)
    unreliable: dict[tuple[str, str], str] = field(default_factory=dict)       # (región, sistema) -> texto de la nota oficial
    notes: list[str] = field(default_factory=list)


def read_sav(path: str | Path):
    """Solo las 7 columnas necesarias (la base completa tiene cientos de variables y 750 MB); NO se guarda ninguna fila de persona."""
    import pyreadstat
    df, _meta = pyreadstat.read_sav(str(path), usecols=["region", "expr", "varstrat", "varunit", "s13", "edad", "sexo"])
    missing = {"region", "expr", "varstrat", "varunit", "s13"} - set(df.columns)
    if missing:
        raise StructureError("faltan variables: " + ", ".join(sorted(missing)))
    bad = set(df["s13"].dropna().astype(int).unique()) - set(SISTEMAS)
    if bad:
        raise StructureError(f"códigos de s13 no esperados: {sorted(bad)}")
    if df[["region", "expr", "varstrat", "varunit", "s13"]].isna().any().any():
        raise StructureError("hay valores perdidos en región, factor, estrato, conglomerado o s13")
    return df


def estimate(df) -> list[Estimate]:
    """Proporción por región y sistema con el factor regional `expr`; varianza por linealización de Taylor, un solo nivel de conglomerados
    (estratos `varstrat`, conglomerados `varunit`): V = Σ_h n_h/(n_h−1) Σ_j (z_hj − z̄_h)², z_hj = Σ_i∈j w_i (y_i − p)/W. df = conglomerados − estratos."""
    import numpy as np
    out: list[Estimate] = []
    for code, g in df.groupby("region"):
        region_cut = f"{int(code):02d}"
        w = g["expr"].to_numpy(float)
        W = w.sum()
        key = (g["varstrat"].astype("int64").astype(str) + "|" + g["varunit"].astype("int64").astype(str)).to_numpy()
        strat = g["varstrat"].to_numpy()
        for s13, name in SISTEMAS.items():
            y = (g["s13"].to_numpy() == s13).astype(float)
            p = float((w * y).sum() / W)
            z = w * (y - p) / W
            import pandas as pd
            u = pd.DataFrame({"strat": strat, "unit": key, "z": z}).groupby(["strat", "unit"], sort=False)["z"].sum().reset_index()
            h = u.groupby("strat")["z"].agg(["count", "mean"])
            u = u.join(h, on="strat")
            ok = u["count"] > 1
            v = float(((u["count"] / (u["count"] - 1)) * (u["z"] - u["mean"]) ** 2)[ok].sum())
            se = math.sqrt(v) * 100
            n_psu, n_str = len(u), int(h.shape[0])
            dfree = n_psu - n_str
            tq = t_quantile(dfree)
            pct = 100 * p
            out.append(Estimate(region_cut, name, int(y.sum()), pct, se, max(0.0, pct - tq * se), min(100.0, pct + tq * se), n_psu, n_str, dfree, int((h["count"] <= 1).sum())))
    return out


def read_official(path: str | Path) -> Official:
    """Hoja 3 del tabulado oficial: bloques «Estimación», «Población expandida», «Error estándar» y «Casos muestrales», columna 2024."""
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if "3" not in wb.sheetnames:
        raise StructureError("el tabulado no tiene la hoja 3 (previsión por región)")
    rows = [list(r) for r in wb["3"].iter_rows(values_only=True)]
    off = Official()
    block = None
    labels = {"estimacion": "pct", "poblacion expandida": "pop", "error estandar": "se", "casos muestrales": "n"}
    hdr_col = None
    for r in rows:
        first = norm(r[0]) if isinstance(r[0], str) else ""
        if first in labels and r[1] == r[0]:
            block = labels[first]
            continue
        if first == "categoria":
            hdr_col = next((i for i, x in enumerate(r) if str(x).strip() == "2024"), None)
            if hdr_col is None:
                raise StructureError("el tabulado no trae la columna 2024")
            continue
        if isinstance(r[0], str) and norm(r[0]) in REGION_TABULADO and isinstance(r[1], str) and r[1] in SISTEMA_TABULADO and block and hdr_col is not None:
            v = r[hdr_col]
            if isinstance(v, (int, float)):
                getattr(off, block)[(REGION_TABULADO[norm(r[0])], SISTEMA_TABULADO[r[1]])] = v
        elif isinstance(r[0], str) and norm(r[0]) in REGION_TABULADO and r[1] == "Total" and block in ("n", "pop") and hdr_col is not None and isinstance(r[hdr_col], (int, float)):
            (off.n_total if block == "n" else off.pop_total)[REGION_TABULADO[norm(r[0])]] = int(r[hdr_col])
        elif isinstance(r[0], str) and "no fiable" in norm(r[0]):
            off.notes.append(r[0].strip())
            m = re.search(r'categoria\s+"?([^"]+?)"?\s+en region', norm(r[0]).replace("“", '"').replace("”", '"'))
            cat = norm(m.group(1)) if m else None
            if cat in SISTEMA_NOTA:
                text = norm(r[0]).replace("´", "'")
                for rname, cut in REGION_NOTA.items():
                    if re.search(rf"(?<![a-z]){re.escape(rname)}(?![a-z])", text):
                        off.unreliable[(cut, SISTEMA_NOTA[cat])] = r[0].strip()
    if not off.pct:
        raise StructureError("no se leyó ninguna estimación del tabulado")
    return off


def region_totals(df) -> dict[str, dict]:
    """Personas de la muestra y población expandida (Σ expr) por región, para cuadrar con las filas «Total» del tabulado."""
    out = {}
    for code, g in df.groupby("region"):
        out[f"{int(code):02d}"] = {"n": int(len(g)), "pop": float(g["expr"].sum())}
    return out


def finalize(ests: list[Estimate], off: Official | None) -> list[Estimate]:
    """Marca como NO publicables las estimaciones con < 60 casos muestrales o declaradas «no fiables» por las notas oficiales; adjunta el contraste oficial."""
    for e in ests:
        k = (e.region_cut, e.sistema)
        if off is not None:
            e.official = {"pct": off.pct.get(k), "se": off.se.get(k), "n": off.n.get(k)}
        reasons = []
        if e.n_sample < MIN_CASES:
            reasons.append(f"menos de {MIN_CASES} casos muestrales")
        if off is not None and k in off.unreliable:
            reasons.append("estimación no fiable por tamaño muestral según nota oficial")
        e.publishable = not reasons
        e.reason = "; ".join(reasons) or None
    return ests


def compare(ests: list[Estimate], off: Official, tol_pct: float = 0.001, tol_se: float = 0.005) -> dict:
    """Contraste con el tabulado oficial: diferencia máxima de la estimación, del error estándar y de los casos muestrales."""
    dp = ds = 0.0
    dn = 0
    missing = []
    for e in ests:
        k = (e.region_cut, e.sistema)
        if k not in off.pct:
            missing.append(k)
            continue
        dp = max(dp, abs(e.pct - off.pct[k]))
        if k in off.se:
            ds = max(ds, abs(e.se - off.se[k]))
        if k in off.n:
            dn = max(dn, abs(e.n_sample - off.n[k]))
    return {"max_diff_pct_pp": dp, "max_diff_se_pp": ds, "max_diff_n": dn, "missing_in_official": len(missing),
            "ok": dp <= tol_pct and ds <= tol_se and dn == 0 and not missing, "tol_pct": tol_pct, "tol_se": tol_se}
