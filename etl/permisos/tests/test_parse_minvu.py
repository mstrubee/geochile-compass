"""Tests del parser sobre FIXTURES REALES recortados (ver fixtures/README.md). Ningún dato es sintético."""
import copy
from datetime import date

import pytest

from permisos.parse_minvu import (LayoutError, Resolver, cross_check, months_back, parse, plan_load, sheet_series, stage_rows)
from permisos.xlsx_reader import read_workbook
from conftest import ANUAL, MENSUAL, col_of

TOTAL = "número_total"


# ------------------------------------------------------------------ estructura
def test_detecta_tipo_y_estructura(annual, monthly):
    assert annual.kind == "annual" and monthly.kind == "monthly"
    s = annual.sheets[TOTAL]
    assert (s.header_row, s.total_row) == (6, 8)
    assert sum(c.month is None for c in annual.cols) == 6 and sum(c.month is not None for c in annual.cols) == 7
    assert len(monthly.cols) == 12 * 4 + 7 and all(c.month is not None for c in monthly.cols)
    assert annual.period_end == date(2026, 7, 31) and monthly.period_end == date(2026, 7, 31)
    assert sorted(annual.sheets) == sorted(["número_total", "m2_total", "número_departamentos", "m2_departamentos", "número_casas", "m2_casas"])


def test_se_detiene_en_las_notas_y_no_confia_en_max_row(monthly):
    # el fixture mensual declara 65.536 filas (como m2_casas del original): igual solo hay 367 filas de comuna
    assert len(monthly.sheets["m2_casas"].rows) == 367
    assert [n.marker for n in monthly.sheets["m2_casas"].notes][:2] == ["Notas: (*)", "(**)"]
    # 'Notas' nunca se interpreta como comuna
    assert all("notas" not in r.comuna_label.lower() for r in monthly.sheets[TOTAL].rows)


def test_series_por_hoja():
    assert sheet_series("número_casas") == ("units", "casas")
    assert sheet_series("m2_departamentos") == ("area_m2", "departamentos")
    with pytest.raises(LayoutError):
        sheet_series("hoja_rara")


# ------------------------------------------------------------------ calidad
def test_calidad_sale_del_texto_de_la_nota_no_del_simbolo(annual, monthly):
    assert annual.header_marks == {2018: "(***)", 2024: "(*)", 2025: "(*)"}      # el anual rotula 2025 con (*)
    assert monthly.header_marks == {2018: "(***)", 2024: "(*)", 2025: "(**)"}    # el mensual con (**)
    for p in (annual, monthly):
        assert p.definitive_until == 2024
        assert not p.is_provisional(2024) and p.is_provisional(2025) and p.is_provisional(2026)
        assert p.provisional_note.startswith("Las cifras del año 2025 difieren de la información publicada por el INE")
        assert any("Ñuble".lower() in n["text"].lower() or "ÑUBLE" in n["text"] for n in p.notes)


# ------------------------------------------------------------------ comunas / CUT
def test_367_filas_son_346_comunas(annual, monthly):
    for p in (annual, monthly):
        assert len(p.sheets[TOTAL].rows) == 367
        assert len(p.cut_rows) == 346
        assert len(p.merges) == 21
        assert p.errors == [] and p.rejections == []
        assert all(len(c) == 5 and c.isdigit() for c in p.cut_rows)        # CUT texto de 5 dígitos


def test_alias_explicitos_exactos(annual):
    got = {(a["name"], a["cut"]) for a in annual.aliases_used}
    assert got == {("Coyhaique", "11101"), ("Aysén", "11201"), ("O’Higgins", "11302"), ("Cabo de Hornos (Ex - Navarino)", "12201")}
    assert all(a["reason"] for a in annual.aliases_used)
    assert "12202" in annual.cut_rows                                        # Antártica: existe y se cruza por nombre


def test_sin_match_detiene_la_carga_sin_fuzzy(comunas, aliases):
    sheets = read_workbook(str(ANUAL))[0]
    sheets["número_total"].rows[0].comuna_label = "Arika"                     # error de tipeo: NO se adivina
    for n in list(sheets)[1:]:
        sheets[n].rows[0].comuna_label = "Arika"
    p = parse(sheets, Resolver(comunas, aliases))
    assert not p.ok and any("Arika" in e for e in p.errors)
    assert any(r.code == "comuna_unmatched" for r in p.rejections)


def test_sin_el_alias_las_4_comunas_distintas_quedan_sin_match(comunas):
    p = parse(read_workbook(str(ANUAL))[0], Resolver(comunas, []))
    msgs = " ".join(p.errors)
    for name in ("Coyhaique", "Aysén", "O’Higgins", "Cabo de Hornos (Ex - Navarino)"):
        assert name in msgs
    assert not p.ok


