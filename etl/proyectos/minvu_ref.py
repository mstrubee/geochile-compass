"""Cuadre EXTERNO (diagnóstico, no error): unidades de vivienda del INE PE frente a las de MINVU, solo en las comunas que el INE cubre.

Diferencias esperables, que el reporte explica y NO trata como fallo:
  * el INE georreferencia solo parte de las comunas (117-123 de 346 por año) y la cobertura cambia de un año a otro;
  * MIXTO mezcla vivienda con otros usos (se informa HABITACIONAL y HABITACIONAL+MIXTO por separado);
  * MINVU declara que sus cifras de 2025 difieren de las del INE (nota del archivo) y son preliminares;
  * el INE cambió la agrupación de registros entre 2019 y 2020 (las unidades siguen al total nacional; los registros no).
"""
from __future__ import annotations

from collections import defaultdict


def from_xlsx(path: str, comunas: list[dict]) -> dict[tuple[str, int], int]:
    """(cut, año) -> viviendas, hoja 'número_total' del archivo ANUAL de MINVU (solo columnas anuales)."""
    from permisos import seed as seedmod
    from permisos.parse_minvu import Resolver, parse, plan_load, stage_rows
    from permisos.xlsx_reader import read_workbook
    sheets, _ = read_workbook(path)
    parsed = parse(sheets, Resolver(comunas, seedmod.read_aliases()))
    if parsed.kind != "annual":
        raise ValueError("--minvu-file debe ser el archivo ANUAL de MINVU")
    plan = plan_load(parsed, 2002, 5)
    return {(cut, period.year): value for sheet, cut, period, value, _prov in stage_rows(parsed, plan) if sheet == "número_total"}


def from_db(conn) -> dict[tuple[str, int], int]:
    with conn.cursor() as cur:
        cur.execute("""select b.comuna_cut, extract(year from b.period)::int, b.value
                         from public.building_permit_statistics b join public.permit_series s on s.id = b.series_id
                         join public.data_sources d on d.id = s.source_id
                        where d.source_key = 'minvu_cedoc_permisos_anual' and s.metric = 'units'
                          and s.destination_class = 'housing_total' and s.granularity = 'year' and b.to_snapshot is null""")
        return {(r[0], r[1]): r[2] for r in cur.fetchall()}


def compare(pe_rows: list[tuple], minvu: dict[tuple[str, int], int]) -> list[dict]:
    """pe_rows: (src_oid, cut, year, units, floors, uso, precision, ...). Devuelve una fila por año."""
    hm, h, covered = defaultdict(int), defaultdict(int), defaultdict(set)
    for r in pe_rows:
        cut, year, units, uso = r[1], r[2], r[3], r[5]
        covered[year].add(cut)
        if uso in (1, 2):
            hm[year] += units
        if uso == 1:
            h[year] += units
    out = []
    for y in sorted(covered):
        same = sum(minvu.get((c, y), 0) for c in covered[y])
        nat = sum(v for (c, yy), v in minvu.items() if yy == y)
        out.append({"year": y, "comunas_covered": len(covered[y]), "ine_housing_only": h[y], "ine_housing_plus_mixed": hm[y],
                    "minvu_same_comunas": same, "ratio": round(hm[y] / same, 3) if same else None,
                    "minvu_national": nat, "ine_over_national": round(hm[y] / nat, 3) if nat else None})
    return out
