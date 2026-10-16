"""Parser de MINVU CEDOC: de las hojas crudas a valores trazables por (hoja, CUT, período).

Reglas (todas verificadas el 2026-10-16 contra los dos archivos reales publicados el 2026-09-11):

* El archivo NO trae CUT, solo nombres. El cruce es: alias explícito (aliases_minvu.json) o nombre
  normalizado ÚNICO contra la tabla de comunas. Cualquier nombre sin match, ambiguo o de otra región
  DETIENE la carga: no hay coincidencia aproximada ("fuzzy") en ningún caso.
* 367 filas de comuna = 346 comunas + 21 de Ñuble duplicadas: una fila "Ñuble (ex-Biobío)" con valores
  hasta 2017 (ceros después) y una fila "Ñuble" con ceros hasta 2017 (valores desde 2018). Esos ceros son
  ESTRUCTURALES (la comuna aún no pertenecía a esa región), no ceros reales. Se fusionan por CUT eligiendo,
  para cada período, la fila de la región vigente (el año de corte sale de la propia nota "Desde ene. 2018
  comienza a regir la región ÑUBLE"); y se EXIGE que la otra fila valga 0, si no hay conflicto y se rechaza.
* La calidad sale del TEXTO de las notas ("Los datos registrados hasta el año 2024 son definitivos"), no
  del símbolo: el anual rotula 2025 con (*) y el mensual con (**). Marcas y notas se guardan literales.
* Cuadres: la suma de las filas de comuna debe ser IGUAL a "Total País" en cada hoja y columna.
"""
from __future__ import annotations

import calendar
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from .norm import NUBLE_EX_BIOBIO_LABEL, NUBLE_LABEL, REGION_LABELS, norm
from .xlsx_reader import ColSpec, LayoutError, RawRow, SheetData

SHEET_RE = re.compile(r"^(número|m2)_(total|casas|departamentos)$")


def sheet_series(sheet: str) -> tuple[str, str]:
    """número_casas -> ('units', 'casas');  m2_total -> ('area_m2', 'total')."""
    m = SHEET_RE.match(sheet)
    if not m:
        raise LayoutError(f"hoja desconocida: {sheet!r}")
    return ("units" if m.group(1) == "número" else "area_m2"), m.group(2)


# ----------------------------------------------------------------------------- modelos
@dataclass
class Rejection:
    sheet: str | None
    row: int | None
    col: int | None
    code: str
    detail: str
    raw: Any = None


@dataclass
class ControlTotal:
    sheet: str
    period: date
    granularity: str
    declared: int
    computed: int

    @property
    def ok(self) -> bool:
        return self.declared == self.computed


@dataclass
class Parsed:
    kind: str                                   # 'annual' | 'monthly'
    sheets: dict[str, SheetData]
    cols: list[ColSpec]
    nuble_split: date | None
    definitive_until: int
    provisional_note: str | None
    notes: list[dict]
    header_marks: dict[int, str]
    aliases_used: list[dict] = field(default_factory=list)
    merges: list[dict] = field(default_factory=list)
    layout: dict = field(default_factory=dict)
    cut_rows: dict[str, list[RawRow]] = field(default_factory=dict)
    values: dict[tuple[str, str, int], int] = field(default_factory=dict)       # (hoja, cut, col) -> valor fusionado
    rejections: list[Rejection] = field(default_factory=list)
    controls: list[ControlTotal] = field(default_factory=list)
    internal_mismatches: list[dict] = field(default_factory=list)
    region_mismatches: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)                               # bloqueantes
    cells_examined: int = 0

    @property
    def ok(self) -> bool:
        return not self.errors and all(c.ok for c in self.controls)

    def is_provisional(self, year: int) -> bool:
        return year > self.definitive_until

    @property
    def period_start(self) -> date:
        return min(c.period for c in self.cols)

    @property
    def period_end(self) -> date:
        """Último DÍA cubierto por el archivo (p. ej. 2026-07-31)."""
        last = max(self.cols, key=lambda c: c.period)
        if last.month is None:
            return date(last.year, 12, 31)
        return date(last.year, last.month, calendar.monthrange(last.year, last.month)[1])


