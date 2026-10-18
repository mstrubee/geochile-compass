"""Lector y cuadres del tabulado D1 del Censo 2024 (INE): «Población censada por sexo y edad en grupos quinquenales».

Hojas usadas (por TEXTO de encabezado, no por posición):
  «1»  población censada por región (código región, hombres, mujeres) → cuadre regional
  «2»  población censada por comuna (código comuna = CUT sin el cero inicial) → tabla publicada `poblacion_comunal`
  «4»  comuna × grupo de edad quinquenal × sexo → tabla publicada `poblacion_comunal_edad`
  «Nota» fecha de publicación y definiciones («Población censada: cantidad total de residentes habituales censados»)
La hoja «3» (región × edad) no se carga. Nada se corrige ni se estima: lo que no cuadra detiene la carga.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

SOURCE_KEY = "ine_censo2024_poblacion_comunal"
DATASET = "poblacion_censo2024"
DATA_URL = "https://censo2024.ine.gob.cl/wp-content/uploads/2025/03/D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx"
LANDING_URL = "https://censo2024.ine.gob.cl/"
LICENSE_LABEL = "Creative Commons Reconocimiento-CompartirIgual 4.0 Internacional (CC BY-SA 4.0)"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/deed.es_ES"
TERMS_URL = "https://www.ine.gob.cl/terminos-de-uso-y-licencia-de-datos-abiertos"
GRUPOS = [f"{a} a {a + 4}" for a in range(0, 85, 5)] + ["85 o más"]            # 18 grupos quinquenales (la hoja 4 trae además «Total Comuna» / «Total País»)
N_COMUNAS = 346
MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}


class StructureError(Exception):
    """El libro no tiene la estructura esperada (hojas, encabezados o tipos): no se carga nada."""


@dataclass
class Trio:
    total: int
    hombres: int
    mujeres: int


@dataclass
class Comuna:
    cut: str
    name: str
    region_cut: str
    province_cut: str
    trio: Trio


@dataclass
class Censo:
    published: date | None = None                           # «Fecha de publicación» de la hoja Nota
    updated_note: str | None = None                         # «Nota 2: La tabla fue actualizada el 04-12-2025 …»
    definition: str | None = None                           # definición oficial de «Población censada»
    pais: Trio | None = None                                # hoja 2, fila «País»
    pais_h1: Trio | None = None                             # hoja 1, fila «País»
    regiones: dict[str, tuple[str, Trio]] = field(default_factory=dict)      # hoja 1: región (2 dígitos) → (nombre, trío)
    comunas: dict[str, Comuna] = field(default_factory=dict)                 # hoja 2
    edades: dict[tuple[str, str], Trio] = field(default_factory=dict)        # hoja 4: (CUT, grupo) → trío
    total_h4: dict[str, Trio] = field(default_factory=dict)                  # hoja 4: fila «Total Comuna»
    pais_edades: dict[str, Trio] = field(default_factory=dict)               # hoja 4: filas del «País» por grupo
    pais_total_h4: Trio | None = None
    sheets: list[str] = field(default_factory=list)


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def _int(v) -> int | None:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v if isinstance(v, int) else None


def _cut(code) -> str | None:
    n = _int(code)
    return f"{n:05d}" if n is not None and 1000 <= n <= 99999 else None


def _trio(t, h, m) -> Trio | None:
    t, h, m = _int(t), _int(h), _int(m)
    return Trio(t, h, m) if None not in (t, h, m) and min(t, h, m) >= 0 else None


def _header(rows: list[list], first: str, name: str) -> tuple[int, dict[str, int]]:
    for i, r in enumerate(rows):
        if _norm(r[0] if r else None) == first:
            return i, {_norm(x): j for j, x in enumerate(r) if x}
    raise StructureError(f"la hoja «{name}» no tiene el encabezado «{first}»")


def read_workbook(path: str | Path) -> Censo:
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = Censo(sheets=list(wb.sheetnames))
    for need in ("Nota", "1", "2", "4"):
        if need not in wb.sheetnames:
            raise StructureError(f"falta la hoja «{need}» (hojas: {wb.sheetnames})")
    rows = {n: [list(r) for r in wb[n].iter_rows(values_only=True)] for n in ("Nota", "1", "2", "4")}

    for r in rows["Nota"]:
        for x in r:
            if not isinstance(x, str):
                continue
            m = re.search(r"fecha de publicaci[oó]n:\s*(\d{1,2}) de ([a-záéíóú]+),? (\d{4})", x, re.I)
            if m and m.group(2).lower() in MESES:
                out.published = date(int(m.group(3)), MESES[m.group(2).lower()], int(m.group(1)))
            if "Nota 2" in x:
                out.updated_note = re.sub(r"\s+", " ", x[x.index("Nota 2"):]).strip()
        if len(r) > 3 and _norm(r[1]) == "población censada" and r[3]:
            out.definition = re.sub(r"\s+", " ", str(r[3])).strip()

    for n in ("2", "4"):                                     # «Nota 2: la tabla fue actualizada el …» va al pie de las hojas de comuna
        for r in rows[n]:
            for x in r:
                if isinstance(x, str) and "Nota 2" in x and out.updated_note is None:
                    out.updated_note = re.sub(r"\s+", " ", x[x.index("Nota 2"):]).strip()

    # hoja 1: región
    i, h = _header(rows["1"], "código región", "1")
    c_reg, c_t, c_h, c_m = h["código región"], h["población censada"], h["hombres"], h["mujeres"]
    for r in rows["1"][i + 1:]:
        code, t = _int(r[c_reg]) if len(r) > c_reg else None, _trio(r[c_t], r[c_h], r[c_m]) if len(r) > max(c_t, c_h, c_m) else None
        if code is None or t is None:
            continue
        if code == 0:
            out.pais_h1 = t
        else:
            out.regiones[f"{code:02d}"] = (str(r[h["región"]]).strip(), t)

    # hoja 2: comuna
    i, h = _header(rows["2"], "código región", "2")
    c_reg, c_prov, c_com, c_nom = h["código región"], h["código provincia"], h["código comuna"], h["comuna"]
    c_t, c_h, c_m = h["población censada"], h["hombres"], h["mujeres"]
    for r in rows["2"][i + 1:]:
        if len(r) <= max(c_t, c_h, c_m):
            continue
        t = _trio(r[c_t], r[c_h], r[c_m])
        if t is None:
            continue
        if _int(r[c_com]) == 0:
            out.pais = t
            continue
        cut = _cut(r[c_com])
        if cut is None:
            raise StructureError(f"hoja 2: código de comuna no válido {r[c_com]!r}")
        if cut in out.comunas:
            raise StructureError(f"hoja 2: comuna repetida {cut}")
        reg, prov = _int(r[c_reg]), _int(r[c_prov])
        out.comunas[cut] = Comuna(cut, str(r[c_nom]).strip(), f"{reg:02d}", f"{prov:03d}", t)

    # hoja 4: comuna × grupo de edad
    i, h = _header(rows["4"], "código región", "4")
    c_com, c_gr = h["código comuna"], h["grupos de edad"]
    c_t, c_h, c_m = h["población censada"], h["hombres"], h["mujeres"]
    for r in rows["4"][i + 1:]:
        if len(r) <= max(c_t, c_h, c_m, c_gr):
            continue
        t = _trio(r[c_t], r[c_h], r[c_m])
        g = str(r[c_gr]).strip() if r[c_gr] is not None else ""
        if t is None or not g:
            continue
        if _int(r[c_com]) == 0:
            if g == "Total País":
                out.pais_total_h4 = t
            else:
                out.pais_edades[g] = t
            continue
        cut = _cut(r[c_com])
        if cut is None:
            raise StructureError(f"hoja 4: código de comuna no válido {r[c_com]!r}")
        if g == "Total Comuna":
            out.total_h4[cut] = t
        elif g in GRUPOS:
            if (cut, g) in out.edades:
                raise StructureError(f"hoja 4: fila repetida {cut} / {g}")
            out.edades[(cut, g)] = t
        else:
            raise StructureError(f"hoja 4: grupo de edad no esperado {g!r}")
    if not out.comunas or not out.regiones or out.pais is None:
        raise StructureError("no se leyó el país, las regiones o las comunas")
    return out


def reconcile(c: Censo, ref_cuts: set[str], geo_cuts: set[str] | None = None, ref_names: dict[str, str] | None = None, expect_comunas: int = N_COMUNAS) -> dict[str, tuple[bool, str]]:
    """Cuadres, todos sobre los datos tal como vienen. Devuelve {nombre: (ok, detalle)}; la carga exige que TODOS pasen (los marcados «informativo» no)."""
    r: dict[str, tuple[bool, str]] = {}
    n = len(c.comunas)
    r["comunas leídas = 346 (hoja 2)"] = (n == expect_comunas, f"{n}")
    s_tot = sum(x.trio.total for x in c.comunas.values())
    s_h, s_m = sum(x.trio.hombres for x in c.comunas.values()), sum(x.trio.mujeres for x in c.comunas.values())
    r["Σ comunas = total país de la hoja 2"] = (s_tot == c.pais.total and s_h == c.pais.hombres and s_m == c.pais.mujeres,
                                              f"Σ={s_tot:,} · país={c.pais.total:,}".replace(",", "."))
    r["total país de la hoja 2 = hoja 1"] = (c.pais_h1 is not None and c.pais_h1 == c.pais, f"{c.pais.total:,} vs {c.pais_h1.total if c.pais_h1 else None}".replace(",", "."))
    bad = [x.cut for x in c.comunas.values() if x.trio.hombres + x.trio.mujeres != x.trio.total]
    r["hombres + mujeres = total en cada comuna"] = (not bad and c.pais.hombres + c.pais.mujeres == c.pais.total, f"{len(bad)} comunas no cuadran {bad[:5]}")
    by_reg: dict[str, list[int]] = {}
    for x in c.comunas.values():
        a = by_reg.setdefault(x.region_cut, [0, 0, 0])
        a[0] += x.trio.total
        a[1] += x.trio.hombres
        a[2] += x.trio.mujeres
    bad_reg = [k for k, (_nm, t) in c.regiones.items() if by_reg.get(k) != [t.total, t.hombres, t.mujeres]]
    r["Σ comunas de cada región = total regional de la hoja 1"] = (not bad_reg and set(by_reg) == set(c.regiones) and len(c.regiones) == 16,
                                                                 f"{len(c.regiones)} regiones; no cuadran: {bad_reg}")
    r["Σ regiones = total país (hoja 1)"] = (c.pais_h1 is not None and sum(t.total for _n, t in c.regiones.values()) == c.pais_h1.total, "")
    missing = [(cut, g) for cut in c.comunas for g in GRUPOS if (cut, g) not in c.edades]
    r["hoja 4 trae los 18 grupos de edad de cada comuna"] = (not missing and len(c.edades) == n * len(GRUPOS), f"{len(c.edades)} filas = {n} × {len(GRUPOS)}; faltan {len(missing)}")
    bad_age = []
    for cut, x in c.comunas.items():
        sums = [sum(getattr(c.edades[(cut, g)], k) for g in GRUPOS if (cut, g) in c.edades) for k in ("total", "hombres", "mujeres")]
        if sums != [x.trio.total, x.trio.hombres, x.trio.mujeres]:
            bad_age.append(cut)
    r["Σ edades de la hoja 4 = total, hombres y mujeres de la hoja 2, por comuna"] = (not bad_age and not missing, f"{len(bad_age)} comunas no cuadran {bad_age[:5]}")
    bad_tc = [cut for cut, x in c.comunas.items() if c.total_h4.get(cut) != x.trio]
    r["fila «Total Comuna» de la hoja 4 = hoja 2"] = (not bad_tc, f"{len(bad_tc)} comunas no cuadran {bad_tc[:5]}")
    bad_e = [g for g in GRUPOS if c.pais_edades.get(g) != Trio(*(sum(getattr(c.edades[(cut, g)], k) for cut in c.comunas if (cut, g) in c.edades) for k in ("total", "hombres", "mujeres")))]
    r["Σ comunas por grupo de edad = filas del país de la hoja 4"] = (not bad_e and c.pais_total_h4 == c.pais, f"grupos que no cuadran: {bad_e}")
    r["códigos = public/codigos_territoriales.csv (346/346, 1:1)"] = (set(c.comunas) == ref_cuts and len(ref_cuts) == expect_comunas,
                                                                  f"solo en el Censo {sorted(set(c.comunas) - ref_cuts)[:5]} · solo en el CSV {sorted(ref_cuts - set(c.comunas))[:5]}")
    if geo_cuts is not None:
        miss = sorted(set(c.comunas) - geo_cuts)
        extra = sorted(geo_cuts - set(c.comunas))
        r["códigos ⊇ public/comunas.geojson (todo polígono tiene población; informativo: comunas sin polígono)"] = (not extra, f"{len(geo_cuts)} polígonos; sin polígono: {miss}; polígonos sin población: {extra}")
    return r


def name_differences(c: Censo, ref_names: dict[str, str]) -> list[tuple[str, str, str]]:
    """Comunas cuyo NOMBRE difiere entre el Censo y la referencia (informativo: la clave es el CUT)."""
    def n(s):
        import unicodedata
        return re.sub(r"[^a-z0-9]+", " ", "".join(ch for ch in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(ch))).strip()
    return [(cut, x.name, ref_names[cut]) for cut, x in sorted(c.comunas.items()) if cut in ref_names and n(x.name) != n(ref_names[cut])]
