"""Fixtures de las pruebas del ETL del SEIA.

⚠️  TODO es SINTÉTICO. Los expedientes se construyen aquí con los NOMBRES de campo que el usuario comprobó en el servicio real
    (ID_EXPEDIENTE, COMUNAS, FECHA_*, INVERSION_US…), pero los valores son inventados. El servidor ArcGIS es un servidor HTTP
    local que imita la paginación; no es el servicio del SEA (el host está bloqueado desde esta sesión). Cuando el sondeo de
    feat/proyectos-parte4 entregue recortes REALES, se reemplazan los fixtures sin tocar las pruebas de mecánica.
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

ETL = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ETL))
sys.dont_write_bytecode = True

from permisos import seed as seedmod          # noqa: E402
from seia.normalize import Resolver           # noqa: E402

EPOCH_2019_05_10 = 1557446400000              # 2019-05-10T00:00:00Z


def make_feature(i, *, comunas="Lo Barnechea", lonlat=(-70.5, -33.35), geometry="point", **over):
    """Un expediente sintético con los campos del servicio."""
    props = {
        "OBJECTID": i, "ID_EXPEDIENTE": 2000000000 + i, "NOMBRE_PROYECTO": f"Proyecto SINTÉTICO {i}",
        "FORMA_PRESENTACION": "Declaración de Impacto Ambiental", "LETRA_TIPOLOGIA": "h.1",
        "NOMBRE_TIPOLOGIA": "h.1) Proyectos inmobiliarios", "REGION": "Región Metropolitana de Santiago",
        "COMUNAS": comunas, "TITULAR": f"Titular SINTÉTICO {i}", "ESTADO_EVALUACION": "Aprobado",
        "FECHA_PRESENTACION": EPOCH_2019_05_10 + i * 86400000, "FECHA_CALIFICACION": None,
        "INVERSION_US": 1000000 + i, "X": lonlat[0], "Y": lonlat[1], "NUEVO_X": lonlat[0], "NUEVO_Y": lonlat[1],
        "MODIFICADO": 1700000000000,
    }
    props.update(over)
    geom = {"type": "Point", "coordinates": list(lonlat)} if geometry == "point" else geometry
    return {"type": "Feature", "id": i, "geometry": geom, "properties": props}


@pytest.fixture(scope="session")
def comunas():
    return [{"cut": r["commune_id"], "name": r["commune_name"], "region_cut": r["region_id"]} for r in seedmod.read_csv()]


@pytest.fixture(scope="session")
def resolver(comunas):
    return Resolver(comunas, [])


class FakeArcGis:
    """Servidor local que imita `…/MapServer/<capa>`. Parámetros de comportamiento para provocar fallas reales."""

    def __init__(self):
        self.layers: dict[int, list[dict]] = {1: [], 2: []}
        self.max_record = 2000          # lo máximo que devuelve por página (el servidor puede dar menos de lo pedido)
        self.count_lie = 0              # se suma al conteo que informa
        self.count_drift = 0            # el SEGUNDO conteo (tras paginar) difiere en esto
        self.ignore_offset = False      # devuelve siempre la primera página
        self.fail_status = None         # HTTP status a devolver en /query
        self.fail_layer = None          # si se indica, solo esa capa (1 = EIA, 2 = DIA) devuelve fail_status
        self.error_json = None          # cuerpo {"error": …} con HTTP 200
        self.last_edit = None
        self.calls = []
        self._counts = {1: 0, 2: 0}

    def handler(outer):
        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, body):
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                u = urlparse(self.path)
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                outer.calls.append((u.path, q))
                parts = [p for p in u.path.split("/") if p]
                layer = int(parts[0])
                feats = outer.layers[layer]
                if outer.error_json is not None:
                    return self._send(200, outer.error_json)
                if parts[-1] != "query":
                    md = {"id": layer, "name": f"capa{layer}"}
                    if outer.last_edit:
                        md["editingInfo"] = {"lastEditDate": outer.last_edit}
                    return self._send(200, md)
                if outer.fail_status and outer.fail_layer in (None, layer):
                    return self._send(outer.fail_status, {"detail": "boom"})
                if q.get("returnCountOnly") == "true":
                    outer._counts[layer] += 1
                    n = len(feats) + outer.count_lie + (outer.count_drift if outer._counts[layer] > 1 else 0)
                    return self._send(200, {"count": n})
                off = 0 if outer.ignore_offset else int(q.get("resultOffset", 0))
                size = min(int(q.get("resultRecordCount", 2000)), outer.max_record)
                return self._send(200, {"type": "FeatureCollection", "features": feats[off:off + size]})
        return H

    def start(self):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), self.handler())
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def fake():
    srv = FakeArcGis().start()
    yield srv
    srv.stop()