# ----------------------------------------------------------------------------- resolución de nombres
class Resolver:
    def __init__(self, comunas: list[dict], aliases: list[dict]):
        """comunas: [{cut, name, region_cut}]; aliases: [{region_label, name, cut, reason}]."""
        self.region_of = {c["cut"]: c["region_cut"] for c in comunas}
        self.by_name: dict[str, list[str]] = defaultdict(list)
        for c in comunas:
            self.by_name[norm(c["name"])].append(c["cut"])
        self.alias: dict[tuple[str, str], dict] = {}
        for a in aliases:
            if a["cut"] not in self.region_of:
                raise ValueError(f"alias hacia un CUT que no existe: {a}")
            self.alias[(norm(a["region_label"]), norm(a["name"]))] = a

    def resolve(self, region_label: str, name: str) -> tuple[str, str, dict | None]:
        """-> (cut, 'alias'|'exact', alias|None) o lanza KeyError con el motivo."""
        rl = norm(region_label)
        if rl not in REGION_LABELS:
            raise KeyError(f"etiqueta de región desconocida {region_label!r}")
        a = self.alias.get((rl, norm(name)))
        if a is not None:
            cut, via = a["cut"], "alias"
        else:
            cands = self.by_name.get(norm(name), [])
            if len(cands) == 0:
                raise KeyError(f"sin coincidencia exacta para {name!r} (región {region_label!r}); agregar un alias explícito si corresponde")
            if len(cands) > 1:
                raise KeyError(f"nombre ambiguo {name!r}: {cands}; se requiere alias por región")
            cut, via, a = cands[0], "exact", None
        if self.region_of[cut] != REGION_LABELS[rl]:
            raise KeyError(f"{name!r} resuelve a {cut} (región {self.region_of[cut]}) pero el archivo la ubica en {region_label!r} ({REGION_LABELS[rl]})")
        return cut, via, a


# ----------------------------------------------------------------------------- notas
_DEFINITIVE_RE = re.compile(r"hasta el ano (\d{4}) son definitivos")
_NUBLE_RE = re.compile(r"desde ene\.? (\d{4}) comienza a regir la region nuble")


def parse_notes(notes) -> tuple[int | None, str | None, int | None, list[dict]]:
    """-> (definitivo_hasta, nota_provisional, año_corte_ñuble, notas_literales)."""
    definitive = None
    provisional_note = None
    split = None
    literal = []
    for n in notes:
        literal.append({"row": n.row, "marker": n.marker, "text": n.text})
        t = norm(n.text)
        m = _DEFINITIVE_RE.search(t)
        if m:
            definitive = int(m.group(1))
        if "preliminar" in t and provisional_note is None:
            provisional_note = n.text
        m = _NUBLE_RE.search(t)
        if m:
            split = int(m.group(1))
    return definitive, provisional_note, split, literal


# ----------------------------------------------------------------------------- parseo principal
def _numeric(v: Any) -> tuple[int | None, str | None]:
    if isinstance(v, bool):
        return None, "non_numeric"
    if isinstance(v, int):
        return (v, None) if v >= 0 else (None, "negative_value")
    if isinstance(v, float):
        if v != int(v):
            return None, "non_numeric"
        return (int(v), None) if v >= 0 else (None, "negative_value")
    return None, "non_numeric"


