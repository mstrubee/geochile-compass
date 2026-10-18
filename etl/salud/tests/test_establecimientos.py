"""ETL de establecimientos (Fase 1a). DATOS 100 % SINTÉTICOS (códigos 9xxxxx, nombres «FIXTURE …»): reproducen la ESTRUCTURA y las rarezas del
registro real (docs/salud/HALLAZGOS_FASE0.md) sin redistribuir filas reales. Las cifras reales se verifican en el informe de la fase, no aquí.

La prueba de carga contra Postgres (TEST_DATABASE_URL) corre solo si la base se llama *test* y ya tiene aplicada 20261102000000_health_establishments.
"""
import json
import os
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

ETL = Path(__file__).resolve().parents[2]
ROOT = ETL.parent
sys.path.insert(0, str(ETL))
sys.dont_write_bytecode = True

from salud import establecimientos as est  # noqa: E402
from salud import runner  # noqa: E402

COMUNAS = {"13101": "Santiago", "05201": "Isla de Pascua", "12202": "Antartica", "05103": "Concon"}


def row(**kw) -> dict:
    base = {c: "" for c in est.EXPECTED_COLUMNS}
    base.update(EstablecimientoCodigo="900001", EstablecimientoGlosa="FIXTURE 900001", RegionCodigo="13", ComunaCodigo="13101", ComunaGlosa="Santiago",
              TipoEstablecimientoGlosa="Hospital", DependenciaAdministrativa="Servicio de Salud", EstadoFuncionamiento="Vigente en Operación Habitual",
              NivelComplejidadEstabGlosa="Alta Complejidad", TipoAtencionEstabGlosa="Atención Cerrada-Hospitalaria",
              TipoPertenenciaEstabGlosa="Perteneciente al Sistema Nacional de Servicios de Salud", TieneServicioUrgencia="SI",
              Latitud="-33.45", Longitud="-70.65", TipoViaGlosa="Calle", NombreVia="Falsa", Numero="123")
    base.update(kw)
    return base


def csv_bytes(rows: list[dict], bom=True, cols=None) -> bytes:
    cols = cols or est.EXPECTED_COLUMNS
    lines = [";".join(cols)] + [";".join(r.get(c, "") for c in cols) for r in rows]
    return (("﻿" if bom else "") + "\n".join(lines) + "\n").encode("utf-8")


def tx(rows):
    return est.transform(rows, set(COMUNAS), COMUNAS)


# ------------------------------------------------------------------------------------------------ lectura
def test_parse_csv_bom_and_columns():
    got = est.parse_csv(csv_bytes([row()]))
    assert len(got) == 1 and got[0]["EstablecimientoCodigo"] == "900001"
    assert len(est.parse_csv(csv_bytes([row()], bom=False))) == 1


def test_parse_csv_missing_column_is_structure_error():
    cols = [c for c in est.EXPECTED_COLUMNS if c != "ComunaCodigo"]
    with pytest.raises(est.StructureError, match="ComunaCodigo"):
        est.parse_csv(csv_bytes([row()], cols=cols))


def test_parse_csv_extra_column_is_ignored():
    cols = est.EXPECTED_COLUMNS + ["ColumnaNueva"]
    got = est.parse_csv(csv_bytes([dict(row(), ColumnaNueva="x")], cols=cols))
    assert len(got) == 1


def test_filename_date_and_parsers():
    assert str(est.date_from_filename("establecimientos_20261014.csv")) == "2026-10-14"
    assert est.date_from_filename("est.csv") is None and est.date_from_filename("x_20261345.csv") is None
    assert str(est.parse_date("05-08-2012")) == "2012-08-05" and est.parse_date("2012-08-05") is None and est.parse_date("31-02-2020") is None
    assert est.parse_float("-33,45") == -33.45 and est.parse_float("abc") is None and est.parse_float("nan") is None


