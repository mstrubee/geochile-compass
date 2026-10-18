"""Cartera de beneficiarios del Sistema Isapre a nivel comunal (Superintendencia de Salud): lectura del XLSX, cruce a CUT, cuadres con los totales
del propio archivo y supresión de conteos pequeños (regla 5). Sin base de datos aquí.

Diseño: docs/salud/DISENO.md §3. La base (publish_isapre_snapshot) ejecuta el MISMO algoritmo de supresión con los conteos completos; este módulo lo
replica para el --dry-run y una prueba exige que ambos coincidan con el archivo real.
"""
from __future__ import annotations

import calendar
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

from permisos.norm import norm
from proyectos.common import Rejection

HERE = Path(__file__).resolve().parent
SOURCE_KEY = "superdesalud_isapre_cartera_comunal"
LAYER = "isapre_cartera"
DATA_URL_2025 = "https://www.superdesalud.gob.cl/app/uploads/2026/01/estadistica-anual-de-cartera-de-beneficiarios-comunal-2025.xlsx"
LANDING_URL = "https://www.superdesalud.gob.cl/"

# 21 tramos quinquenales + «sin información de edad»: posiciones 0..21 (las mismas que la base: tramo smallint 0..21)
TRAMOS = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70-74",
          "75-79", "80-84", "85-89", "90-94", "95-99", ">=100", "S/I"]
N_TRAMOS = len(TRAMOS)
FIRST_60 = TRAMOS.index("60-64")                  # 12; los tramos 12..20 son «60 años o más» (exacto); 21 = edad sin dato
SEXOS = ("F", "M", "SI")
ROLES = ("cotizante", "carga")
SHEETS = {("cotizante", "F"): "Cotizantes (F)", ("cotizante", "M"): "Cotizantes (M)", ("cotizante", "SI"): "Cotizantes (SI)",
          ("carga", "F"): "Cargas (F)", ("carga", "M"): "Cargas (M)", ("carga", "SI"): "Cargas (SI)"}
SHEET_TOTAL = {"cotizante": "Cotizantes", "carga": "Cargas"}
SHEET_TOTAL_ALT = {"cotizante": "Total Cotizantes", "carga": "Total Cargas"}
THRESHOLD = 5                                    # 1..THRESHOLD-1 se suprime (salud.suppress_below = 5, DISENO §2.9)


class StructureError(Exception):
    pass


@dataclass
class Unit:
    key: str                      # CUT 5 dígitos | 'SDC<región>' | 'SDR'
    kind: str                     # comuna | sin_dato_comuna | sin_dato_region
    region_cut: str | None
    comuna_cut: str | None
    name: str


@dataclass
class Cartera:
    period_month: int
    period_year: int
    extraction_date: date | None
    units: dict[str, Unit] = field(default_factory=dict)
    counts: dict[tuple[str, str, str], list[int]] = field(default_factory=dict)      # (unit, rol, sexo) -> 22 conteos
    region_totals: dict[tuple[str, str], int] = field(default_factory=dict)          # (region, rol) -> total publicado por el archivo
    pais_totals: dict[str, int] = field(default_factory=dict)                        # rol -> Total País publicado por el archivo
    rejections: list[Rejection] = field(default_factory=list)
    unit_rows: int = 0                                                              # filas de unidad leídas (comunas + «sin dato»)
    notes: list[str] = field(default_factory=list)


# ------------------------------------------------------------------------------------------------ lectura
def _clean(x) -> str:
    return re.sub(r"\s+", " ", str(x if x is not None else "")).strip()


def _classify(r: list) -> str | None:
    """Tipo de fila según TEXTO (los números de región del archivo son inconsistentes: 20, '-', 0)."""
    name, prov, com = _clean(r[1]), _clean(r[2]), _clean(r[3])
    if not name:
        return None
    n = norm(name)
    if n.startswith("fecha extraccion"):
        return "footer"
    if n == "total pais":
        return "total_pais"
    if n == "sin dato region":
        return "sin_dato_region"
    if prov == "-" and com == "-":
        return "region_total"
    if norm(com) == "sin dato comuna":
        return "sin_dato_comuna"
    return "comuna"


def _region_cut(n_region, name: str, region_by_name: dict[str, str]) -> str:
    """Código de región (2 dígitos) desde el número del archivo; el nombre se usa solo para confirmar."""
    if isinstance(n_region, (int, float)) and 1 <= int(n_region) <= 16:
        return f"{int(n_region):02d}"
    raise StructureError(f"número de región inválido {n_region!r} en la fila «{name}»")