def parse(sheets: dict[str, SheetData], resolver: Resolver) -> Parsed:
    names = list(sheets)
    ref = sheets[names[0]]

    # --- misma estructura en las 6 hojas (si no, no se puede citar una celda de forma única)
    for n in names[1:]:
        s = sheets[n]
        if [(c.col, c.year, c.month) for c in s.cols] != [(c.col, c.year, c.month) for c in ref.cols]:
            raise LayoutError(f"las columnas de {n!r} difieren de las de {ref.name!r}", "layout_mismatch")
        if [(r.row, r.region_label, r.comuna_label) for r in s.rows] != [(r.row, r.region_label, r.comuna_label) for r in ref.rows]:
            raise LayoutError(f"las filas de comuna de {n!r} difieren de las de {ref.name!r}", "layout_mismatch")
        if s.total_row != ref.total_row:
            raise LayoutError(f"la fila 'Total País' de {n!r} difiere", "layout_mismatch")
        if [x.text for x in s.notes] != [x.text for x in ref.notes]:
            raise LayoutError(f"las notas de {n!r} difieren", "layout_mismatch")

    definitive, provisional_note, split_year, notes = parse_notes(ref.notes)
    kind = "annual" if any(c.month is None for c in ref.cols) else "monthly"
    p = Parsed(
        kind=kind, sheets=sheets, cols=ref.cols,
        nuble_split=date(split_year, 1, 1) if split_year else None,
        definitive_until=definitive if definitive is not None else -1,
        provisional_note=provisional_note, notes=notes,
        header_marks={c.year: c.mark for c in ref.cols if c.mark},
    )
    if definitive is None:
        p.errors.append("las notas no dicen hasta qué año los datos son definitivos: no se puede determinar la calidad")

    # --- nombres -> CUT
    by_cut: dict[str, list[tuple[RawRow, str]]] = defaultdict(list)
    for r in ref.rows:
        try:
            cut, via, alias = resolver.resolve(r.region_label, r.comuna_label)
        except KeyError as e:
            p.errors.append(f"fila {r.row}: {e}")
            p.rejections.append(Rejection(ref.name, r.row, None, "comuna_unmatched", str(e), [r.region_label, r.comuna_label]))
            continue
        by_cut[cut].append((r, norm(r.region_label)))
        if via == "alias":
            p.aliases_used.append({"row": r.row, "region_label": r.region_label, "name": r.comuna_label,
                                   "cut": cut, "reason": alias["reason"]})

    # --- fusión de duplicados (solo se admite el caso Ñuble / ex-Biobío)
    plan: dict[str, dict] = {}
    for cut, items in by_cut.items():
        if len(items) == 1:
            plan[cut] = {"single": items[0][0]}
            continue
        labels = sorted(lbl for _, lbl in items)
        if len(items) == 2 and labels == sorted([NUBLE_LABEL, NUBLE_EX_BIOBIO_LABEL]):
            if p.nuble_split is None:
                p.errors.append(f"{cut}: hay filas Ñuble/ex-Biobío pero las notas no indican el año de corte")
                continue
            before = next(r for r, lbl in items if lbl == NUBLE_EX_BIOBIO_LABEL)
            after = next(r for r, lbl in items if lbl == NUBLE_LABEL)
            plan[cut] = {"split": (before, after)}
            p.merges.append({"cut": cut, "name": after.comuna_label, "row_before": before.row, "row_from": after.row,
                             "split": p.nuble_split.isoformat()})
        else:
            rows = [r.row for r, _ in items]
            p.errors.append(f"{cut}: {len(items)} filas {rows} con etiquetas {labels}; solo se fusiona Ñuble / ex-Biobío")

    # --- layout citable (hoja/fila/columna)
    p.layout = {
        "rows": {cut: ([pl["single"].row] if "single" in pl else
                       {"split": p.nuble_split.isoformat(), "before": pl["split"][0].row, "from": pl["split"][1].row})
                 for cut, pl in plan.items()},
        "cols": {c.key: c.col for c in ref.cols},
        "header_row": ref.header_row, "total_row": ref.total_row,
    }
    p.cut_rows = {cut: ([pl["single"]] if "single" in pl else list(pl["split"])) for cut, pl in plan.items()}

    # --- valores
    for sname, s in sheets.items():
        raw_by_row = {r.row: r for r in s.rows}
        for cut, pl in plan.items():
            for c in s.cols:
                if "single" in pl:
                    row = raw_by_row[pl["single"].row]
                    v, bad = _numeric(row.values[c.col])
                    p.cells_examined += 1
                    if bad:
                        p.rejections.append(Rejection(sname, row.row, c.col, bad, f"celda no válida: {row.values[c.col]!r}", row.values[c.col]))
                        continue
                    p.values[(sname, cut, c.col)] = v
                else:
                    before, after = (raw_by_row[pl["split"][0].row], raw_by_row[pl["split"][1].row])
                    use, other = (before, after) if c.period < p.nuble_split else (after, before)
                    v, bad = _numeric(use.values[c.col])
                    ov, obad = _numeric(other.values[c.col])
                    p.cells_examined += 2
                    if bad:
                        p.rejections.append(Rejection(sname, use.row, c.col, bad, f"celda no válida: {use.values[c.col]!r}", use.values[c.col]))
                        continue
                    if obad or ov != 0:
                        # el cero estructural de la otra fila NO se cumple: no se suma ni se elige, se rechaza
                        p.rejections.append(Rejection(sname, other.row, c.col, "duplicate_key",
                                                      f"{cut}: la fila que no aplica a {c.key} no vale 0 ({other.values[c.col]!r})", other.values[c.col]))
                        continue
                    p.values[(sname, cut, c.col)] = v

    # --- cuadre con "Total País"
    for sname, s in sheets.items():
        for c in s.cols:
            declared, bad = _numeric(s.total_values.get(c.col))
            if bad:
                p.errors.append(f"{sname}: 'Total País' ilegible en {c.key}: {s.total_values.get(c.col)!r}")
                continue
            computed = 0
            for r in s.rows:
                v, b = _numeric(r.values[c.col])
                if not b:
                    computed += v
            p.controls.append(ControlTotal(sname, c.period, c.granularity, declared, computed))

    # --- coherencia interna: total = casas + departamentos, por comuna y columna
    for metric in ("número", "m2"):
        tot, cas, dep = (f"{metric}_total", f"{metric}_casas", f"{metric}_departamentos")
        for cut in plan:
            for c in ref.cols:
                t, a, b = (p.values.get((x, cut, c.col)) for x in (tot, cas, dep))
                if None in (t, a, b):
                    continue
                if t != a + b:
                    p.internal_mismatches.append({"metric": metric, "cut": cut, "period": c.key, "total": t, "casas": a, "departamentos": b})

    # --- subtotales regionales (informativo): suma de comunas por región vs fila de subtotal
    p.region_mismatches = _check_regions(ref, sheets)
    return p