# ------------------------------------------------------------------------------------------------ normalización explícita
def test_state_normalization_covers_both_capitalizations():
    r = tx([row(EstablecimientoCodigo="900001", EstadoFuncionamiento="Vigente en Operación Habitual"),
            row(EstablecimientoCodigo="900002", EstadoFuncionamiento="Vigente en operación habitual"),
            row(EstablecimientoCodigo="900003", EstadoFuncionamiento="Cerrado", FechaCierre="17-07-2023")])
    assert [x[est.C["estado"]] for x in r.rows] == ["vigente", "vigente", "cerrado"]
    assert str(r.rows[2][est.C["fecha_cierre"]]) == "2023-07-17"


def test_complejidad_blank_is_sin_dato_not_baja_or_no_aplica():
    r = tx([row(EstablecimientoCodigo="900001", NivelComplejidadEstabGlosa=""), row(EstablecimientoCodigo="900002", NivelComplejidadEstabGlosa="No Aplica"),
            row(EstablecimientoCodigo="900003", NivelComplejidadEstabGlosa="Baja Complejidad")])
    assert [x[est.C["complejidad"]] for x in r.rows] == ["sin_dato", "no_aplica", "baja"]


def test_truncated_tipo_atencion_is_explicit_equivalence_and_counted():
    r = tx([row(TipoAtencionEstabGlosa="Atención Abierta-Ambu")])
    assert r.rows[0][est.C["tipo_atencion"]] == "ambulatoria"
    assert r.stats["counters"]["tipo_atencion_truncada_equivalida"] == 1


def test_dependencia_typo_gendameria_maps_and_is_counted():
    r = tx([row(DependenciaAdministrativa="Gendamería"), row(EstablecimientoCodigo="900002", DependenciaAdministrativa="")])
    assert [x[est.C["dependencia_norm"]] for x in r.rows] == ["gendarmeria", "sin_dato"]
    assert r.stats["counters"]["dependencia_con_errata_equivalida"] == 1


def test_snss_both_capitalizations():
    r = tx([row(TipoPertenenciaEstabGlosa="No Perteneciente al Sistema Nacional de Servicios de Salud"),
            row(EstablecimientoCodigo="900002", TipoPertenenciaEstabGlosa="No perteneciente al Sistema Nacional de Servicios de Salud"),
            row(EstablecimientoCodigo="900003", TipoPertenenciaEstabGlosa="No Aplica")])
    assert [x[est.C["snss"]] for x in r.rows] == [False, False, None]


def test_closed_without_date_is_reported_not_invented():
    r = tx([row(EstadoFuncionamiento="Cerrado", FechaCierre="")])
    assert r.rows[0][est.C["fecha_cierre"]] is None and r.stats["counters"]["cerrado_sin_fecha_cierre"] == 1


def test_comuna_glosa_mismatch_is_reported_not_corrected():
    r = tx([row(ComunaCodigo="05103", RegionCodigo="05", ComunaGlosa="Con Con")])
    assert r.rows[0][est.C["comuna_cut"]] == "05103" and r.rows[0][est.C["comuna_glosa"]] == "Con Con"
    assert r.stats["counters"]["glosa_comuna_distinta"] == 1


def test_coordinates_present_missing_and_unreadable():
    r = tx([row(EstablecimientoCodigo="900001", Latitud="", Longitud=""), row(EstablecimientoCodigo="900002", Latitud="abc", Longitud="-70"),
            row(EstablecimientoCodigo="900003", Latitud="0", Longitud="0")])
    assert [x[est.C["coords_present"]] for x in r.rows] == [False, True, True]
    assert r.rows[1][est.C["lat_raw"]] is None and r.rows[2][est.C["lat_raw"]] == 0
    assert r.stats["counters"]["sin_coordenadas"] == 1 and r.stats["counters"]["coordenada_ilegible"] == 1


