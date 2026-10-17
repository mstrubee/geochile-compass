"""Prueba la MECÁNICA de etl/salud_probe.py contra un servidor FALSO y local.

Todos los datos de este archivo son SINTÉTICOS: existen solo para ejercitar el código (zip por rangos, enmascarado con `*`,
clasificación de bloqueos, cuadre de un XLSX). No representan ningún dato del DEIS, de la Superintendencia ni de datos.gob.cl.
La evidencia con los archivos REALES está en docs/salud/HALLAZGOS_FASE0.md (medida en la sesión de la Fase 0).
"""
import importlib.util
import io
import json
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.dont_write_bytecode = True


def _load():
    spec = importlib.util.spec_from_file_location("salud_probe", ROOT / "etl" / "salud_probe.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


probe = _load()

# --- datos sintéticos ---------------------------------------------------------------------------------------------------
EST_CSV = (
    "EstablecimientoCodigo;ComunaCodigo;EstadoFuncionamiento;NivelComplejidadEstabGlosa;TipoAtencionEstabGlosa;DependenciaAdministrativa;Latitud;Longitud\n"
    "100;01101;Vigente en Operación Habitual;Alta Complejidad;Atención Cerrada-Hospitalaria;Privado;-18.48;-70.30\n"
    "101;01101;Cerrado;;Atención Abierta-Ambulatoria;Municipal;;\n"
    "102;13101;Vigente en operación habitual;Baja Complejidad;;Privado;-33.4;-70.6\n"
).encode("utf-8")

EGR_ROWS = ["PERTENENCIA_ESTABLECIMIENTO_SALU;SEXO;GRUPO_EDAD;COMUNA_RESIDENCIA;PREVISION;ANO_EGRESO;DIAG1;DIAS_ESTADA;CONDICION_EGRESO"]
EGR_ROWS += ["SNSS;MUJER;30 a 39;13101;1;2024;A00;3;1"] * 6
EGR_ROWS += ["*;*;*;*;*;*;Z540;9;1"] * 3                 # enmascaradas (sintético)
EGR_ROWS += ["SNSS;HOMBRE;60 a 69;99999;2;2024;B00;2;1"]  # comuna desconocida (sintético)
EGR_CSV = ("\n".join(EGR_ROWS) + "\n").encode("utf-8")


def make_zip() -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("Diccionario.xlsx", b"PK-no-es-un-csv", compress_type=zipfile.ZIP_STORED)   # primera entrada NO es el CSV (como en un año real)
        z.writestr("EGR_DATOS_ABIERTO_2024.csv", EGR_CSV, compress_type=zipfile.ZIP_DEFLATED)
    return b.getvalue()


ZIP = make_zip()
HITS: dict[str, int] = {}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="text/plain", extra=None, head=False, length=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body) if length is None else length))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _serve(self, head):
        path = self.path.split("?")[0]
        HITS[path] = HITS.get(path, 0) + 1
        port = self.server.server_address[1]
        if path == "/ckan/package_show":
            d = {"result": {"title": "Establecimientos (sintético)", "license_id": "cc-zero", "metadata_modified": "2026-10-14T00:00:00",
                            "organization": {"title": "Org sintética"},
                            "resources": [{"name": "est.csv", "format": "csv", "size": len(EST_CSV), "url": f"http://127.0.0.1:{port}/files/est.csv"}]}}
            return self._send(200, json.dumps(d).encode(), "application/json", head=head)
        data = {"/files/est.csv": (EST_CSV, "text/csv"), "/repo/DatosAbiertos/EGRESOS/EGRESOS_2024.zip": (ZIP, "application/x-zip-compressed")}.get(path)
        if path == "/waf":
            return self._send(403, b"<html><title>Just a moment...</title></html>", "text/html", head=head)
        if path == "/plain403":
            return self._send(403, b"prohibido", "text/html", head=head)
        if data is None:
            return self._send(404, b"no", "text/html", head=head)
        body, ctype = data
        rng = self.headers.get("Range")
        if rng and not head:
            a, _, z = rng.replace("bytes=", "").partition("-")
            a, z = int(a), min(int(z), len(body) - 1)
            return self._send(206, body[a:z + 1], ctype, {"Content-Range": f"bytes {a}-{z}/{len(body)}"})
        return self._send(200, b"" if head else body, ctype, head=head, length=len(body))

    def do_GET(self):
        self._serve(False)

    def do_HEAD(self):
        self._serve(True)


