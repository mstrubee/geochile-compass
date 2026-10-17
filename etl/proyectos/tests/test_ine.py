import copy

from conftest import features
from proyectos import ine
from proyectos.common import cut_from_number, cut_from_text


def test_cut_normalization():
    assert cut_from_number(1401) == "01401" and cut_from_number(13101) == "13101" and cut_from_number(1101) == "01101"
    assert cut_from_number(None) is None and cut_from_number(12.5) is None and cut_from_number(True) is None and cut_from_number("x") is None
    assert cut_from_text("1401") == "01401" and cut_from_text("13101") == "13101" and cut_from_text("14O1") is None and cut_from_text(None) is None


def test_pe_real_clip_is_fully_accepted(valid_cuts, names):
    r = ine.transform_pe(features("ine_pe"), valid_cuts, names)
    assert r.stats["accepted"] + r.stats["rejected"] == 300
    assert r.stats["rejected"] == 0, r.rejections[:3]
    assert set(r.stats["by_uso"]) <= {"HABITACIONAL", "MIXTO", "NO HABITACIONAL"}
    assert set(r.stats["by_precision"]) == {"ALTA", "MODERADA", "BAJA", "sin dato"}, "el recorte real trae las 4 precisiones"
    assert all(len(row[1]) == 5 for row in r.rows)
    assert all(row[6] in (0, 1, 2, 3) for row in r.rows)


def test_pe_null_precision_is_zero_not_invented(valid_cuts):
    f = [x for x in features("ine_pe") if x["properties"]["PRECISION_"] is None][:3]
    r = ine.transform_pe(f, valid_cuts)
    assert len(r.rows) == 3 and all(row[6] == 0 for row in r.rows)


def test_pe_units_not_records_are_summed(valid_cuts):
    f = features("ine_pe")
    r = ine.transform_pe(f, valid_cuts)
    assert sum(r.stats["units_by_year"].values()) == sum(x["properties"]["CANTIDAD_UNIDAD"] for x in f)


def test_pe_rejections_have_reasons_and_nothing_is_corrected(valid_cuts):
    f = features("ine_pe")[:8]
    # SINTÉTICO: se corrompen 8 registros reales, uno por motivo
    f[0]["properties"]["COD_COMUNA"] = 99999                                 # cut_unknown
    f[1]["properties"]["COD_COMUNA"] = None                                  # cut_invalid
    f[2]["properties"]["AÑO"] = 1999                                         # year_invalid
    f[3]["properties"]["USO_DESTINO"] = "AGRICOLA"                           # uso_unmapped
    f[4]["properties"]["PRECISION_"] = "MEDIA"                               # value_invalid
    f[5]["geometry"] = None                                                  # geometry_missing
    f[6]["geometry"] = {"type": "Point", "coordinates": [10.0, 50.0]}        # coordinates_out_of_range (Europa)
    f[7]["properties"]["OBJECTID"] = f[6]["properties"]["OBJECTID"]          # duplicate_key
    r = ine.transform_pe(f, valid_cuts)
    codes = sorted(x.code for x in r.rejections)
    assert codes == sorted(["cut_unknown", "cut_invalid", "year_invalid", "uso_unmapped", "value_invalid", "geometry_missing",
                            "coordinates_out_of_range", "duplicate_key"])
    assert r.rows == []


def test_pe_negative_or_huge_units_rejected(valid_cuts):
    f = features("ine_pe")[:3]
    f[0]["properties"]["CANTIDAD_UNIDAD"] = -1
    f[1]["properties"]["CANTIDAD_UNIDAD"] = 40000          # no cabe en smallint
    r = ine.transform_pe(f, valid_cuts)
    assert [x.code for x in r.rejections] == ["value_invalid", "value_invalid"] and len(r.rows) == 1


def test_crf_real_clip_zero_pads_cut_and_keeps_polygons(valid_cuts, names):
    r = ine.transform_crf(features("ine_crf"), valid_cuts, names)
    assert r.stats["accepted"] + r.stats["rejected"] == len(features("ine_crf")) and r.stats["rejected"] == 0, r.rejections[:3]
    assert r.stats["cut_zero_padded"] > 0, "el CUT real llega sin el cero inicial en regiones 1-9"
    assert all(len(row[1]) == 5 and row[1].isdigit() for row in r.rows)
    assert all('"type":"Polygon"' in row[4] or '"type":"MultiPolygon"' in row[4] for row in r.rows)


def test_crf_rejections(valid_cuts):
    f = features("ine_crf")[:5]
    f[0]["properties"]["CUT"] = "99999"                      # cut_unknown
    f[1]["properties"]["CUT"] = "abc"                        # cut_invalid
    f[2]["geometry"] = {"type": "Point", "coordinates": [-70, -33]}      # geometry_missing (no es polígono)
    f[3]["properties"]["N_VIVIENDA"] = -5                    # value_invalid
    f[4]["properties"]["AÑO_EMISION"] = 1990                 # year_invalid
    r = ine.transform_crf(f, valid_cuts)
    assert sorted(x.code for x in r.rejections) == sorted(["cut_unknown", "cut_invalid", "geometry_missing", "value_invalid", "year_invalid"])


def test_inputs_are_not_mutated(valid_cuts):
    f = features("ine_pe")
    before = copy.deepcopy(f)
    ine.transform_pe(f, valid_cuts)
    assert f == before
