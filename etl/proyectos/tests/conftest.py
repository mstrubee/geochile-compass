"""Servidor ArcGIS FALSO y local que sirve los RECORTES REALES de etl/proyectos/tests/fixtures (sondeo 2026-10-17).

El servidor imita lo que importa del protocolo (metadatos, returnCountOnly, paginación con resultOffset/orderByFields, f=geojson)
y permite simular fallos (conteo que cambia, OBJECTID repetido entre páginas, errores 500 transitorios). Los DATOS son reales; el
servidor y sus fallos son simulados.
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

ETL = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ETL))
sys.dont_write_bytecode = True

FIX = Path(__file__).parent / "fixtures"
LAYERS = {("ine", 1): "ine_pe", ("ine", 2): "ine_crf", ("seia", 1): "seia_eia", ("seia", 2): "seia_dia"}


def _load(key):
    feats = json.loads((FIX / f"{key}.geojson").read_text(encoding="utf-8"))["features"]
    meta = json.loads((FIX / f"meta_{key}.json").read_text(encoding="utf-8"))
    return feats, meta


DATA = {key: _load(key) for key in LAYERS.values()}


class Faults:
    """Interruptores de simulación; los tests los activan y los restauran."""
    count_drift = False        # el 2.º returnCountOnly devuelve +1
    dup_page = False           # la 2.ª página repite un OBJECTID
    flaky_first = False        # la primera petición de cada URL responde 500
    drop_field = None          # quita un campo de los metadatos
    calls = 0
    seen: set = set()
    count_calls = 0
    empty = False
    bump_first = False         # SINTÉTICO: cambia 1 valor de la 1.ª fila para que cambie el hash (nueva captura)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        parts = [p for p in u.path.split("/") if p]
        Faults.calls += 1
        if Faults.flaky_first and self.path not in Faults.seen:
            Faults.seen.add(self.path)
            return self._send({"error": "temporal"}, 500)
        is_query = parts[-1] == "query"
        lid = int(parts[-2] if is_query else parts[-1])
        key = LAYERS[(parts[0], lid)]
        feats, meta = DATA[key]
        if Faults.empty:
            feats = []
        if not is_query:
            m = dict(meta)
            if Faults.drop_field:
                m["fields"] = [f for f in m["fields"] if f["name"] != Faults.drop_field]
            return self._send(m)
        if q.get("returnCountOnly"):
            Faults.count_calls += 1
            return self._send({"count": len(feats) + (1 if Faults.count_drift and Faults.count_calls % 2 == 0 else 0)})
        off, n = int(q.get("resultOffset", 0)), int(q.get("resultRecordCount", 1000))
        page = feats[off:off + n]
        if Faults.bump_first and off == 0 and page and 'CANTIDAD_UNIDAD' in (page[0].get('properties') or {}):
            page = [json.loads(json.dumps(page[0]))] + page[1:]
            page[0]['properties']['CANTIDAD_UNIDAD'] += int(Faults.bump_first)
        if Faults.dup_page and off > 0 and page:
            page = [feats[0]] + page[1:]
        return self._send({"type": "FeatureCollection", "features": page})


@pytest.fixture(scope="session")
def server():
    srv = HTTPServer(("127.0.0.1", 0), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture(autouse=True)
def reset_faults():
    Faults.count_drift = Faults.dup_page = Faults.flaky_first = Faults.empty = Faults.bump_first = False
    Faults.drop_field = None
    Faults.calls = Faults.count_calls = 0
    Faults.seen = set()
    yield


@pytest.fixture(scope="session")
def comunas():
    from proyectos.common import read_comunas_csv
    return read_comunas_csv()


@pytest.fixture(scope="session")
def valid_cuts(comunas):
    return {c["cut"] for c in comunas}


@pytest.fixture(scope="session")
def names(comunas):
    return {c["cut"]: c["name"] for c in comunas}


def features(key):
    return json.loads(json.dumps(DATA[key][0]))       # copia profunda: los tests pueden mutar


@pytest.fixture(scope="session")
def tls_server(tmp_path_factory):
    """Mismo servidor, pero por HTTPS con un certificado autofirmado: las filas de snapshot exigen origin_url https://, y así el
    ETL sigue su camino real (sin concesiones en el código de producción). El cliente confía vía REQUESTS_CA_BUNDLE."""
    import shutil
    import ssl
    import subprocess
    if not shutil.which("openssl"):
        pytest.skip("falta openssl para el servidor HTTPS de prueba")
    d = tmp_path_factory.mktemp("tls")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(d / "k.pem"), "-out", str(d / "c.pem"),
                    "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], check=True, capture_output=True)
    srv = HTTPServer(("127.0.0.1", 0), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(d / "c.pem"), str(d / "k.pem"))
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"https://127.0.0.1:{srv.server_port}", str(d / "c.pem")
    srv.shutdown()