@pytest.fixture(scope="module")
def server():
    s = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{s.server_address[1]}"
    s.shutdown()


@pytest.fixture()
def env(server, monkeypatch):
    # hermético: TODAS las bases apuntan al servidor falso (ningún test sale a la red real)
    for name in ("DEIS_REPO", "SUPERSALUD", "CASEN", "INE", "CENSO", "REDATAM", "FONASA", "GEOFABRIK"):
        monkeypatch.setenv(f"PROBE_{name}", f"{server}/{name.lower()}")
    monkeypatch.setenv("PROBE_CKAN", f"{server}/ckan")
    monkeypatch.setenv("PROBE_DEIS_REPO", f"{server}/repo")
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    monkeypatch.setenv("no_proxy", "127.0.0.1")
    HITS.clear()
    return server


# --- clasificación y no-reintento ----------------------------------------------------------------------------------------
def test_waf_challenge_y_403_del_sitio_se_distinguen_y_no_se_reintentan(server, monkeypatch):
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    HITS.clear()
    c = probe.Client(pause=0)
    _, waf = c.get(f"{server}/waf")
    _, plain = c.get(f"{server}/plain403")
    assert waf["kind"] == "waf_challenge" and plain["kind"] == "site_403"
    assert HITS["/waf"] == 1 and HITS["/plain403"] == 1            # una sola petición: los bloqueos no se reintentan


def test_error_de_conexion_se_clasifica():
    c = probe.Client(pause=0, timeout=2)
    _, e = c.get("http://127.0.0.1:1/x")                            # puerto cerrado
    assert e["kind"] in ("error", "reset", "timeout") and "status" not in e


# --- utilidades puras -----------------------------------------------------------------------------------------------------
def test_decode_bytes_cae_a_cp1252():
    assert probe.decode_bytes("Chillán".encode("utf-8")) == ("Chillán", "utf-8")
    txt, enc = probe.decode_bytes("Chillán".encode("cp1252"))
    assert enc == "cp1252" and txt == "Chillán"


def test_norm_quita_tildes_y_signos():
    assert probe.norm("  O'Higgins ") == "o higgins" and probe.norm("Ñuñoa") == "nunoa"


def test_zip_por_rangos_salta_la_entrada_que_no_es_csv_y_mide_el_enmascarado():
    size = len(ZIP)
    ents = probe.read_zip_directory(ZIP[max(0, size - probe.TAIL_BYTES):], size)
    assert [e["name"] for e in ents] == ["Diccionario.xlsx", "EGR_DATOS_ABIERTO_2024.csv"]
    ent = ents[1]
    name, raw = probe.inflate_entry_head(ZIP[ent["offset"]:ent["offset"] + 5000])
    assert name.endswith(".csv")
    prof = probe.profile_rows(raw.decode(), ";", comuna_col="COMUNA_RESIDENCIA", ref_cuts={"13101"})
    assert prof["sample_rows"] == 10
    assert prof["comuna_masked_asterisk"] == {"rows": 3, "ratio": 0.3}
    assert prof["comuna_codes_not_in_reference"] == {"99999": 1}


def test_zip_truncado_se_descomprime_hasta_donde_alcanza():
    import random
    rnd = random.Random(7)          # datos poco compresibles: así 2 KB de zip NO alcanzan para todo el contenido
    big = "\n".join(f"SNSS;MUJER;{rnd.randrange(10**9)};13101;1;2024;A{rnd.randrange(10**6)};3;1" for i in range(5000)).encode()
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("EGR.csv", b"H1;H2;H3;COMUNA_RESIDENCIA;P;A;D;E;C\n" + big, compress_type=zipfile.ZIP_DEFLATED)
    cut = b.getvalue()[:2000]                                       # solo el principio del zip
    _, raw = probe.inflate_entry_head(cut)
    assert 0 < len(raw) < len(big) and raw.startswith(b"H1;H2")      # se obtuvo una parte, no todo


def test_read_zip_directory_rechaza_basura():
    with pytest.raises(ValueError):
        probe.read_zip_directory(b"no es un zip", 12)


def test_tramos_isapre_cubren_los_grupos_de_egreso_sin_partir_ninguno():
    bands = ["0-4", "5-9"] + [f"{a}-{a + 4}" for a in range(10, 100, 5)] + [">=100"]
    assert set(bands) == set(probe.ISAPRE_TO_EGRESO)
    groups: dict[str, list[str]] = {}
    for b, g in probe.ISAPRE_TO_EGRESO.items():
        groups.setdefault(g, []).append(b)
    assert groups["0 a 9"] == ["0-4", "5-9"] and groups["90 y más"] == ["90-94", "95-99", ">=100"]
    assert all(len(v) == 2 for g, v in groups.items() if g not in ("90 y más",))


