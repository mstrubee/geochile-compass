"""Prueba la MECÁNICA del sondeo contra un servidor ArcGIS FALSO y local.

Los datos de este servidor son SINTÉTICOS y existen solo para ejercitar el código (paginación, estadísticas
agrupadas, errores parciales, resumen). No representan ningún dato del INE ni del SEA: los fixtures reales se
obtienen corriendo `python etl/proyectos_probe.py` en una máquina con acceso a los servicios.
"""
import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

ROOT = Path(__file__).resolve().parents[3]


def _meta(fields):
    return {"fields": [{"name": n, "type": t, "alias": n} for n, t in fields], "maxRecordCount": 2000,
            "supportsPagination": True, "geometryType": "esriGeometryPoint",
            "editingInfo": {"lastEditDate": 1700000000000}, "extent": {"xmin": -80}}


PE = [("OBJECTID", "esriFieldTypeOID"), ("COD_COMUNA", "esriFieldTypeSmallInteger"), ("AÑO", "esriFieldTypeSmallInteger"),
      ("USO_DESTINO", "esriFieldTypeString"), ("PRECISION_", "esriFieldTypeString"), ("CANTIDAD_UNIDAD", "esriFieldTypeInteger"),
      ("SUPERFICIE", "esriFieldTypeDouble"), ("GLOSA_DESTINO", "esriFieldTypeString"), ("NUM_PISOS", "esriFieldTypeInteger")]
CRF = [("OBJECTID", "esriFieldTypeOID"), ("CUT", "esriFieldTypeString"), ("AÑO_EMISION", "esriFieldTypeSmallInteger"), ("N_VIVIENDA", "esriFieldTypeInteger")]
SEIA = [("OBJECTID", "esriFieldTypeOID"), ("ID_EXPEDIENTE", "esriFieldTypeString"), ("LETRA_TIPOLOGIA", "esriFieldTypeString"),
        ("NOMBRE_TIPOLOGIA", "esriFieldTypeString"), ("COMUNAS", "esriFieldTypeString"), ("ESTADO_EVALUACION", "esriFieldTypeString")]


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        parts = [p for p in u.path.split("/") if p]
        if parts[:1] == ["sharing"]:
            return self._send({"title": "item falso", "licenseInfo": "texto de licencia FALSO de prueba"})
        if u.path.endswith(("/ine", "/seia")):
            return self._send({"serviceItemId": "abc123", "copyrightText": "falso"})
        lid = int(parts[-2]) if parts[-1] == "query" else int(parts[-1])
        base = "ine" if "ine" in parts else "seia"
        fields = {("ine", 1): PE, ("ine", 2): CRF, ("ine", 0): CRF, ("seia", 1): SEIA, ("seia", 2): SEIA}[(base, lid)]
        if parts[-1] != "query":
            return self._send(_meta(fields))
        if q.get("returnCountOnly"):
            return self._send({"count": 5})
        if "outStatistics" in q:
            if "OBJECTID" in q["outStatistics"] and "min_oid" in q["outStatistics"]:
                return self._send({"features": [{"attributes": {"min_oid": 1, "max_oid": 5}}]})
            g = q["groupByFieldsForStatistics"].split(",")
            off = int(q.get("resultOffset", 0))
            rows = [{**{k: (2010 + i if "AÑO" in k else 1000 + i) for k in g}, "n": 1, "unidades": 3, "superficie": 9.5, "viviendas": 4} for i in range(3)]
            page = rows[off:off + 2]                       # fuerza paginación de 2 en 2
            return self._send({"features": [{"attributes": a} for a in page], "exceededTransferLimit": off + 2 < len(rows)})
        if q.get("f") == "geojson":
            n = int(q.get("resultRecordCount", 5))
            return self._send({"type": "FeatureCollection", "features": [
                {"type": "Feature", "properties": {"OBJECTID": i + 1}, "geometry": {"type": "Point", "coordinates": [-70, -33]}} for i in range(n)]})
        if q.get("returnIdsOnly"):
            return self._send({"objectIds": [1]})
        off = int(q.get("resultOffset", 0))
        return self._send({"features": [{"attributes": {"OBJECTID": off + i + 1}} for i in range(int(q.get("resultRecordCount", 5)))]})


@pytest.fixture(scope="module")
def server():
    srv = HTTPServer(("127.0.0.1", 0), Fake)
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def load_probe(monkeypatch, base):
    monkeypatch.setenv("PROBE_INE_BASE", f"{base}/ine")
    monkeypatch.setenv("PROBE_SEIA_BASE", f"{base}/seia")
    monkeypatch.setenv("PROBE_PORTAL_BASE", f"{base}/sharing/rest")
    spec = importlib.util.spec_from_file_location("proyectos_probe", ROOT / "etl" / "proyectos_probe.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def test_probe_end_to_end(server, monkeypatch, tmp_path):
    m = load_probe(monkeypatch, server)
    assert m.main(["--out", str(tmp_path), "--pause", "0", "--zip"]) == 0
    rep = json.loads((tmp_path / "probe.json").read_text(encoding="utf-8"))
    pe = rep["capas"]["ine_pe"]
    assert pe["conteo_servidor"] == 5
    assert pe["campos_esperados"]["ANO"] == "AÑO"                   # resuelve el campo con Ñ por nombre normalizado
    assert len(pe["por_anio"]) == 3                                  # paginó las estadísticas (2 + 1)
    assert pe["paginacion"]["sin_solape"] is True
    assert (tmp_path / "sample_ine_pe_2019.geojson").exists()
    assert (tmp_path / "sample_ine_pe_precision_baja.geojson").exists()
    assert rep["capas"]["seia_dia"]["campos_esperados"]["NOMBRE_TIPOLOGIA"] == "NOMBRE_TIPOLOGIA"
    assert rep["licencia"]["ine_item_resumen"]["licenseInfo"].startswith("texto de licencia FALSO")
    assert "Sondeo Parte 4" in (tmp_path / "resumen.md").read_text(encoding="utf-8")
    assert (tmp_path.with_suffix(".zip")).exists()


def test_probe_survives_unreachable_service(monkeypatch, tmp_path):
    m = load_probe(monkeypatch, "http://127.0.0.1:9")                 # puerto cerrado: todo falla
    monkeypatch.setattr(m.Client, "__init__", lambda self, pause, timeout=2, retries=1: (setattr(self, "s", __import__("requests").Session()),
                        setattr(self, "pause", 0), setattr(self, "timeout", 2), setattr(self, "retries", 1), setattr(self, "log", []), None)[-1])
    assert m.main(["--out", str(tmp_path), "--only", "ine_pe"]) == 0   # no aborta: registra los errores
    rep = json.loads((tmp_path / "probe.json").read_text(encoding="utf-8"))
    assert rep["capas"]["ine_pe"]["_errores"]