def test_normaliza_tildes_mayusculas_y_espacios(comunas, aliases):
    sheets = read_workbook(str(ANUAL))[0]
    row0 = sheets[TOTAL].rows[0]
    for n in sheets:
        sheets[n].rows[0].comuna_label = "  ARICA  "
    assert parse(sheets, Resolver(comunas, aliases)).errors == []


def test_alias_hacia_otra_region_se_rechaza(comunas):
    bad = [{"region_label": "Aysén", "name": "Coyhaique", "cut": "13101", "reason": "mal"}]
    p = parse(read_workbook(str(ANUAL))[0], Resolver(comunas, bad))
    assert any("Coyhaique" in e and "13101" in e for e in p.errors)


# ------------------------------------------------------------------ Ñuble
def test_nuble_se_fusiona_por_periodo_y_no_se_suma(annual):
    c = {k: col_of(annual, k) for k in ("2002-01-01:year", "2017-01-01:year", "2018-01-01:year", "2025-01-01:year")}
    v = lambda k: annual.values[(TOTAL, "16101", c[k])]             # Chillán
    assert v("2002-01-01:year") == 899 and v("2017-01-01:year") == 1473      # fila "Ñuble (ex-Biobío)"
    assert v("2018-01-01:year") == 1850 and v("2025-01-01:year") == 769      # fila "Ñuble"
    m = next(m for m in annual.merges if m["cut"] == "16101")
    assert m["split"] == "2018-01-01" and m["row_before"] != m["row_from"]


def test_layout_cita_la_fila_que_aplica(annual):
    lay = annual.layout
    assert lay["rows"]["13101"] == [next(r.row for r in annual.cut_rows["13101"])]
    split = lay["rows"]["16101"]
    assert split["split"] == "2018-01-01" and split["before"] > split["from"] - 1000 and split["before"] != split["from"]
    assert lay["cols"]["2018-01-01:year"] == col_of(annual, "2018-01-01:year")
    assert lay["header_row"] == 6 and lay["total_row"] == 8


def test_cero_estructural_distinto_de_cero_es_conflicto(comunas, aliases):
    sheets = read_workbook(str(ANUAL))[0]
    p0 = parse(read_workbook(str(ANUAL))[0], Resolver(comunas, aliases))
    split = p0.layout["rows"]["16101"]
    col = col_of(p0, "2018-01-01:year")                                      # periodo >= 2018: la fila que NO aplica es ex-Biobío
    sheets[TOTAL].rows[[r.row for r in sheets[TOTAL].rows].index(split["before"])].values[col] = 5
    p = parse(sheets, Resolver(comunas, aliases))
    assert any(r.code == "duplicate_key" for r in p.rejections)
    assert (TOTAL, "16101", col) not in p.values                            # no se suma ni se elige: se rechaza


def test_duplicado_que_no_es_nuble_detiene(comunas, aliases):
    sheets = read_workbook(str(ANUAL))[0]
    for n in sheets:
        sheets[n].rows[1].comuna_label = sheets[n].rows[0].comuna_label     # Arica dos veces
        sheets[n].rows[1].region_label = sheets[n].rows[0].region_label
    p = parse(sheets, Resolver(comunas, aliases))
    assert any("solo se fusiona Ñuble" in e for e in p.errors)


# ------------------------------------------------------------------ cuadres (las cifras que verificó el usuario)
def _tot(p, sheet, year, gran):
    return [(c.declared, c.computed) for c in p.controls if c.sheet == sheet and c.period.year == year and c.granularity == gran]


def test_cuadre_con_total_pais_cifras_verificadas(annual, monthly):
    assert all(c.ok for c in annual.controls) and all(c.ok for c in monthly.controls)
    assert len(annual.controls) == 6 * 13 and len(monthly.controls) == 6 * 55
    for y, expected in ((2017, 133914), (2018, 150491), (2025, 66947)):
        assert _tot(annual, TOTAL, y, "year") == [(expected, expected)]
    assert sum(c.computed for c in monthly.controls if c.sheet == TOTAL and c.period.year == 2025) == 66947     # 2025 mensual sumado = anual
    for p in (annual, monthly):
        months = [c.computed for c in p.controls if c.sheet == TOTAL and c.period.year == 2026 and c.granularity == "month"]
        assert months == [5981, 5961, 6752, 6298, 5917, 4811, 6482] and sum(months) == 42202


def test_cuadre_detecta_un_total_alterado(comunas, aliases):
    sheets = read_workbook(str(ANUAL))[0]
    col = col_of(parse(read_workbook(str(ANUAL))[0], Resolver(comunas, aliases)), "2018-01-01:year")
    sheets[TOTAL].total_values[col] = 150492
    p = parse(sheets, Resolver(comunas, aliases))
    bad = [c for c in p.controls if not c.ok]
    assert len(bad) == 1 and bad[0].declared == 150492 and bad[0].computed == 150491 and not p.ok