# --- fuentes contra el servidor falso ---------------------------------------------------------------------------------------
def test_probe_est_completo_mide_cerrados_complejidad_y_coordenadas(env, tmp_path):
    rep = probe.probe_est(probe.Client(pause=0), tmp_path, full=True)
    assert rep["rows"] == 3 and rep["sin_coordenadas"]["rows"] == 1
    assert rep["package"]["license_id"] == "cc-zero"
    assert rep["EstadoFuncionamiento"]["Cerrado"] == 1 and rep["comunas_distintas"] == 2
    assert rep["NivelComplejidadEstabGlosa"][""] == 1 and rep["sha256"]


def test_probe_est_parcial_no_calcula_hash_ni_totales(env, tmp_path):
    rep = probe.probe_est(probe.Client(pause=0), tmp_path, full=False)
    assert rep["sha256"] is None and "rows" not in rep and rep["sample_rows"] >= 1


def test_probe_egresos_detecta_que_no_hay_columna_de_establecimiento(env, tmp_path):
    rep = probe.probe_egresos(probe.Client(pause=0), tmp_path, [2024, 1999])
    y = rep["years"][2024]["sample"]
    assert y["has_establishment_column"] is False and y["comuna_masked_asterisk"]["ratio"] == 0.3
    assert [e["name"] for e in rep["years"][2024]["entries"]][0] == "Diccionario.xlsx"
    assert "sample" not in rep["years"][1999] and rep["years"][1999]["head"]["status"] == 404
    assert rep["url_pattern_status"].startswith("[NO COMPROBADO")


def test_probe_egresos_marca_establecimiento_si_existe_la_columna(monkeypatch, tmp_path):
    prof = probe.profile_rows("COD_ESTABLECIMIENTO;COMUNA_RESIDENCIA\n101;13101\n", ";", comuna_col="COMUNA_RESIDENCIA")
    assert "COD_ESTABLECIMIENTO" in prof["columns"]


# --- XLSX de la Superintendencia (sintético) ---------------------------------------------------------------------------------
def _xlsx(tmp_path, pais_total):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Total Cotizantes"
    ws.append([None])
    ws.append(["Región", None, "Nombre Provincia", "Nombre Comuna", "N° Cotizantes"])
    ws.append(["N°", "Nombre", None, None, "0-4", "5-9", "Total"])
    ws.append([15, "Región A", "Prov", "Arica     ", 3, 2, 5])
    ws.append([15, "Región A", "Prov", "Sin dato Comuna", 1, 0, 1])
    ws.append(["-", "Total Pais", "-", "-", 4, 2, pais_total])
    p = tmp_path / "isapre.xlsx"
    wb.save(p)
    return p


def test_isapre_xlsx_cuadra_y_detecta_sin_dato(tmp_path):
    rep = probe.analyze_isapre_xlsx(_xlsx(tmp_path, 6))["Total Cotizantes"]
    assert rep["cuadra"] is True and rep["sum_comunas"] == 6 and rep["sin_dato_comuna"] == 1


def test_isapre_xlsx_no_cuadra_si_el_total_publicado_difiere(tmp_path):
    assert probe.analyze_isapre_xlsx(_xlsx(tmp_path, 7))["Total Cotizantes"]["cuadra"] is False


# --- CLI ------------------------------------------------------------------------------------------------------------------------
def test_cli_escribe_informe_y_resumen_y_no_cae_si_una_fuente_falla(env, tmp_path, monkeypatch):
    monkeypatch.setenv("PROBE_FONASA", "http://127.0.0.1:1")      # host caído a propósito
    rc = probe.main(["--out", str(tmp_path / "o"), "--only", "est,fonasa", "--pause", "0"])
    rep = json.loads((tmp_path / "o" / "report.json").read_text())
    assert rc == 0 and "est" in rep and "fonasa" in rep
    assert (tmp_path / "o" / "RESUMEN.md").read_text().startswith("# Resumen")
    assert all("authorization" not in json.dumps(e).lower() for e in rep["http_log"])    # el informe no lleva credenciales


def test_parse_years():
    assert probe.parse_years("2019-2021") == [2019, 2020, 2021] and probe.parse_years("2024") == [2024]
