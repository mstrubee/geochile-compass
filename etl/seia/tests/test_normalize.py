from collections import Counter
from datetime import date
from decimal import Decimal

import pytest

from conftest import EPOCH_2019_05_10, make_feature
from seia.normalize import Parsed, Resolver, parse_feature, parse_pages, to_date, to_point, to_usd
import json


# ---------------------------------------------------------------- fechas
def test_epoch_a_medianoche_utc_es_fecha_sin_hora():
    w = Counter()
    assert to_date(EPOCH_2019_05_10, w, "F") == date(2019, 5, 10)        # NO se corre un día atrás por pasarla a Santiago
    assert w == {"date_utc_midnight:F": 1}


def test_epoch_con_hora_pasa_a_la_fecha_local_de_santiago():
    w = Counter()
    # 2020-01-01T02:00Z = 2019-12-31 23:00 en Santiago (verano, UTC-3)
    assert to_date(1577844000000, w, "F") == date(2019, 12, 31)
    assert w == {"date_with_time:F": 1}


def test_epoch_en_texto_y_fecha_iso():
    w = Counter()
    assert to_date(str(EPOCH_2019_05_10), w, "F") == date(2019, 5, 10)
    assert to_date("2021-03-04", w, "F") == date(2021, 3, 4)
    assert to_date("2021-03-04T10:00:00", w, "F") == date(2021, 3, 4)


@pytest.mark.parametrize("v", ["no es fecha", True, float("nan"), 10 ** 30, "13/45/2020"])
def test_fecha_ilegible_es_none_y_se_cuenta(v):
    w = Counter()
    assert to_date(v, w, "FECHA_X") is None
    assert w == {"bad_date:FECHA_X": 1}


@pytest.mark.parametrize("v", [None, "", "   "])
def test_fecha_ausente_es_none_sin_aviso(v):
    w = Counter()
    assert to_date(v, w, "F") is None and not w


# ---------------------------------------------------------------- inversión
def test_inversion():
    w = Counter()
    assert to_usd(1234.5, w) == Decimal("1234.50")
    assert to_usd("2500000", w) == Decimal("2500000.00")
    assert to_usd(None, w) is None and to_usd("", w) is None
    assert not w


@pytest.mark.parametrize("v,key", [(-5, "negative_investment"), ("abc", "bad_investment"), (float("inf"), "bad_investment"),
                                   (1e30, "investment_out_of_range")])
def test_inversion_invalida_es_none_y_se_cuenta(v, key):
    w = Counter()
    assert to_usd(v, w) is None
    assert w == {key: 1}


# ---------------------------------------------------------------- coordenadas
def test_punto_valido():
    w = Counter()
    assert to_point({"type": "Point", "coordinates": [-70.5, -33.4]}, w) == (-70.5, -33.4) and not w


@pytest.mark.parametrize("geom,key", [
    (None, "no_geometry"), ({}, "no_geometry"),
    ({"type": "Polygon", "coordinates": []}, "non_point_geometry"),
    ({"type": "Point", "coordinates": [-70.5]}, "unreadable_coordinates"),
    ({"type": "Point", "coordinates": ["a", "b"]}, "unreadable_coordinates"),
    ({"type": "Point", "coordinates": [-7050000, -3335000]}, "coordinates_out_of_range"),     # metros, no grados: NO se "arregla"
    ({"type": "Point", "coordinates": [float("nan"), 1]}, "coordinates_out_of_range"),
])
def test_punto_invalido_es_sin_punto_y_se_cuenta(geom, key):
    w = Counter()
    assert to_point(geom, w) == (None, None)
    assert w == {key: 1}


# ---------------------------------------------------------------- comunas
def test_comuna_exacta_sin_importar_tildes_ni_mayusculas(resolver):
    assert resolver.resolve("LO BARNECHEA") == (["13115"], [])
    assert resolver.resolve("  lo barnechea ") == (["13115"], [])
    assert resolver.resolve("Ñuñoa") == (["13120"], [])
    assert resolver.resolve("NUNOA") == (["13120"], [])


