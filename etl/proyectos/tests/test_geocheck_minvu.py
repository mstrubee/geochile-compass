import pytest

from conftest import features
from proyectos import geocheck, ine, minvu_ref

shapely = pytest.importorskip("shapely")


def test_real_clip_points_fall_inside_their_comuna(valid_cuts):
    polys = geocheck.load_comuna_polygons()
    r = ine.transform_pe(features("ine_pe"), valid_cuts)
    g = geocheck.check_points([(row[1], row[9], row[10]) for row in r.rows], polys)
    assert g["inside"] == len(r.rows) and not g.get("outside_declared") and not g.get("near_border_approx")


def test_synthetic_points_outside_and_without_polygon(valid_cuts):
    polys = geocheck.load_comuna_polygons()
    ok = next(c for c in polys if c.startswith("13"))
    # SINTÉTICO: un punto lejos (Europa), uno en el mar frente a la comuna y una comuna sin polígono (12202 Antártica)
    g = geocheck.check_points([(ok, 10.0, 50.0), ("12202", -60.0, -70.0)], polys)
    assert g["outside_declared"] == 1 and g["comuna_without_polygon"] == 1 and g["examples_outside"][0]["cut"] == ok


def test_minvu_compare_only_covered_comunas():
    pe = [(1, "13101", 2019, 10, 3, 1, 3, "g", 1.0, -70, -33), (2, "13101", 2019, 5, 3, 2, 3, "g", 1.0, -70, -33),
          (3, "13101", 2019, 7, 3, 3, 3, "g", 1.0, -70, -33), (4, "05101", 2020, 4, 3, 1, 3, "g", 1.0, -71, -33)]
    minvu = {("13101", 2019): 30, ("13114", 2019): 100, ("05101", 2020): 8, ("08101", 2020): 50}
    c = {x["year"]: x for x in minvu_ref.compare(pe, minvu)}
    assert c[2019]["ine_housing_only"] == 10 and c[2019]["ine_housing_plus_mixed"] == 15, "NO HABITACIONAL no suma como vivienda"
    assert c[2019]["minvu_same_comunas"] == 30 and c[2019]["ratio"] == 0.5, "solo la comuna cubierta (13101), no las 346"
    assert c[2019]["minvu_national"] == 130 and c[2020]["minvu_same_comunas"] == 8 and c[2020]["minvu_national"] == 58
