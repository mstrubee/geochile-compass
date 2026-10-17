"""Opcional: contra los DOS archivos COMPLETOS publicados por MINVU el 2026-09-11 (no están en el repo).

  MINVU_ANUAL=/ruta/anual.xlsx MINVU_MENSUAL=/ruta/mensual.xlsx python -m pytest etl/permisos/tests/test_real_files.py
"""
import hashlib
import os

import pytest

from permisos.parse_minvu import Resolver, cross_check, parse, plan_load, stage_rows
from permisos.xlsx_reader import read_workbook

A, M = os.environ.get("MINVU_ANUAL"), os.environ.get("MINVU_MENSUAL")
pytestmark = pytest.mark.skipif(not (A and M), reason="define MINVU_ANUAL y MINVU_MENSUAL")
SHA = {"A": "158af0e4af401a909b6d30dfb4860b1f77c7a608c35c67d42a0bb2503b4705b7",
       "M": "5f9a63ac993ea217aa4495224d54d29713dc5ebb787704fe211b7d575bd94e6c"}


@pytest.fixture(scope="module")
def both(resolver):
    return parse(read_workbook(A)[0], resolver), parse(read_workbook(M)[0], resolver)


def test_son_los_archivos_publicados():
    assert hashlib.sha256(open(A, "rb").read()).hexdigest() == SHA["A"]
    assert hashlib.sha256(open(M, "rb").read()).hexdigest() == SHA["M"]


def test_cuadres_verificados_por_el_usuario(both):
    a, m = both
    for p in both:
        assert p.ok and not p.rejections and len(p.cut_rows) == 346 and len(p.merges) == 21
        assert all(c.ok for c in p.controls)
        assert p.internal_mismatches == [] and p.region_mismatches == []
    assert (len(a.controls), len(m.controls)) == (186, 1770)
    tot = lambda p, y, g: next(c for c in p.controls if c.sheet == "número_total" and c.period.year == y and c.granularity == g)
    assert (tot(a, 2017, "year").computed, tot(a, 2018, "year").computed, tot(a, 2025, "year").computed) == (133914, 150491, 66947)
    assert sum(c.computed for c in m.controls if c.sheet == "número_total" and c.period.year == 2025) == 66947
    months = [c.computed for p in both for c in p.controls if c.sheet == "número_total" and c.period.year == 2026 and c.granularity == "month"]
    assert months == [5981, 5961, 6752, 6298, 5917, 4811, 6482] * 2 and sum(months[:7]) == 42202


def test_anual_igual_a_suma_de_meses_en_las_6_hojas(both):
    x = cross_check(*both)
    assert x["ok"] and x["compared_year_cells"] == 346 * 24 * 6 and x["compared_month_cells"] == 346 * 7 * 6


def test_volumen_a_cargar(both):
    a, m = both
    assert len(list(stage_rows(a, plan_load(a, 2002, 5)))) == 49824          # 346 comunas x 24 años x 6 hojas
    assert len(list(stage_rows(m, plan_load(m, 2002, 5)))) == 124560         # 346 comunas x 60 meses x 6 hojas