# ------------------------------------------------------------------------------------------------ rechazos con código y cuadre
def test_rejections_have_codes_and_rows_balance():
    rows = [row(EstablecimientoCodigo="900001"),
            row(EstablecimientoCodigo="900001"),                                         # duplicate_key
            row(EstablecimientoCodigo="abc"),                                            # other (codigo_invalido)
            row(EstablecimientoCodigo="900003", ComunaCodigo="9999"),                    # cut_unknown
            row(EstablecimientoCodigo="900004", ComunaCodigo="1x101"),                   # cut_invalid
            row(EstablecimientoCodigo="900005", RegionCodigo="01"),                      # other (region_no_coincide)
            row(EstablecimientoCodigo="900006", EstadoFuncionamiento="En construcción"), # other (estado_desconocido)
            row(EstablecimientoCodigo="900007", DependenciaAdministrativa="Marciana"),   # other (dependencia_desconocida)
            row(EstablecimientoCodigo="900008", EstablecimientoGlosa=""),                # other (nombre_o_tipo_vacio)
            row(EstablecimientoCodigo="900009", NivelComplejidadEstabGlosa="Ultra")]     # other (complejidad_desconocida)
    r = tx(rows)
    codes = [x.code for x in r.rejections]
    assert codes == ["duplicate_key", "other", "cut_unknown", "cut_invalid", "other", "other", "other", "other", "other"]
    assert {x.code for x in r.rejections} <= {"cut_invalid", "cut_unknown", "duplicate_key", "other"}   # todos válidos en geo_rejected_rows
    assert r.stats["rows_file"] == r.stats["accepted"] + r.stats["rejected"] == 10
    assert "region_no_coincide" in r.rejections[4].detail and "dependencia_desconocida" in r.rejections[6].detail
    assert [x.oid for x in r.rejections][:2] == [3, 4]                                  # línea del archivo (encabezado = 1)


def test_comunas_without_establishments_are_listed():
    r = tx([row()])
    assert r.stats["comunas_without"] == ["05103", "05201", "12202"] and r.stats["comunas_with_establishments"] == 1


# ------------------------------------------------------------------------------------------------ clasificación y definiciones D1/D2
def test_classification_official_wins_and_table_only_fills():
    tipos = est.load_tipos()
    rows = [row(EstablecimientoCodigo="900001", TipoEstablecimientoGlosa="Centro de Salud Privado", TipoAtencionEstabGlosa="Atención Cerrada-Hospitalaria",
                NivelComplejidadEstabGlosa="Baja Complejidad"),                                # oficial hospitalario aunque la tabla diga ambulatorio
            row(EstablecimientoCodigo="900002", TipoEstablecimientoGlosa="Centro de Salud Privado", TipoAtencionEstabGlosa="", NivelComplejidadEstabGlosa="Baja Complejidad"),
            row(EstablecimientoCodigo="900003", TipoEstablecimientoGlosa="Clínica", TipoAtencionEstabGlosa="", NivelComplejidadEstabGlosa="Baja Complejidad"),
            row(EstablecimientoCodigo="900004", TipoEstablecimientoGlosa="Laboratorio  Clínico", TipoAtencionEstabGlosa="No Aplica", NivelComplejidadEstabGlosa="No Aplica")]
    c = est.classify(tx(rows).rows, tipos)["counts"]
    assert c["clase_fuente:oficial"] == 1 and c["clase_fuente:tabla"] == 2 and c["clase_fuente:sin_clasificar"] == 1     # Clínica sin dato NO se imputa
    assert c["vigente_clase_servicio:hospitalario"] == 1 and c["vigente_clase_servicio:ambulatorio"] == 2


def test_alta_complejidad_two_definitions_and_the_leftover():
    tipos = est.load_tipos()
    mk = lambda code, tipo, estado="Vigente en Operación Habitual": row(EstablecimientoCodigo=code, TipoEstablecimientoGlosa=tipo, EstadoFuncionamiento=estado)  # noqa: E731
    rows = [mk("900001", "Hospital"), mk("900002", "Hospital", "Cerrado"), mk("900003", "Clínica"), mk("900004", "Centro de Especialidades"),
            mk("900005", "Otro"), mk("900006", "Centro de Regulación Médica de las Urgencias (SAMU)"),
            row(EstablecimientoCodigo="900007", TipoEstablecimientoGlosa="Hospital", NivelComplejidadEstabGlosa="Baja Complejidad")]
    c = est.classify(tx(rows).rows, tipos)["counts"]
    assert (c["alta_hospital_todos"], c["alta_hospital_vigentes"]) == (2, 1)
    assert (c["alta_ampliada_todos"], c["alta_ampliada_vigentes"]) == (4, 3)
    assert (c["alta_fuera_de_ambas_todos"], c["alta_fuera_de_ambas_vigentes"]) == (2, 2)      # Otro y SAMU: no se pierden, se informan aparte