def read_workbook(path: str | Path, comunas: list[dict], aliases: list[dict] | None = None) -> Cartera:
    """Lee el libro. `comunas`: [{cut, name, region_cut}]; `aliases`: [{region_cut, name, cut}] explícitos (p. ej. O'Higgins)."""
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    need = list(SHEETS.values()) + list(SHEET_TOTAL.values()) + list(SHEET_TOTAL_ALT.values()) + ["Indice"]
    missing = [s for s in need if s not in wb.sheetnames]
    if missing:
        raise StructureError("faltan hojas: " + ", ".join(missing))

    # período: la hoja Indice trae (MES, AÑO)
    month = year = None
    months = {m.upper(): i for i, m in enumerate(["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]) if m}
    for row in wb["Indice"].iter_rows(values_only=True):
        cells = [c for c in row if c is not None]
        for a, b in zip(cells, cells[1:]):
            if isinstance(a, str) and norm(a).upper() in months and isinstance(b, (int, float)):
                month, year = months[norm(a).upper()], int(b)
        if month:
            break
    if not month:
        raise StructureError("la hoja Indice no declara el período (mes y año)")
    cart = Cartera(period_month=month, period_year=year, extraction_date=None)

    by_key: dict[tuple[str, str], list[str]] = defaultdict(list)
    for c in comunas:
        by_key[(c["region_cut"], norm(c["name"]))].append(c["cut"])
    alias = {(a["region_cut"], norm(a["name"])): a["cut"] for a in (aliases or [])}

    def resolve(region_cut: str, name: str) -> str | None:
        k = (region_cut, norm(name))
        if k in alias:
            return alias[k]
        cuts = by_key.get(k)
        return cuts[0] if cuts and len(cuts) == 1 else None

    def sheet_rows(name: str):
        out = []
        for i, row in enumerate(wb[name].iter_rows(values_only=True)):
            if i < 7 or not any(x is not None for x in row):
                continue
            r = list(row)
            if len(r) < 4 + N_TRAMOS + 1:
                r += [None] * (4 + N_TRAMOS + 1 - len(r))
            out.append(r)
        return out

    def vec(r: list) -> list[int]:
        v = r[4:4 + N_TRAMOS]
        if any((not isinstance(x, (int, float))) or x < 0 or int(x) != x for x in v):
            raise StructureError(f"conteos no enteros o negativos en la fila «{_clean(r[3]) or _clean(r[1])}»")
        return [int(x) for x in v]

    row_total_bad: list[str] = []
    for (rol, sexo), sheet in SHEETS.items():
        for r in sheet_rows(sheet):
            kind = _classify(r)
            if kind == "footer":
                if cart.extraction_date is None and isinstance(r[2], (datetime, date)):
                    cart.extraction_date = r[2].date() if isinstance(r[2], datetime) else r[2]
                continue
            if kind is None:
                continue
            v = vec(r)
            tot = r[4 + N_TRAMOS]
            if isinstance(tot, (int, float)) and sum(v) != int(tot):
                row_total_bad.append(f"{sheet}: {_clean(r[3]) or _clean(r[1])}")
            if kind == "total_pais":
                continue
            if kind == "sin_dato_region":
                cart.units.setdefault("SDR", Unit("SDR", "sin_dato_region", None, None, "Sin dato de región"))
                key = "SDR"
            else:
                reg = _region_cut(r[0], _clean(r[1]), {})
                if kind == "region_total":
                    continue
                if kind == "sin_dato_comuna":
                    key = f"SDC{reg}"
                    cart.units.setdefault(key, Unit(key, "sin_dato_comuna", reg, None, f"Sin dato de comuna ({_clean(r[1])})"))
                else:
                    cut = resolve(reg, _clean(r[3]))
                    if cut is None:
                        if (rol, sexo) == ("cotizante", "F"):                       # un solo rechazo por unidad, no uno por hoja
                            cart.rejections.append(Rejection(LAYER, None, "cut_unknown", f"comuna sin cruce: región {reg} «{_clean(r[3])}»",
                                                             {"region": reg, "comuna": _clean(r[3])}))
                        continue
                    key = cut
                    cart.units.setdefault(key, Unit(key, "comuna", reg, cut, _clean(r[3])))
            if (key, rol, sexo) in cart.counts:
                raise StructureError(f"unidad repetida en {sheet}: {key}")
            cart.counts[(key, rol, sexo)] = v
    # totales publicados por el propio archivo (hojas «Cotizantes» y «Cargas», todas las edades y sexos): contra ellos se cuadra
    for rol, sheet in SHEET_TOTAL.items():
        for r in sheet_rows(sheet):
            kind = _classify(r)
            if kind == "total_pais":
                cart.pais_totals[rol] = sum(vec(r))
            elif kind == "region_total":
                cart.region_totals[(_region_cut(r[0], _clean(r[1]), {}), rol)] = sum(vec(r))
    cart.unit_rows = len(cart.units) + len(cart.rejections)
    if row_total_bad:
        raise StructureError("la fila total ≠ suma de tramos en: " + "; ".join(row_total_bad[:5]))
    return cart


# ------------------------------------------------------------------------------------------------ cuadres con los totales del archivo
def reconcile(cart: Cartera, wb_path: str | Path) -> dict:
    """Cuadres CONTRA LOS TOTALES PUBLICADOS por el propio archivo (con los datos completos, antes de suprimir). Devuelve {check: (ok, detalle)}."""
    import openpyxl
    wb = openpyxl.load_workbook(wb_path, read_only=True, data_only=True)

    def vectors(sheet: str):
        d: dict[tuple[str, str], list[int]] = {}
        pais = None
        reg_tot: dict[str, list[int]] = {}
        sdr = None
        sums_reg: dict[str, list[int]] = defaultdict(lambda: [0] * N_TRAMOS)
        for i, row in enumerate(wb[sheet].iter_rows(values_only=True)):
            if i < 7 or not any(x is not None for x in row):
                continue
            r = list(row) + [None] * 30
            kind = _classify(r)
            if kind in (None, "footer"):
                continue
            v = [int(x) for x in r[4:4 + N_TRAMOS]]
            if kind == "total_pais":
                pais = v
            elif kind == "sin_dato_region":
                sdr = v
            elif kind == "region_total":
                reg_tot[f"{int(r[0]):02d}"] = v
            else:
                reg = f"{int(r[0]):02d}"
                sums_reg[reg] = [a + b for a, b in zip(sums_reg[reg], v)]
                d[(reg, _clean(r[3]))] = v
        return pais, reg_tot, sums_reg, sdr, d

    out: dict[str, tuple[bool, str]] = {}
    for rol in ROLES:
        pais, reg_tot, sums_reg, sdr, rows = vectors(SHEET_TOTAL[rol])
        sums_all = [0] * N_TRAMOS
        for reg, v in sums_reg.items():
            sums_all = [a + b for a, b in zip(sums_all, v)]
        out[f"{rol}: Σ unidades de cada región = subtotal regional del archivo"] = (
            all(reg_tot.get(reg) == v for reg, v in sums_reg.items()) and set(reg_tot) == set(sums_reg), f"{len(reg_tot)} regiones")
        sdr_v = sdr or [0] * N_TRAMOS
        out[f"{rol}: Σ regiones + «sin dato de región» = Total País publicado ({sum(pais or [])})"] = (
            pais is not None and [a + b for a, b in zip(sums_all, sdr_v)] == pais, f"Σ={sum(sums_all) + sum(sdr_v)}")
        # hoja «Total …» (idéntica a la de totales por rol) y F+M+SI
        _p2, _r2, _s2, _sd2, rows2 = vectors(SHEET_TOTAL_ALT[rol])
        out[f"{rol}: hoja «{SHEET_TOTAL_ALT[rol]}» idéntica a «{SHEET_TOTAL[rol]}»"] = (rows2 == rows, f"{len(rows)} filas")
        fms = [vectors(SHEETS[(rol, s)])[4] for s in SEXOS]
        ok = all([a + b + c for a, b, c in zip(fms[0].get(k, [0] * N_TRAMOS), fms[1].get(k, [0] * N_TRAMOS), fms[2].get(k, [0] * N_TRAMOS))] == v for k, v in rows.items())
        out[f"{rol}: F + M + S/I = total de la comuna (todas las filas)"] = (ok, f"{len(rows)} filas")
        if pais is not None and rol in cart.pais_totals:
            out[f"{rol}: Total País leído = {cart.pais_totals[rol]}"] = (sum(pais) == cart.pais_totals[rol], str(sum(pais)))
    return out


# ------------------------------------------------------------------------------------------------ supresión (réplica Python del algoritmo de la base)
@dataclass
class CellOut:
    tramo: int
    n_pub: int | None
    suppressed: bool
    kind: str | None            # primary | complementary
    lo: int | None
    hi: int | None


@dataclass
class GroupOut:
    total: int                  # REAL (solo para validar; NO se publica si es 1..4)
    total_pub: int | None
    published_sum: int
    residual: int | None        # total − Σ publicadas (solo si el total se publica)
    suppressed_cells: int
    lo_sum: int
    cuadre_ok: bool
    cells: list[CellOut]


def suppress_group(values: list[int], threshold: int = THRESHOLD) -> GroupOut:
    """Supresión de UN grupo (unidad × sexo): primaria, total y complementaria. Ver DISENO §3.3."""
    assert len(values) == N_TRAMOS and all(v >= 0 for v in values)
    total = sum(values)
    supp = [0 < v < threshold for v in values]
    kind: list[str | None] = ["primary" if s else None for s in supp]
    total_pub = None if 0 < total < threshold else total
    if total_pub is not None and sum(supp) == 1:
        # la menor celda publicada con valor >= umbral (empate: menor tramo); si no hubiera, una celda en 0 (no ocurre con total >= umbral)
        cands = sorted((v, i) for i, v in enumerate(values) if not supp[i] and v >= threshold) or sorted((v, i) for i, v in enumerate(values) if not supp[i])
        _, j = cands[0]
        supp[j], kind[j] = True, "complementary"
    k = sum(supp)
    pub_sum = sum(v for v, s in zip(values, supp) if not s)
    residual = None if total_pub is None else total - pub_sum
    lo = [(1 if kind[i] == "primary" else (threshold if kind[i] == "complementary" and values[i] >= threshold else 0)) if supp[i] else None for i in range(N_TRAMOS)]
    lo_sum = sum(x for x in lo if x is not None)
    cells = []
    for i, v in enumerate(values):
        if not supp[i]:
            cells.append(CellOut(i, v, False, None, None, None))
            continue
        hi = threshold - 1 if kind[i] == "primary" else None
        if residual is not None:
            cap = residual - (lo_sum - lo[i])
            hi = cap if hi is None else min(hi, cap)
        elif hi is None:
            hi = threshold - 1
        cells.append(CellOut(i, None, True, kind[i], lo[i], hi))
    has_comp = any(c == "complementary" for c in kind)
    if residual is not None:
        ok = lo_sum <= residual and (has_comp or residual <= (threshold - 1) * k)
    else:
        ok = sum(v for v in values) <= (threshold - 1) * k if k else total == 0 or total_pub is not None
    return GroupOut(total, total_pub, pub_sum, residual, k, lo_sum, ok, cells)


def beneficiaries(cart: Cartera) -> dict[tuple[str, str], list[int]]:
    """(unidad, sexo) -> conteos de beneficiarios (cotizantes + cargas) por tramo."""
    out: dict[tuple[str, str], list[int]] = {}
    for (unit, rol, sexo), v in cart.counts.items():
        cur = out.setdefault((unit, sexo), [0] * N_TRAMOS)
        out[(unit, sexo)] = [a + b for a, b in zip(cur, v)]
    for unit in cart.units:
        for s in SEXOS:
            out.setdefault((unit, s), [0] * N_TRAMOS)
    return out


def suppress_all(cart: Cartera) -> dict[tuple[str, str], GroupOut]:
    return {k: suppress_group(v) for k, v in sorted(beneficiaries(cart).items())}


def summarize(groups: dict[tuple[str, str], GroupOut]) -> dict:
    c: Counter = Counter()
    for g in groups.values():
        c["grupos"] += 1
        c["celdas"] += len(g.cells)
        for cell in g.cells:
            if cell.suppressed:
                c[f"suprimidas_{cell.kind}"] += 1
            elif cell.n_pub == 0:
                c["ceros_publicados"] += 1
        c["grupos_con_total_suprimido"] += g.total_pub is None and g.total > 0
        c["grupos_con_complementaria"] += any(x.kind == "complementary" for x in g.cells)
        c["grupos_cuadre_fallido"] += not g.cuadre_ok
    return dict(c)
