import json
from pathlib import Path

from conftest import features
from proyectos import seia
from proyectos.common import load_json

RULES = {k: v for k, v in load_json(Path(__file__).resolve().parents[1] / "seia_typology_rules.json").items() if not k.startswith("_")}


def resolver(comunas):
    return seia.ComunaResolver(comunas, [])


def test_real_clip_filters_by_letter_and_accounts_for_every_row(comunas):
    for key, layer, n in (("seia_eia", 1, 130), ("seia_dia", 2, 140)):
        r = seia.transform_seia(features(key), layer, RULES, resolver(comunas))
        s = r.stats
        assert s["accepted"] + s["rejected"] + s["typology_excluded_count"] == n, "cargados + rechazados + excluidos = descargados"
        assert s["accepted"] > 0 and s["typology_excluded_count"] > 0
        assert all(row[5] in RULES and RULES[row[5]]["include"] for row in r.rows)


def test_h2_to_h6_and_mining_are_excluded(comunas):
    r = seia.transform_seia(features("seia_eia"), 1, RULES, resolver(comunas))
    ex = r.stats["typology_excluded_by_letter"]
    assert "i.4" in ex and "c." in ex                        # minería y energía, reales en el recorte
    assert not any(k.startswith("h.") and k != "h.1" for k in [row[5] for row in r.rows])


def test_praderas_la_dehesa_real_case(comunas):
    r = seia.transform_seia(features("seia_dia"), 2, RULES, resolver(comunas))
    row = next(x for x in r.rows if x[1] == 2147600353)
    assert row[1] > 2**31 - 1, "ID_EXPEDIENTE real mayor que 2^31-1 (bigint)"
    assert row[3] == "Praderas La Dehesa" and row[8] == "Lo Barnechea" and row[9] == ["13115"]
    assert row[12] == "2020-08-10" and row[13] == "2021-03-08", "fechas en UTC, sin correr un día"
    assert row[19] == -70.72022699999997 and row[20] == -33.80201299999993, "el punto del servicio se conserva tal cual"
    assert (row[16], row[17]) == (-71.0, -33.0), "X/Y crudos se guardan aparte (redondeados a grados enteros)"
    assert r.stats["raw_XY_whole_degrees"] > 0


def test_service_geometry_matches_new_xy_with_a_known_real_exception(comunas):
    """Hallazgo REAL: el punto del servicio = (NUEVO_X, NUEVO_Y) cuando existen (257 de 258 en los recortes); si NUEVO es nulo, = (X, Y)."""
    total_diff, total_null, total_null_raw = 0, 0, 0
    for key, layer in (("seia_eia", 1), ("seia_dia", 2)):
        r = seia.transform_seia(features(key), layer, RULES, resolver(comunas))
        total_diff += r.stats["geometry_differs_from_NUEVO_XY"]
        total_null += r.stats["NUEVO_XY_null"]
        total_null_raw += r.stats["geometry_is_raw_XY_when_NUEVO_null"]
    assert total_diff == 1, "la excepción real es 'Condominio Parque Rio Cruces II' (~90 m de diferencia); el ETL la cuenta, no la corrige"
    assert total_null > 0 and total_null == total_null_raw, "sin NUEVO el punto es el X/Y crudo"


def test_comuna_resolver_never_guesses(comunas):
    rs = resolver(comunas)
    assert rs.many("Lo Barnechea") == (["13115"], [])
    assert rs.many("lo  BARNECHEA")[0] == ["13115"]
    assert rs.many("Peñalolén")[0] == ["13122"]
    assert rs.many("Comuna Inventada") == ([], ["Comuna Inventada"])
    assert rs.many("Lo Barnechea, Las Condes")[0] == sorted(["13115", "13114"])
    assert rs.many("Lo Barnechea y Comuna Inventada") == ([], ["Comuna Inventada"]), "si una parte no cruza, NO se adivina el resto"
    assert rs.many("") == ([], []) and rs.many(None) == ([], [])


def test_alias_resolves_explicitly(comunas):
    rs = seia.ComunaResolver(comunas, [{"name": "Til Til", "cut": "13303"}])
    assert rs.many("til til") == (["13303"], [])


def test_unmatched_comuna_is_loaded_not_dropped(comunas):
    f = features("seia_dia")
    p = next(x for x in f if x["properties"]["LETRA_TIPOLOGIA"] == "h.1")
    p["properties"]["COMUNAS"] = "Comuna Inventada"
    r = seia.transform_seia([p], 2, RULES, resolver(comunas))
    assert len(r.rows) == 1 and r.rows[0][9] == [] and r.stats["comuna_unmatched_projects"] == 1
    assert r.stats["comuna_unmatched_names"] == {"Comuna Inventada": 1}


def test_rejections(comunas):
    f = [x for x in features("seia_dia") if x["properties"]["LETRA_TIPOLOGIA"] == "h.1"][:6]
    f[0]["properties"]["NOMBRE_PROYECTO"] = ""                      # SINTÉTICO: corrompe registros reales
    f[1]["properties"]["FORMA_PRESENTACION"] = "EIA"               # no coincide con la capa 2
    f[2]["properties"]["INVERSION_US"] = -1
    f[3]["geometry"] = {"type": "Point", "coordinates": [10, 50]}
    f[4]["properties"]["ID_EXPEDIENTE"] = f[5]["properties"]["ID_EXPEDIENTE"]
    r = seia.transform_seia(f, 2, RULES, resolver(comunas))
    codes = sorted(x.code for x in r.rejections)
    assert codes == sorted(["value_invalid", "value_invalid", "value_invalid", "coordinates_out_of_range", "duplicate_key"]), codes


def test_missing_geometry_is_kept_with_no_point(comunas):
    p = next(x for x in features("seia_dia") if x["properties"]["LETRA_TIPOLOGIA"] == "h.1")
    p["geometry"] = None
    r = seia.transform_seia([p], 2, RULES, resolver(comunas))
    assert len(r.rows) == 1 and r.rows[0][19] is None and r.stats["without_geometry"] == 1