def test_d2_privado_is_dependencia_not_tipo_sistema():
    rows = [row(EstablecimientoCodigo="900001", DependenciaAdministrativa="Privado", TipoSistemaSaludGlosa="Público", TipoEstablecimientoGlosa="Centro de Salud Privado",
                TipoAtencionEstabGlosa="Atención Abierta-Ambulatoria"),
            row(EstablecimientoCodigo="900002", DependenciaAdministrativa="Municipal", TipoSistemaSaludGlosa="Privado", TipoEstablecimientoGlosa="Centro de Salud Privado",
                TipoAtencionEstabGlosa="Atención Abierta-Ambulatoria")]
    assert est.classify(tx(rows).rows, est.load_tipos())["counts"]["ambulatorio_privado_vigentes"] == 1


def test_unknown_tipo_is_reported():
    out = est.classify(tx([row(TipoEstablecimientoGlosa="Tipo Nuevo")]).rows, est.load_tipos())
    assert out["tipos_sin_clasificar"] == {"Tipo Nuevo": 1}


def test_tipo_norm_matches_the_database_rule():
    assert est.tipo_norm("  Sala  Externa de Toma de Muestras (SETM) ") == "sala externa de toma de muestras (setm)"
    assert est.tipo_norm("Clínica") == "clínica"                                  # conserva la tilde, como lower(regexp_replace(btrim(x),'\\s+',' '))


def test_tipos_json_is_the_migration_seed():
    sql = (ROOT / "supabase/migrations/20261102000000_health_establishments.sql").read_text(encoding="utf-8")
    blk = sql.split("insert into public.health_tipo_clasificacion", 1)[1].split("on conflict", 1)[0]
    seed = {t: (c, a == "true", b == "true") for t, _l, c, a, b in re.findall(r"\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(true|false),\s*(true|false),", blk)}
    got = {k: (v["clase"], v["alta_hospital"], v["alta_ampliada"]) for k, v in est.load_tipos().items()}
    assert got == seed and len(seed) == 29


# ------------------------------------------------------------------------------------------------ geografía (shapely, polígonos sintéticos)
def test_geocheck_statuses_and_special_cases():
    shapely_geom = pytest.importorskip("shapely.geometry")
    box = shapely_geom.box
    # 13101: cuadrado de ~1 km de lado cerca de Santiago; 05201: cuadradito en el mar; 12202 sin polígono; 05103 otra comuna pegada al sur de 13101
    polys = {"13101": box(-70.66, -33.46, -70.65, -33.45), "05201": box(-109.5, -27.2, -109.49, -27.19), "05103": box(-70.66, -33.47, -70.65, -33.4601)}
    rows_in = [row(EstablecimientoCodigo="900001", Latitud="-33.455", Longitud="-70.655"),                                     # dentro
               row(EstablecimientoCodigo="900002", Latitud="-33.455", Longitud="-70.6465"),                                    # ~325 m al este → borde
               row(EstablecimientoCodigo="900003", Latitud="-33.465", Longitud="-70.655"),                                     # ~555 m al sur, DENTRO de otra comuna → fuera_declarada (no costero)
               row(EstablecimientoCodigo="900004", ComunaCodigo="05201", RegionCodigo="05", Latitud="-27.195", Longitud="-109.4865"),   # mar, ~345 m → borde
               row(EstablecimientoCodigo="900005", ComunaCodigo="05201", RegionCodigo="05", Latitud="-27.185", Longitud="-109.495"),    # mar, ~555 m, en ninguna comuna → costero
               row(EstablecimientoCodigo="900006", ComunaCodigo="05201", RegionCodigo="05", Latitud="-27.0", Longitud="-109.495"),      # mar, ~21 km → fuera_declarada
               row(EstablecimientoCodigo="900007", ComunaCodigo="12202", RegionCodigo="12", Latitud="-62.2", Longitud="-58.9"),         # sin polígono
               row(EstablecimientoCodigo="900008", Latitud="0", Longitud="0"),                                                 # inválida
               row(EstablecimientoCodigo="900009", Latitud="-70", Longitud="-33"),                                             # lat/lon invertidas → inválida
               row(EstablecimientoCodigo="900010", Latitud="", Longitud="")]                                                   # sin coordenadas
    res = tx(rows_in)
    g = est.geocheck(res.rows, polys, 500.0, 2000.0)
    s = g["by_status"]
    assert s == {"dentro": 1, "borde": 2, "costero": 1, "fuera_declarada": 2, "sin_coordenadas": 1, "comuna_sin_poligono": 1, "coordenada_invalida": 2}
    assert sum(s.values()) == len(rows_in)
    ex = {x["codigo"]: x for x in g["examples_fuera_declarada"]}
    assert ex["900003"]["en_otra_comuna"] is True and ex["900006"]["en_otra_comuna"] is False
    assert "05201 Isla de Pascua" in g["special_cases"] and "12202 Antártica" in g["special_cases"]
    assert g["special_cases"]["12202 Antártica"] == {"comuna_sin_poligono": 1}
    assert g["special_cases"]["05201 Isla de Pascua"] == {"borde": 1, "costero": 1, "fuera_declarada": 1}