def test_coherencia_total_igual_casas_mas_departamentos(annual, monthly):
    assert annual.internal_mismatches == [] and monthly.internal_mismatches == []
    assert annual.region_mismatches == [] and monthly.region_mismatches == []


def test_cruce_anual_vs_mensual(annual, monthly):
    x = cross_check(annual, monthly)
    assert x["ok"] and x["mismatches"] == []
    assert x["compared_month_cells"] == 346 * 7 * 6 and x["compared_year_cells"] == 346 * 4 * 6     # 2017, 2018, 2024 y 2025 tienen sus 12 meses en ambos fixtures
    bad = copy.copy(monthly)
    bad.values = dict(monthly.values)
    k = next(iter(monthly.values))
    bad.values[k] += 1
    assert not cross_check(annual, bad)["ok"]


# ------------------------------------------------------------------ celdas inválidas
@pytest.mark.parametrize("raw, code", [(-3, "negative_value"), ("n/d", "non_numeric"), (None, "non_numeric"), (2.5, "non_numeric")])
def test_celdas_invalidas_se_rechazan_con_motivo(comunas, aliases, raw, code):
    sheets = read_workbook(str(ANUAL))[0]
    p0 = parse(read_workbook(str(ANUAL))[0], Resolver(comunas, aliases))
    col, row = col_of(p0, "2025-01-01:year"), p0.cut_rows["13101"][0].row
    next(r for r in sheets[TOTAL].rows if r.row == row).values[col] = raw
    p = parse(sheets, Resolver(comunas, aliases))
    assert [r.code for r in p.rejections] == [code]
    assert (TOTAL, "13101", col) not in p.values        # un faltante NO se convierte en 0
    assert not p.ok                                      # y además el cuadre con Total País deja de cumplirse (salvo que el valor ausente sea 0)


def test_estructura_distinta_entre_hojas_se_rechaza(comunas, aliases):
    sheets = read_workbook(str(ANUAL))[0]
    sheets["m2_casas"].cols = sheets["m2_casas"].cols[:-1]
    with pytest.raises(LayoutError) as e:
        parse(sheets, Resolver(comunas, aliases))
    assert e.value.code == "layout_mismatch"


def test_sin_notas_no_se_puede_determinar_la_calidad(comunas, aliases):
    sheets = read_workbook(str(ANUAL))[0]
    for s in sheets.values():
        s.notes = [n for n in s.notes if "definitivos" not in n.text]
    p = parse(sheets, Resolver(comunas, aliases))
    assert not p.ok and any("definitivos" in e for e in p.errors)


def test_hojas_inesperadas(tmp_path):
    import openpyxl
    wb = openpyxl.Workbook(); wb.active.title = "otra"; f = tmp_path / "x.xlsx"; wb.save(f)
    with pytest.raises(LayoutError):
        read_workbook(str(f))


# ------------------------------------------------------------------ qué se carga
def test_plan_anual_solo_anios_y_meses_como_control(annual):
    plan = plan_load(annual, 2002, 5)
    assert plan.granularity == "year" and len(plan.columns) == 6 and plan.not_stored == [f"2026-{m:02d}-01:month" for m in range(1, 8)]
    rows = list(stage_rows(annual, plan))
    assert len(rows) == 346 * 6 * 6 and len({(r[0], r[1], r[2]) for r in rows}) == len(rows)       # sin duplicados
    assert {r[2].year for r in rows} == {2002, 2003, 2017, 2018, 2024, 2025}
    prov = {r[2].year: r[4] for r in rows}
    assert prov[2024] is False and prov[2025] is True


def test_plan_anual_respeta_el_primer_anio(annual):
    assert {c.year for c in plan_load(annual, 2018, 5).columns} == {2018, 2024, 2025}


def test_plan_mensual_ultimos_5_anios(monthly):
    assert months_back(date(2026, 7, 1), 59) == date(2021, 8, 1)
    plan = plan_load(monthly, 2002, 5)
    assert plan.granularity == "month" and plan.load_from == date(2021, 8, 1)
    assert all(c.period >= date(2021, 8, 1) for c in plan.columns) and len(plan.columns) == 31      # 2024 (12) + 2025 (12) + 2026 (7); 2017 y 2018 quedan fuera de la ventana
    assert len(list(stage_rows(monthly, plan))) == 346 * 31 * 6
    assert len(plan_load(monthly, 2002, 1).columns) == 12                                            # ventana de 1 año: ago-2025..jul-2026 (en el fixture: ago..dic 2025 = 5, + 7 de 2026)