def _check_regions(ref: SheetData, sheets: dict[str, SheetData]) -> list[dict]:
    """Compara cada subtotal regional con la suma de sus comunas. Biobío incluye las filas 'Ñuble (ex-Biobío)'."""
    out = []
    for sname, s in sheets.items():
        sums: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        for r in s.rows:
            lbl = norm(r.region_label)
            key = "biobio" if lbl == NUBLE_EX_BIOBIO_LABEL else re.sub(r"\s*\(\*+\)", "", lbl)
            for c in s.cols:
                v, bad = _numeric(r.values[c.col])
                if not bad:
                    sums[key][c.col] += v
        for rr in s.region_rows:
            key = re.sub(r"\s*\(\*+\)", "", norm(rr.region_label))
            key = {"biobio": "biobio"}.get(key, key)
            for c in s.cols:
                d, bad = _numeric(rr.values[c.col])
                if bad:
                    continue
                if sums[key][c.col] != d:
                    out.append({"sheet": sname, "region": rr.region_label, "period": c.key, "subtotal": d, "suma_comunas": sums[key][c.col]})
    return out


# ----------------------------------------------------------------------------- qué se carga
def months_back(d: date, n: int) -> date:
    y, m = d.year, d.month - n
    while m < 1:
        m += 12
        y -= 1
    return date(y, m, 1)


@dataclass
class LoadPlan:
    granularity: str
    load_from: date
    columns: list[ColSpec]
    not_stored: list[str]


def plan_load(p: Parsed, annual_from_year: int, monthly_keep_years: int) -> LoadPlan:
    """Qué columnas se almacenan (decisión del usuario, 2026-10-16):
    anual -> solo AÑOS desde `annual_from_year` (sus meses de 2026 son idénticos a los del mensual: control cruzado, no se guardan);
    mensual -> solo MESES de los últimos `monthly_keep_years` años."""
    if p.kind == "annual":
        cols = [c for c in p.cols if c.month is None and c.year >= annual_from_year]
        skipped = sorted({c.key for c in p.cols if c.month is not None})
        return LoadPlan("year", date(annual_from_year, 1, 1), cols, skipped)
    last = max(c.period for c in p.cols)
    load_from = months_back(last, monthly_keep_years * 12 - 1)
    cols = [c for c in p.cols if c.period >= load_from]
    return LoadPlan("month", load_from, cols, [])


def stage_rows(p: Parsed, plan: LoadPlan):
    """Genera (hoja, cut, período, valor, provisional) de lo que se cargará."""
    for (sname, cut, col), v in sorted(p.values.items()):
        c = next((x for x in plan.columns if x.col == col), None)
        if c is None:
            continue
        yield sname, cut, c.period, v, p.is_provisional(c.year)


# ----------------------------------------------------------------------------- control cruzado anual vs mensual
def cross_check(annual: Parsed, monthly: Parsed) -> dict:
    """El anual de cada comuna/año debe ser la suma de sus 12 meses, y los meses que los dos archivos traen deben coincidir."""
    mcol = {(c.year, c.month): c.col for c in monthly.cols}
    acol_y = {c.year: c.col for c in annual.cols if c.month is None}
    acol_m = {(c.year, c.month): c.col for c in annual.cols if c.month is not None}
    compared_years = compared_months = 0
    mismatches: list[dict] = []
    for sname in annual.sheets:
        for cut in annual.cut_rows:
            for y, ac in acol_y.items():
                cols = [mcol.get((y, m)) for m in range(1, 13)]
                if None in cols:
                    continue
                a = annual.values.get((sname, cut, ac))
                ms = [monthly.values.get((sname, cut, c)) for c in cols]
                if a is None or None in ms:
                    continue
                compared_years += 1
                if a != sum(ms):
                    mismatches.append({"sheet": sname, "cut": cut, "year": y, "anual": a, "suma_meses": sum(ms)})
            for (y, m), ac in acol_m.items():
                mc = mcol.get((y, m))
                if mc is None:
                    continue
                a, b = annual.values.get((sname, cut, ac)), monthly.values.get((sname, cut, mc))
                if a is None or b is None:
                    continue
                compared_months += 1
                if a != b:
                    mismatches.append({"sheet": sname, "cut": cut, "year": y, "month": m, "anual": a, "mensual": b})
    return {"compared_year_cells": compared_years, "compared_month_cells": compared_months,
            "mismatches": mismatches, "ok": not mismatches and (compared_years + compared_months) > 0}
