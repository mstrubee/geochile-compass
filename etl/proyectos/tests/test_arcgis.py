import json

import pytest

from conftest import Faults, features
from proyectos import arcgis


def client():
    return arcgis.Client(pause=0, timeout=10, retries=3)


def test_fetch_all_pages_and_consistency(server):
    dl = arcgis.fetch_all(client(), f"{server}/ine/1", page_size=100)
    assert len(dl.features) == 300 and dl.consistent and dl.count_before == dl.count_after == 300
    assert dl.pages == 4                                         # 3 páginas con datos + 1 vacía que cierra el ciclo
    oids = [f["properties"]["OBJECTID"] for f in dl.features]
    assert oids == sorted(oids) and len(set(oids)) == 300


def test_page_size_larger_than_data(server):
    dl = arcgis.fetch_all(client(), f"{server}/ine/2", page_size=2000)
    assert len(dl.features) == len(features("ine_crf")) and dl.pages == 2


def test_count_drift_is_reported_not_hidden(server):
    Faults.count_drift = True
    dl = arcgis.fetch_all(client(), f"{server}/ine/1", page_size=500)
    assert dl.count_before != dl.count_after and not dl.consistent


def test_repeated_objectid_between_pages_is_an_error(server):
    Faults.dup_page = True
    with pytest.raises(arcgis.ArcGisError, match="repetido entre páginas"):
        arcgis.fetch_all(client(), f"{server}/ine/1", page_size=100)


def test_transient_500_is_retried(server):
    Faults.flaky_first = True
    dl = arcgis.fetch_all(arcgis.Client(pause=0, timeout=10, retries=3), f"{server}/seia/1", page_size=500)
    assert len(dl.features) == 130


def test_unreachable_source_raises_clear_error():
    with pytest.raises(arcgis.ArcGisError):
        arcgis.fetch_all(arcgis.Client(pause=0, timeout=1, retries=1), "http://127.0.0.1:9/x/1")


def test_normalization_is_deterministic_and_order_independent():
    f = features("ine_pe")
    a = arcgis.normalized_geojson_bytes(f)
    b = arcgis.normalized_geojson_bytes(list(reversed(f)))
    assert a == b and arcgis.sha256_hex(a) == arcgis.sha256_hex(b)
    assert arcgis.gzip_deterministic(a) == arcgis.gzip_deterministic(b)
    doc = json.loads(a)
    assert [x["properties"]["OBJECTID"] for x in doc["features"]] == sorted(x["properties"]["OBJECTID"] for x in f)


def test_hash_changes_when_one_value_changes():
    f = features("ine_pe")
    h0 = arcgis.sha256_hex(arcgis.normalized_geojson_bytes(f))
    f[0]["properties"]["CANTIDAD_UNIDAD"] += 1
    assert arcgis.sha256_hex(arcgis.normalized_geojson_bytes(f)) != h0


def test_epoch_ms_to_utc_date_without_shift():
    assert arcgis.epoch_ms_to_date_utc(1597017600000) == "2020-08-10"      # 2020-08-10 00:00 UTC (Praderas La Dehesa)
    assert arcgis.epoch_ms_to_date_utc(None) is None