def test_geocheck_coast_buffer_is_configurable():
    shapely_geom = pytest.importorskip("shapely.geometry")
    polys = {"05201": shapely_geom.box(-109.5, -27.2, -109.49, -27.19)}
    res = tx([row(ComunaCodigo="05201", RegionCodigo="05", Latitud="-27.175", Longitud="-109.495")])
    assert est.geocheck(res.rows, polys, 500.0, 2000.0)["by_status"] == {"costero": 1}
    assert est.geocheck(res.rows, polys, 500.0, 1000.0)["by_status"] == {"fuera_declarada": 1}


# ------------------------------------------------------------------------------------------------ fuente: CKAN y descarga
class _H(BaseHTTPRequestHandler):
    CSV = csv_bytes([row()])

    def log_message(self, *a):
        pass

    def do_GET(self):
        base = f"http://127.0.0.1:{self.server.server_port}"
        if self.path.startswith("/api/3/action/package_show"):
            body = json.dumps({"success": True, "result": {"resources": [
                {"name": "establecimientos_20250101.csv", "format": "CSV", "url": base + "/old.csv", "last_modified": "2025-01-01T00:00:00"},
                {"name": "establecimientos_20261014.csv", "format": "CSV", "url": base + "/establecimientos_20261014.csv", "last_modified": "2026-10-14T19:02:46"},
                {"name": "diccionario.pdf", "format": "PDF", "url": base + "/dicc.pdf", "last_modified": "2027-01-01T00:00:00"}]}}).encode()
            ctype = "application/json"
        elif self.path.endswith(".csv"):
            body, ctype = self.CSV, "text/csv"
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", "Wed, 14 Oct 2026 19:02:46 GMT"); self.end_headers(); self.wfile.write(body)


