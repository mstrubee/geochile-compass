import json

import pytest

from conftest import make_feature
from seia import arcgis


def client(fake, **kw):
    return arcgis.Client(fake.base, pause=0, retries=2, **kw)


def test_cuenta_y_pagina_hasta_la_pagina_vacia(fake):
    fake.layers[2] = [make_feature(i) for i in range(1, 51)]
    c = client(fake, page_size=20)
    assert c.count("dia") == 50
    pages = c.fetch_pages("dia", 50)
    assert [len(json.loads(p)["features"]) for p in pages] == [20, 20, 10]
    ids = [f["id"] for p in pages for f in json.loads(p)["features"]]
    assert ids == list(range(1, 51))
    q = [q for path, q in fake.calls if path.endswith("/query") and "resultOffset" in q]
    assert [x["resultOffset"] for x in q] == ["0", "20", "40", "50"]      # termina con una página VACÍA, no al llegar al conteo
    assert all(x["orderByFields"] == "OBJECTID" and x["outSR"] == "4326" and x["f"] == "geojson" for x in q)


def test_el_servidor_puede_dar_menos_de_lo_pedido(fake):
    fake.layers[2] = [make_feature(i) for i in range(1, 26)]
    fake.max_record = 10                       # pedimos 2000, entrega 10: el offset avanza por lo RECIBIDO
    pages = client(fake).fetch_pages("dia", 25)
    assert sum(len(json.loads(p)["features"]) for p in pages) == 25


def test_capa_vacia(fake):
    assert client(fake).fetch_pages("eia", 0) == []


def test_las_capas_usan_su_propio_id(fake):
    fake.layers[1] = [make_feature(1)]
    c = client(fake)
    assert c.layer_url("eia").endswith("/1") and c.layer_url("dia").endswith("/2")
    assert c.count("eia") == 1 and c.count("dia") == 0


def test_metadatos_con_fecha_de_edicion_y_tolerancia_a_fallos(fake):
    fake.last_edit = 1760000000000
    assert client(fake).metadata("dia")["editingInfo"]["lastEditDate"] == 1760000000000
    fake.error_json = {"error": {"code": 500, "message": "x"}}
    assert client(fake).metadata("dia") == {}                         # un fallo de metadatos no detiene la carga


def test_error_arcgis_con_http_200_se_detecta(fake):
    fake.error_json = {"error": {"code": 400, "message": "Invalid query"}}
    with pytest.raises(arcgis.ArcGisError, match="Invalid query"):
        client(fake).count("dia")
    assert len([1 for p, q in fake.calls if q.get("returnCountOnly")]) == 1      # 400 no se reintenta


def test_http_500_se_reintenta_y_luego_falla(fake):
    fake.fail_status = 500
    with pytest.raises(arcgis.ArcGisError, match="HTTP 500"):
        client(fake).fetch_pages("dia", 10)
    assert len([1 for p, q in fake.calls if "resultOffset" in q]) == 2          # retries = 2


def test_paginacion_sin_fin_se_corta(fake):
    fake.layers[2] = [make_feature(i) for i in range(1, 11)]
    fake.ignore_offset = True                  # un servidor que ignora resultOffset repetiría la misma página para siempre
    with pytest.raises(arcgis.ArcGisError, match="sin fin"):
        client(fake, page_size=10).fetch_pages("dia", 10)


def test_conteo_invalido(fake):
    fake.count_lie = -999
    with pytest.raises(arcgis.ArcGisError, match="conteo válido"):
        client(fake).count("dia")