def test_varias_comunas_con_distintos_separadores(resolver):
    assert resolver.resolve("Lo Barnechea, Las Condes") == (["13115", "13114"], [])
    assert resolver.resolve("Lo Barnechea; Las Condes / Providencia") == (["13115", "13114", "13123"], [])
    assert resolver.resolve("Lo Barnechea y Las Condes") == (["13115", "13114"], [])
    assert resolver.resolve("Lo Barnechea, Lo Barnechea") == (["13115"], [])           # sin repetir


def test_separador_real_del_servicio_es_el_guion(resolver):
    """Textos de COMUNAS tomados del sondeo REAL del 2026-10-17 (solo las cadenas, no sus archivos de datos)."""
    assert resolver.resolve("Pica-Pozo Almonte") == (["01405", "01401"], [])                    # CUT oficiales de Pica y Pozo Almonte
    cuts, unresolved = resolver.resolve("Quillota-Salamanca-Putaendo-Hijuelas-Petorca-Catemu")
    assert len(cuts) == 6 and cuts[0] == "05501" and unresolved == []
    assert resolver.resolve("Los Vilos-Canela-Ovalle-Coquimbo")[0][:2] == ["04203", "04202"]
    assert len(resolver.resolve("Los Vilos-Canela-Ovalle-Coquimbo")[0]) == 4
    cuts, unresolved = resolver.resolve("Temuco-Concepción-Nacimiento-Talcahuano-Penco-Hualqui-Santa Juana-San Rosendo-Negrete-Ercilla-Victoria-Perquenco-Lautaro-Vilcún")
    assert len(cuts) == 14 and unresolved == []                       # nombres con espacios ("Santa Juana") no se parten
    assert resolver.resolve("Alto del Carmen-Vallenar-La Higuera-Vicuña")[1] == []


def test_un_guion_con_una_comuna_inexistente_se_informa(resolver):
    assert resolver.resolve("Lo Barnechea-Comuna Inventada") == (["13115"], ["Comuna Inventada"])


def test_lo_que_no_calza_se_informa_y_no_se_adivina(resolver):
    assert resolver.resolve("Lo Barnechea, Comuna Inventada") == (["13115"], ["Comuna Inventada"])
    assert resolver.resolve("Lo Barnecheaa") == ([], ["Lo Barnecheaa"])               # sin coincidencia aproximada
    assert resolver.resolve("Santiago Centro") == ([], ["Santiago Centro"])
    assert resolver.resolve(None) == ([], []) and resolver.resolve("  ") == ([], [])


def test_alias_propio_de_la_fuente(comunas):
    r = Resolver(comunas, [{"name": "coihaique", "cut": "11101"}])
    assert r.resolve("Coihaique") == (["11101"], [])


# ---------------------------------------------------------------- filas
def test_feature_completa(resolver):
    p = Parsed()
    row = parse_feature(make_feature(7, FECHA_CALIFICACION=EPOCH_2019_05_10), resolver, p)
    assert row.external_id == "2000000007" and row.name == "Proyecto SINTÉTICO 7"
    assert row.typology_letter == "h.1" and row.comuna_cuts == ["13115"] and not row.comunas_unresolved
    assert row.submitted_at == date(2019, 5, 17) and row.qualified_at == date(2019, 5, 10)
    assert row.investment_usd == Decimal("1000007.00") and (row.lon, row.lat) == (-70.5, -33.35)
    assert not p.rejections


def test_raw_no_repite_lo_que_ya_esta_en_columnas_y_conserva_el_resto(resolver):
    row = parse_feature(make_feature(1, CAMPO_NUEVO="x", VACIO="", NULO=None), resolver, Parsed())
    assert set(row.raw) >= {"OBJECTID", "X", "Y", "NUEVO_X", "NUEVO_Y", "MODIFICADO", "FECHA_PRESENTACION", "INVERSION_US", "CAMPO_NUEVO"}
    assert not (set(row.raw) & {"ID_EXPEDIENTE", "NOMBRE_PROYECTO", "COMUNAS", "TITULAR", "REGION", "ESTADO_EVALUACION"})
    assert "VACIO" not in row.raw and "NULO" not in row.raw
    assert row.raw["X"] == -70.5            # X/Y quedan, pero NO se usan como respaldo del punto