@pytest.fixture
def http_server(monkeypatch):
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    srv = HTTPServer(("127.0.0.1", 0), _H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_ckan_latest_picks_newest_csv_ignoring_other_formats(http_server):
    url, modified = runner.latest_from_ckan(f"{http_server}/api/3/action/package_show?id=x")
    assert url.endswith("establecimientos_20261014.csv") and modified.startswith("2026-10-14")


def test_fetch_source_url_records_declared_date_and_method(http_server):
    args = SimpleNamespace(file=None, url=f"{http_server}/establecimientos_20261014.csv", ckan_latest=False, ckan_url=None, origin_url=None)
    raw, name, origin, declared, method = runner.fetch_source(args)
    assert raw == _H.CSV and name == "establecimientos_20261014.csv" and origin.endswith(name) and method == "automatic_download"
    assert str(declared[0]) == "2026-10-14" and "Last-Modified" in declared[1]


def test_fetch_source_file_is_manual_download(tmp_path):
    p = tmp_path / "establecimientos_20261014.csv"
    p.write_bytes(_H.CSV)
    args = SimpleNamespace(file=str(p), url=None, ckan_latest=False, ckan_url=None, origin_url="https://example.test/x.csv")
    raw, name, origin, declared, method = runner.fetch_source(args)
    assert method == "manual_download" and origin == "https://example.test/x.csv" and str(declared[0]) == "2026-10-14"


# ------------------------------------------------------------------------------------------------ CLI (subproceso)
def run_cli(args, env_extra=None):
    env = {k: v for k, v in os.environ.items() if k not in ("SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-B", str(ETL / "salud_establecimientos.py"), *args], capture_output=True, text=True, env=env, timeout=120)


def tree():
    return sorted(str(p) for p in ETL.rglob("*") if p.is_file() and "__pycache__" not in str(p) and ".pytest_cache" not in str(p))


def test_cli_dry_run_ok_and_writes_nothing(tmp_path):
    p = tmp_path / "establecimientos_20261014.csv"
    p.write_bytes(csv_bytes([row(EstablecimientoCodigo="900001"), row(EstablecimientoCodigo="900002", EstadoFuncionamiento="Cerrado", NivelComplejidadEstabGlosa="No Aplica")]))
    before = tree()
    r = run_cli(["--dry-run", "--file", str(p), "--no-geocheck"])
    assert r.returncode == 0, r.stderr
    assert "DRY-RUN (no se escribe NADA" in r.stdout and "✔ cuadra" in r.stdout and "LISTO para cargar" in r.stdout
    assert "decisión de diseño" in r.stdout and "D1: dos definiciones" in r.stdout and "CC0" in r.stdout
    assert tree() == before, "el dry-run no debe escribir archivos"


def test_cli_json_is_parseable(tmp_path):
    p = tmp_path / "establecimientos_20261014.csv"
    p.write_bytes(csv_bytes([row()]))
    r = run_cli(["--dry-run", "--file", str(p), "--json", "--no-geocheck"])
    assert r.returncode == 0, r.stderr
    s = json.loads(r.stdout)
    assert s["ready"] and s["stats"]["accepted"] == 1 and len(s["sha256"]) == 64 and s["geocheck_skipped"] == "--no-geocheck"


def test_cli_exit_codes(tmp_path):
    bad = tmp_path / "e.csv"
    bad.write_bytes(csv_bytes([row()], cols=[c for c in est.EXPECTED_COLUMNS if c != "Latitud"]))
    assert run_cli(["--dry-run", "--file", str(bad)]).returncode == 2                      # estructura
    tipo = tmp_path / "t.csv"
    tipo.write_bytes(csv_bytes([row(TipoEstablecimientoGlosa="Tipo Nuevo")]))
    r = run_cli(["--dry-run", "--file", str(tipo), "--no-geocheck"])
    assert r.returncode == 2 and "no conoce" in r.stdout                                    # tipo desconocido detiene
    rej = tmp_path / "r.csv"
    rej.write_bytes(csv_bytes([row(EstablecimientoCodigo="abc")] + [row(EstablecimientoCodigo=f"9{n:05d}") for n in range(1, 50)]))
    assert run_cli(["--dry-run", "--file", str(rej), "--no-geocheck"]).returncode == 5      # 1 de 50 rechazada = 2 % > 0,5 %
    assert run_cli(["--dry-run", "--file", str(tmp_path / "no_existe.csv")]).returncode == 3  # la fuente falla
    empty = tmp_path / "v.csv"
    empty.write_bytes(csv_bytes([]))
    assert run_cli(["--dry-run", "--file", str(empty), "--no-geocheck"]).returncode == 2


# ------------------------------------------------------------------------------------------------ carga real (base de PRUEBA)
URL = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(scope="module")
def conn():
    if not URL:
        pytest.skip("define TEST_DATABASE_URL (base de PRUEBA con 20261102000000 aplicada)")
    import psycopg
    c = psycopg.connect(URL, autocommit=True)
    name = c.execute("select current_database()").fetchone()[0]
    if "test" not in name:
        pytest.skip(f"la base {name!r} no parece de prueba: no se toca")
    if c.execute("select to_regclass('public.health_establishments')").fetchone()[0] is None:
        pytest.skip("la base no tiene aplicada 20261102000000_health_establishments")
    c.execute("truncate public.health_establishments_stage, public.health_establishments")
    c.execute("delete from public.source_checks where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos')")
    c.execute("delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos')")
    yield c
    c.close()


def load(path, tmp_path, *extra):
    return run_cli(["--file", str(path), "--no-storage", *extra], {"SUPABASE_DB_URL": URL, "SALUD_OUT_DIR": str(tmp_path / "out")})


def test_load_end_to_end_idempotent_and_replacement(conn, tmp_path):
    rows1 = [row(EstablecimientoCodigo="900001"), row(EstablecimientoCodigo="900002", EstadoFuncionamiento="Cerrado", NivelComplejidadEstabGlosa="Baja Complejidad"),
             row(EstablecimientoCodigo="900003", TipoEstablecimientoGlosa="Centro de Salud Privado", TipoAtencionEstabGlosa="", DependenciaAdministrativa="Privado",
                 NivelComplejidadEstabGlosa="Baja Complejidad", Latitud="", Longitud=""),
             row(EstablecimientoCodigo="900004", ComunaCodigo="12202", RegionCodigo="12", ComunaGlosa="Antártica", Latitud="-62.2", Longitud="-58.9")]
    p1 = tmp_path / "establecimientos_20261014.csv"
    p1.write_bytes(csv_bytes(rows1))
    r = load(p1, tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert '"result": "published"' in r.stdout
    got = {c: (e, g, cf) for c, e, g, cf in conn.execute(
        "select code, estado, geo_status, clase_fuente from public.health_establishments order by code").fetchall()}
    assert got == {"900001": ("vigente", 0, "oficial"), "900002": ("cerrado", 0, "oficial"),
                   "900003": ("vigente", 4, "tabla"), "900004": ("vigente", 5, "oficial")}
    assert conn.execute("select count(*) from public.health_establishments_stage").fetchone()[0] == 0
    snap = conn.execute("select status, row_count_raw, rejected_count, capture_method, original_filename, declared_date from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos')").fetchall()
    assert snap == [("loaded", 4, 0, "manual_download", "establecimientos_20261014.csv", __import__("datetime").date(2026, 10, 14))]
    # mismo archivo → ya cargado, sin tocar nada
    r = load(p1, tmp_path)
    assert r.returncode == 0 and '"result": "already_loaded"' in r.stdout
    assert conn.execute("select count(*) from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos')").fetchone()[0] == 1
    # archivo nuevo → reemplaza (retención 1): el anterior queda superseded y sin filas
    p2 = tmp_path / "establecimientos_20261115.csv"
    p2.write_bytes(csv_bytes(rows1 + [row(EstablecimientoCodigo="900005")]))
    r = load(p2, tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert conn.execute("select status, count(*) from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos') group by 1 order by 1").fetchall() == [("loaded", 1), ("superseded", 1)]
    assert conn.execute("select count(*) from public.health_establishments").fetchone()[0] == 5


def test_load_keeps_rejections_with_codes(conn, tmp_path):
    conn.execute("update public.pipeline_settings set value = 0.5 where key = 'publish.max_reject_ratio'")
    try:
        p = tmp_path / "establecimientos_20261201.csv"
        p.write_bytes(csv_bytes([row(EstablecimientoCodigo="900010"), row(EstablecimientoCodigo="900011", ComunaCodigo="99999")]))
        r = load(p, tmp_path)
        assert r.returncode == 0, r.stdout + r.stderr
        rej = conn.execute("""select g.reason_code, g.row_ref ->> 'line' from public.geo_rejected_rows g
                              join public.source_snapshots s on s.id = g.snapshot_id where s.original_filename = 'establecimientos_20261201.csv'""").fetchall()
        assert rej == [("cut_unknown", "3")]
    finally:
        conn.execute("update public.pipeline_settings set value = 0.005 where key = 'publish.max_reject_ratio'")
