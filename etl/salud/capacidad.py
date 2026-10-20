"""Lectores y cuadres de la capacidad hospitalaria (DEIS/MINSAL): REM 20 (ocupación) y dotación de camas. Nada se corrige, estima ni resta: lo que no cuadra detiene la carga.

REM 20 — datos.gob.cl, dataset `indicadores-hospitalarios-rem20`, recurso `Indicadores_REM20.csv` (CC0). CSV UTF-8, `;`, 20 columnas EXACTAS, una fila por
(período, establecimiento, área funcional, mes). La URL del recurso lleva la fecha de publicación: se resuelve por CKAN en cada carga y se registra la URL efectiva.
  · Se guardan los COMPONENTES (días-cama ocupados y disponibles, estada, egresos, fallecidos, traslados). El índice publicado se usa solo para VALIDAR contra la fórmula oficial
    (días-cama ocupados / días-cama disponibles × 100; ficha DEIS «Porcentaje de ocupación o Índice ocupacional»): todo desvío > 0,0051 detiene la carga.
  · Las claves duplicadas (período, código, área, mes) se SUMAN componente a componente y se cuentan (filas = 2).

Dotación — repositoriodeis.minsal.cl/ContenidoSitioWeb2020/Estadisticas/DOTACION_CAMAS/«Dotación de camas 2010-<año> Establecimientos Pertenecientes al SNSS.xlsx».
Una sola hoja. El código del establecimiento solo aparece en la fila «Total» (área 100): las filas de áreas lo heredan por posición. Una celda vacía o de texto (`*******`) = sin dato (no se
guarda). Dos bloques del mismo código (Hospital Metropolitano, cambio de Servicio de Salud) se SUMAN; si ambos traen un valor > 0 para la misma (código, año, área) la carga se detiene.
La fila «Total País» del archivo cuadra, año por año, con la suma de los totales por establecimiento.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

REM20_SOURCE_KEY = "deis_rem20_hospitalizacion"
DOTACION_SOURCE_KEY = "deis_dotacion_camas"
CKAN_PACKAGE_URL = "https://datos.gob.cl/api/3/action/package_show?id=indicadores-hospitalarios-rem20"
REM20_RESOURCE_NAME = "Indicadores_REM20.csv"
REM20_LICENSE_ID = "cc-zero"
DOTACION_BASE_URL = "https://repositoriodeis.minsal.cl/ContenidoSitioWeb2020/Estadisticas/DOTACION_CAMAS"
DOTACION_NAME = "Dotación de camas 2010-{year} Establecimientos Pertenecientes al SNSS.xlsx"
DOTACION_FIRST_YEAR_OF_FILE = 2010

REM20_COLUMNS = ["PERIODO", "TIPO_PERTENENCIA", "COD_SSS", "GLOSA_SSS", "CODIGO_ESTABLECIMIENTO", "ESTABLECIMIENTO", "COD_AREA_FUNCIONAL", "AREA_FUNCIONAL", "MES",
                 "DIAS_CAMAS_OCUPADAS", "DIAS_CAMAS_DISPONIBLES", "DIAS_ESTADA", "NUMERO_EGRESOS", "EGRESOS_FALLECIDOS", "TRASLADOS", "INDICE_OCUPACIONAL",
                 "PROMEDIO_CAMAS_DISPONIBLE", "PROMEDIO_DIAS_ESTADA", "LETALIDAD", "INDICE_ROTACION"]
INDEX_TOLERANCE = 0.0051                       # el archivo publica 2 decimales: el desvío máximo medido contra la fórmula es 0,005
TOTAL_AREA = 100                               # «Total» de la hoja de dotación
# Las 29 áreas funcionales de REM 20 y dotación (deben coincidir con la semilla de health_areas_funcionales: lo comprueba una prueba)
KNOWN_AREAS = frozenset({330, *range(401, 417), *range(418, 430)})


class StructureError(Exception):
    """El archivo no tiene la estructura esperada (columnas, hoja, encabezados o tipos): no se carga nada."""


# ----------------------------------------------------------------------------------------------- REM 20
@dataclass
class Rem20:
    # (código, período del mes, área) → [ocupados, disponibles, estada, egresos, fallecidos, traslados, filas]
    rows: dict[tuple[str, date, int], list[int]] = field(default_factory=dict)
    rows_raw: int = 0
    totales: dict[str, int] = field(default_factory=dict)
    first_period: date | None = None
    last_period: date | None = None
    missing_months: list[str] = field(default_factory=list)
    pertenencia: dict[int, int] = field(default_factory=dict)        # TIPO_PERTENENCIA → nº de filas
    index_mismatch: int = 0                                          # filas cuyo índice publicado no coincide con la fórmula oficial
    index_max_diff: float = 0.0
    index_checked: int = 0
    disp_zero_rows: int = 0
    dup_keys: list[tuple[str, str, int]] = field(default_factory=list)
    unknown_areas: set[int] = field(default_factory=set)
    non_pertenece: dict[str, tuple[str, int, int]] = field(default_factory=dict)  # código con pertenencia ≠ 1 → (nombre, primer año, último año)

    @property
    def codes(self) -> set[str]:
        return {k[0] for k in self.rows}

    @property
    def period_end(self) -> date | None:
        if self.last_period is None:
            return None
        nxt = date(self.last_period.year + (self.last_period.month == 12), self.last_period.month % 12 + 1, 1)
        return date.fromordinal(nxt.toordinal() - 1)


def _int(v: str, what: str, line: int) -> int:
    try:
        return int(v.strip())
    except (ValueError, AttributeError):
        raise StructureError(f"REM 20, línea {line}: {what} no es un entero ({v!r})") from None


def _float(v: str, what: str, line: int) -> float:
    try:
        return float(v.strip())
    except (ValueError, AttributeError):
        raise StructureError(f"REM 20, línea {line}: {what} no es un número ({v!r})") from None


def read_rem20(raw: bytes) -> Rem20:
    text = raw.decode("utf-8-sig")
    rd = csv.reader(io.StringIO(text), delimiter=";")
    try:
        header = [h.strip() for h in next(rd)]
    except StopIteration:
        raise StructureError("REM 20: el archivo está vacío") from None
    if header != REM20_COLUMNS:
        raise StructureError(f"REM 20: las columnas no son las esperadas. Faltan {sorted(set(REM20_COLUMNS) - set(header))}; sobran {sorted(set(header) - set(REM20_COLUMNS))}; "
                             f"o cambió el orden (se exige el encabezado exacto)")
    ix = {c: i for i, c in enumerate(header)}
    out = Rem20()
    seen_months: set[tuple[int, int]] = set()
    tot = {"dias_cama_ocupados": 0, "dias_cama_disponibles": 0, "dias_estada": 0, "egresos": 0}
    names: dict[str, str] = {}
    for line, r in enumerate(rd, start=2):
        if not r or all(not c.strip() for c in r):
            continue
        if len(r) != len(header):
            raise StructureError(f"REM 20, línea {line}: {len(r)} columnas en vez de {len(header)}")
        year, month = _int(r[ix["PERIODO"]], "PERIODO", line), _int(r[ix["MES"]], "MES", line)
        if not 1 <= month <= 12 or not 2000 <= year <= 2100:
            raise StructureError(f"REM 20, línea {line}: período fuera de rango ({year}-{month})")
        code = r[ix["CODIGO_ESTABLECIMIENTO"]].strip()
        if not re.fullmatch(r"[0-9]{6}", code):
            raise StructureError(f"REM 20, línea {line}: código de establecimiento no es de 6 dígitos ({code!r})")
        area = _int(r[ix["COD_AREA_FUNCIONAL"]], "COD_AREA_FUNCIONAL", line)
        if area not in KNOWN_AREAS:
            out.unknown_areas.add(area)
        pert = _int(r[ix["TIPO_PERTENENCIA"]], "TIPO_PERTENENCIA", line)
        out.pertenencia[pert] = out.pertenencia.get(pert, 0) + 1
        comp = [_int(r[ix[c]], c, line) for c in ("DIAS_CAMAS_OCUPADAS", "DIAS_CAMAS_DISPONIBLES", "DIAS_ESTADA", "NUMERO_EGRESOS", "EGRESOS_FALLECIDOS", "TRASLADOS")]
        if min(comp) < 0:
            raise StructureError(f"REM 20, línea {line}: valor negativo en los componentes ({code} {year}-{month:02d} área {area})")
        idx = _float(r[ix["INDICE_OCUPACIONAL"]], "INDICE_OCUPACIONAL", line)
        occ, disp = comp[0], comp[1]
        if disp > 0:
            diff = abs(idx - 100.0 * occ / disp)
            out.index_checked += 1
            out.index_max_diff = max(out.index_max_diff, diff)
            if diff > INDEX_TOLERANCE:
                out.index_mismatch += 1
        else:
            out.disp_zero_rows += 1
            if idx != 0:
                out.index_mismatch += 1               # con 0 días-cama disponibles el archivo publica 0,00 (se interpreta como «sin denominador», nunca como 0 % real)
        if pert != 1:
            nm, y0, y1 = out.non_pertenece.get(code, (r[ix["ESTABLECIMIENTO"]].strip(), year, year))
            out.non_pertenece[code] = (nm, min(y0, year), max(y1, year))
        names[code] = r[ix["ESTABLECIMIENTO"]].strip()
        out.rows_raw += 1
        for k, v in zip(tot, (comp[0], comp[1], comp[2], comp[3])):
            tot[k] += v
        seen_months.add((year, month))
        key = (code, date(year, month, 1), area)
        cur = out.rows.get(key)
        if cur is None:
            out.rows[key] = [*comp, 1]
        else:
            out.dup_keys.append((code, f"{year}-{month:02d}", area))
            for i, v in enumerate(comp):
                cur[i] += v
            cur[6] += 1
    if not out.rows:
        raise StructureError("REM 20: el archivo no trae filas")
    out.totales = tot
    first, last = min(seen_months), max(seen_months)
    out.first_period, out.last_period = date(first[0], first[1], 1), date(last[0], last[1], 1)
    y, m = first
    while (y, m) <= last:
        if (y, m) not in seen_months:
            out.missing_months.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def reconcile_rem20(d: Rem20, ref_codes: set[str] | None = None) -> dict[str, tuple[bool, str]]:
    """{nombre: (ok, detalle)}; la carga exige que TODOS pasen."""
    r: dict[str, tuple[bool, str]] = {}
    r["encabezado exacto de 20 columnas"] = (True, "")
    r["TIPO_PERTENENCIA ∈ {1, 2} (1 = perteneciente al SNSS)"] = (set(d.pertenencia) <= {1, 2}, f"{dict(sorted(d.pertenencia.items()))}")
    r["todas las áreas funcionales están registradas (health_areas_funcionales)"] = (not d.unknown_areas, f"desconocidas: {sorted(d.unknown_areas)}")
    r["todos los meses entre el primero y el último están presentes"] = (not d.missing_months, f"faltan: {d.missing_months[:6]}")
    r["índice ocupacional publicado = fórmula oficial (ocupados / disponibles × 100) en TODAS las filas"] = (
        d.index_mismatch == 0, f"{d.index_checked:,} filas con disponibles > 0 (desvío máximo {d.index_max_diff:.4f}); {d.disp_zero_rows:,} con disponibles = 0 (índice 0,00 = sin denominador); {d.index_mismatch} no coinciden".replace(",", "."))
    r["Σ de las filas sumadas = Σ de las filas del archivo (sin pérdida al sumar duplicados)"] = (
        sum(v[0] for v in d.rows.values()) == d.totales["dias_cama_ocupados"] and sum(v[1] for v in d.rows.values()) == d.totales["dias_cama_disponibles"]
        and sum(v[6] for v in d.rows.values()) == d.rows_raw, f"{d.rows_raw:,} filas → {len(d.rows):,} claves; {len(d.dup_keys)} duplicadas sumadas".replace(",", "."))
    if ref_codes is not None:
        miss = sorted(d.codes - ref_codes)
        r["todo código empalma con la captura vigente de establecimientos"] = (not miss, f"{len(d.codes) - len(miss)} de {len(d.codes)}; sin empalme: {miss[:10]}")
    return r


# ----------------------------------------------------------------------------------------------- Dotación
@dataclass
class Dotacion:
    rows: dict[tuple[str, int, int], int] = field(default_factory=dict)         # (código, año, área) → camas (área 100 = total publicado)
    total_pais: dict[int, int] = field(default_factory=dict)                    # año → «Total País» del archivo
    years: list[int] = field(default_factory=list)
    text_cells: list[tuple[int, int, str, str]] = field(default_factory=list)    # (fila, año, texto, código): celdas con asteriscos = sin dato
    merged: list[tuple[str, int, int]] = field(default_factory=list)            # (código, año, área) con valor en dos bloques (uno de ellos 0)
    notes: list[str] = field(default_factory=list)                              # notas al pie del archivo, tal cual
    unknown_areas: set[int] = field(default_factory=set)
    blocks: int = 0
    codes_multi_block: set[str] = field(default_factory=set)
    total_vs_areas: list[tuple[str, int, int, int]] = field(default_factory=list)  # (código, año, total publicado, Σ áreas): el total NO siempre es la suma

    @property
    def codes(self) -> set[str]:
        return {k[0] for k in self.rows}


def read_dotacion(path: str | Path) -> Dotacion:
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    hdr_i = next((i for i, r in enumerate(rows) if len(r) > 5 and str(r[1] or "").strip().lower() == "código establecimiento" and str(r[4] or "").strip().lower().startswith("cod. área")), None)
    if hdr_i is None:
        raise StructureError("dotación: no se encontró el encabezado «Código Establecimiento / Cod. Área Funcional»")
    hdr = rows[hdr_i]
    ycols: list[tuple[int, int]] = []
    for j, h in enumerate(hdr):
        m = re.fullmatch(r"(\d{4})\**", str(h).strip()) if h is not None else None
        if m:
            ycols.append((j, int(m.group(1))))
    if not ycols:
        raise StructureError("dotación: el encabezado no trae columnas de año")
    years = [y for _j, y in ycols]
    if years != list(range(years[0], years[0] + len(years))):
        raise StructureError(f"dotación: los años del encabezado no son consecutivos ({years})")
    out = Dotacion(years=years)
    tp = rows[hdr_i + 1] if hdr_i + 1 < len(rows) else []
    if str(tp[5] if len(tp) > 5 else "").strip().lower() != "total país":
        raise StructureError("dotación: la fila siguiente al encabezado debe ser «Total País»")
    for j, y in ycols:
        v = tp[j] if j < len(tp) else None
        if not isinstance(v, (int, float)) or isinstance(v, bool) or v != int(v) or v < 0:
            raise StructureError(f"dotación: «Total País» {y} no es un entero ({v!r})")
        out.total_pais[y] = int(v)

    cur: str | None = None
    seen_blocks: dict[str, int] = {}
    for i in range(hdr_i + 2, len(rows)):
        r = rows[i]
        if len(r) < 6:
            continue
        first = r[0]
        if isinstance(first, str) and first.strip().startswith("*") and r[4] is None:
            out.notes.append(re.sub(r"\s+", " ", first).strip())
            continue
        if r[4] is None:
            continue
        a = r[4]
        if not isinstance(a, (int, float)) or isinstance(a, bool) or a != int(a):
            raise StructureError(f"dotación, fila {i + 1}: código de área no numérico ({a!r})")
        area = int(a)
        if area == TOTAL_AREA:
            c = r[1]
            if not isinstance(c, (int, float)) or isinstance(c, bool) or c != int(c) or not 100000 <= int(c) <= 999999:
                raise StructureError(f"dotación, fila {i + 1}: código de establecimiento no es de 6 dígitos ({c!r})")
            cur = str(int(c))
            out.blocks += 1
            seen_blocks[cur] = seen_blocks.get(cur, 0) + 1
            if seen_blocks[cur] > 1:
                out.codes_multi_block.add(cur)
        elif cur is None:
            raise StructureError(f"dotación, fila {i + 1}: fila de área antes de la primera fila «Total»")
        elif r[1] is not None and str(int(r[1]) if isinstance(r[1], (int, float)) else r[1]).strip() != cur:
            raise StructureError(f"dotación, fila {i + 1}: el código {r[1]!r} cambia dentro de un bloque ({cur})")
        if area != TOTAL_AREA and area not in KNOWN_AREAS:
            out.unknown_areas.add(area)
        for j, y in ycols:
            v = r[j] if j < len(r) else None
            if v is None:
                continue
            if isinstance(v, str):
                out.text_cells.append((i + 1, y, v.strip(), cur or ""))
                continue
            if isinstance(v, bool) or not isinstance(v, (int, float)) or v != int(v) or v < 0:
                raise StructureError(f"dotación, fila {i + 1}, año {y}: valor no entero o negativo ({v!r})")
            key = (cur, y, area)
            n = int(v)
            if key in out.rows:
                if out.rows[key] > 0 and n > 0:
                    raise StructureError(f"dotación, fila {i + 1}: la clave {key} tiene valor > 0 en dos bloques ({out.rows[key]} y {n}); no se suma a ciegas")
                out.merged.append(key)
                out.rows[key] += n
            else:
                out.rows[key] = n
    if not out.rows:
        raise StructureError("dotación: no se leyó ninguna cifra")
    sums: dict[tuple[str, int], int] = {}
    for (c, y, a), n in out.rows.items():
        if a != TOTAL_AREA:
            sums[(c, y)] = sums.get((c, y), 0) + n
    for (c, y, a), n in sorted(out.rows.items()):
        if a == TOTAL_AREA and (c, y) in sums and sums[(c, y)] != n:
            out.total_vs_areas.append((c, y, n, sums[(c, y)]))
    return out


def reconcile_dotacion(d: Dotacion, ref_codes: set[str] | None = None) -> dict[str, tuple[bool, str]]:
    r: dict[str, tuple[bool, str]] = {}
    r["años del encabezado consecutivos"] = (True, f"{d.years[0]}–{d.years[-1]}")
    bad = []
    for y in d.years:
        s = sum(n for (c, yy, a), n in d.rows.items() if yy == y and a == TOTAL_AREA)
        if s != d.total_pais[y]:
            bad.append(f"{y}: Σ totales {s} ≠ «Total País» {d.total_pais[y]}")
    r["Σ de los totales por establecimiento = «Total País» del archivo, en TODOS los años"] = (not bad, "; ".join(bad[:4]) or f"{len(d.years)} años cuadran")
    r["todas las áreas funcionales están registradas (health_areas_funcionales)"] = (not d.unknown_areas, f"desconocidas: {sorted(d.unknown_areas)}")
    if ref_codes is not None:
        miss = sorted(d.codes - ref_codes)
        r["todo código empalma con la captura vigente de establecimientos"] = (not miss, f"{len(d.codes) - len(miss)} de {len(d.codes)}; sin empalme: {miss[:10]}")
    return r


def dotacion_period(d: Dotacion) -> tuple[date, date]:
    ys = sorted({y for (_c, y, _a) in d.rows})
    return date(ys[0], 1, 1), date(ys[-1], 12, 31)


def beds(d: Dotacion, code: str, year: int, area: int = TOTAL_AREA) -> int | None:
    return d.rows.get((code, year, area))


def occupancy(d: Rem20, code: str, start: date, end: date) -> tuple[int, int, int, float | None]:
    """(ocupados, disponibles, meses, índice) del establecimiento entre dos meses (inclusive) con la fórmula oficial Σ ocupados / Σ disponibles × 100; índice None si Σ disponibles = 0."""
    o = dsp = 0
    months: set[date] = set()
    for (c, p, _a), v in d.rows.items():
        if c == code and start <= p <= end:
            o += v[0]
            dsp += v[1]
            months.add(p)
    return o, dsp, len(months), (round(100.0 * o / dsp, 2) if dsp > 0 else None)