def test_el_usuario_del_funcionario_no_se_guarda(resolver):
    """USUARIO (nombre de usuario de quien editó el registro en el SEA) es un dato personal innecesario: fuera de raw."""
    row = parse_feature(make_feature(1, USUARIO="marcia.riffo", WORK_ID=400, FECHA_MODIFICACION=1752270110000), resolver, Parsed())
    assert "USUARIO" not in row.raw
    assert row.raw["WORK_ID"] == 400 and row.raw["FECHA_MODIFICACION"] == 1752270110000          # el resto de los campos sin columna se conserva


def test_xy_no_reemplaza_a_una_geometria_ausente(resolver):
    p = Parsed()
    row = parse_feature(make_feature(1, geometry=None), resolver, p)
    assert (row.lon, row.lat) == (None, None) and p.warnings["no_geometry"] == 1


def test_nombres_de_campo_sin_importar_mayusculas_y_id_numerico(resolver):
    f = make_feature(3)
    f["properties"] = {k.lower(): v for k, v in f["properties"].items()}
    f["properties"]["id_expediente"] = 2145678.0
    row = parse_feature(f, resolver, Parsed())
    assert row.external_id == "2145678" and row.name == "Proyecto SINTÉTICO 3"


@pytest.mark.parametrize("val", [None, "", "   "])
def test_sin_id_se_rechaza(resolver, val):
    p = Parsed()
    assert parse_feature(make_feature(1, ID_EXPEDIENTE=val), resolver, p) is None
    assert [r.code for r in p.rejections] == ["missing_id"] and p.rejections[0].objectid == 1


def test_feature_sin_properties_se_rechaza(resolver):
    p = Parsed()
    assert parse_feature({"type": "Feature", "geometry": None}, resolver, p) is None
    assert p.rejections[0].code == "unreadable_feature"


def test_url_solo_si_el_servicio_la_trae_y_es_https(resolver):
    assert parse_feature(make_feature(1), resolver, Parsed()).expediente_url is None            # no se inventa
    assert parse_feature(make_feature(1, URL="https://seia.example/exp/1"), resolver, Parsed()).expediente_url == "https://seia.example/exp/1"
    # el servicio real trae URL_EXPEDIENTE; se usa como columna y NO se repite en raw
    real = "https://seia.sea.gob.cl/expediente/expediente.php?id_expediente=2147600353"
    row = parse_feature(make_feature(1, URL_EXPEDIENTE=real), resolver, Parsed())
    assert row.expediente_url == real and "URL_EXPEDIENTE" not in row.raw
    # si NO es https no se usa y se conserva en raw (no se pierde)
    row = parse_feature(make_feature(1, URL_EXPEDIENTE="http://seia.sea.gob.cl/x"), resolver, Parsed())
    assert row.expediente_url is None and row.raw["URL_EXPEDIENTE"] == "http://seia.sea.gob.cl/x"
    assert parse_feature(make_feature(1, URL="javascript:alert(1)"), resolver, Parsed()).expediente_url is None
    assert parse_feature(make_feature(1, URL="http://inseguro"), resolver, Parsed()).expediente_url is None


def page(feats):
    return json.dumps({"type": "FeatureCollection", "features": feats}).encode()


def test_repetidos_se_rechazan_todos_y_las_estadisticas_cuadran(resolver):
    feats = [make_feature(1), make_feature(2, ID_EXPEDIENTE=2000000001), make_feature(3, comunas="Nada"), make_feature(4, ID_EXPEDIENTE=None)]
    parsed = parse_pages([page(feats[:2]), page(feats[2:])], resolver)
    assert parsed.features_received == 4
    assert [r.external_id for r in parsed.rows] == ["2000000003"]
    assert Counter(r.code for r in parsed.rejections) == {"duplicate_key": 2, "missing_id": 1}
    assert len(parsed.rows) + len(parsed.rejections) == parsed.features_received
    # estadísticas de comunas solo sobre lo que se carga (no sobre los rechazados)
    assert dict(parsed.comuna_rows) == {"none_resolved": 1} and parsed.unresolved_tokens == {"Nada": 1}
