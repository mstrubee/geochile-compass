"""Carga REAL de extremo a extremo (descarga HTTPS → validación → zona de paso → publish_*_snapshot) contra una base de PRUEBA
con las migraciones de las partes 1, 2 y 4 aplicadas y `comunas` sembrada. Datos: recortes reales servidos por el servidor falso.

  TEST_DATABASE_URL=postgresql://postgres:***@127.0.0.1/permtest python -m pytest etl/proyectos/tests/test_db.py

Solo corre si la base se llama *test* (limpia las tablas de la Parte 4).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import Faults

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="define TEST_DATABASE_URL (base de PRUEBA con las migraciones aplicadas)")
ETL = Path(__file__).resolve().parents[2]
KEYS = ("ine_pe_nacional", "ine_crf_nacional", "seia_proyectos_eia", "seia_proyectos_dia")


@pytest.fixture(scope="module")
def conn():
    import psycopg
    c = psycopg.connect(URL, autocommit=True)
    name = c.execute("select current_database()").fetchone()[0]
    if "test" not in name:
        pytest.skip(f"la base {name!r} no parece de prueba: no se toca")
    c.execute("""do $$ declare r record; begin
        for r in select inhrelid::regclass as t from pg_inherits where inhparent in ('public.ine_pe_points'::regclass, 'public.ine_crf_polygons'::regclass) loop
          execute 'drop table ' || r.t; end loop; end $$""")
    c.execute("truncate public.ine_pe_stage, public.ine_crf_stage, public.seia_stage, public.building_projects, public.building_project_geo_reviews")
    c.execute("delete from public.source_checks where source_id in (select id from public.data_sources where source_key = any(%s))", (list(KEYS),))
    c.execute("delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = any(%s))", (list(KEYS),))
    c.execute("update public.pipeline_settings set value = 0.05 where key = 'ine_points.max_outside_ratio'")
    yield c
    c.close()


@pytest.fixture
def env(tmp_path, tls_server):
    base, ca = tls_server
    return {"SUPABASE_DB_URL": URL, "REQUESTS_CA_BUNDLE": ca, "PROYECTOS_OUT_DIR": str(tmp_path)}, base


def run(script, args, env):
    e = {k: v for k, v in os.environ.items() if k not in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    e.update(env)
    return subprocess.run([sys.executable, "-B", str(ETL / script), *args], capture_output=True, text=True, env=e, timeout=300)


def result(r):
    return json.loads(r.stdout.split("RESULTADO: ", 1)[1].split("\n→", 1)[0].rsplit("\n\n", 1)[0] if "RESULTADO: " in r.stdout else "{}")


def q(conn, sql, *a):
    return conn.execute(sql, a or None).fetchall()


def test_ine_pe_full_load_republish_and_replace(conn, env):
    e, base = env
    args = ["--layer", "pe", "--no-storage", "--no-geocheck", "--pause", "0", "--base-url", f"{base}/ine"]
    r = run("proyectos_ine.py", args, e)
    assert r.returncode == 0, r.stdout[-800:] + r.stderr
    assert '"result": "published"' in r.stdout
    n1 = q(conn, "select n from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key = 'ine_pe_nacional' and s.status = 'loaded'")[0][0]
    assert q(conn, "select count(*) from public.ine_pe_points where snapshot_n = %s", n1)[0][0] == 300
    row = q(conn, """select capture_method, origin_url, declared_date::text, period_start::text, period_end::text, row_count_raw, rejected_count, note, storage_path
                       from public.source_snapshots where n = %s""", n1)[0]
    assert row[0] == "api" and row[1].startswith("https://") and row[1].endswith("/ine/1")
    assert row[2] == "2026-07-30", "declared_date = editingInfo.lastEditDate"
    assert (row[3], row[4]) == ("2012-01-01", "2025-12-31") and row[5] == 300 and row[6] == 0
    assert "NO SUBIDO" in row[7], "con --no-storage queda constancia en el snapshot (no se finge que se subió)"
    assert row[8].startswith("ine_pe_nacional/2026/") and row[8].endswith(".geojson.gz")
    assert q(conn, "select count(*) from public.ine_pe_stage")[0][0] == 0
    assert list(Path(e["PROYECTOS_OUT_DIR"]).glob("ine_pe_nacional_*.geojson.gz")), "queda copia local del original normalizado"

    # misma capa => no se duplica nada
    r2 = run("proyectos_ine.py", args, e)
    assert r2.returncode == 0 and "already_loaded" in r2.stdout
    assert q(conn, "select count(*) from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key = 'ine_pe_nacional'")[0][0] == 1
    assert q(conn, "select count(*) from public.source_checks c join public.data_sources d on d.id = c.source_id where d.source_key = 'ine_pe_nacional' and c.outcome = 'ok_same_content'")[0][0] == 1

    # la capa cambia (SINTÉTICO: +1 unidad en un registro) => nueva captura, la anterior se retira (keep = 1)
    Faults.bump_first = True
    r3 = run("proyectos_ine.py", args, e)
    Faults.bump_first = False
    assert r3.returncode == 0, r3.stdout[-800:] + r3.stderr
    assert q(conn, "select count(*) from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key = 'ine_pe_nacional'")[0][0] == 2
    assert q(conn, "select status from public.source_snapshots where n = %s", n1)[0][0] == "superseded"
    assert q(conn, "select to_regclass('public.ine_pe_points_p' || %s::text)", n1)[0][0] is None, "la partición vieja se soltó"
    assert q(conn, "select count(*) from public.ine_pe_points")[0][0] == 300
    assert q(conn, "select (validation_report -> 'publish' ->> 'inserted')::int, validation_report ->> 'server_count_before' from public.source_snapshots where status = 'loaded' and source_id = (select id from public.data_sources where source_key = 'ine_pe_nacional')")[0] == (300, "300")


def test_ine_pe_db_rejection_leaves_nothing_published(conn, env):
    e, base = env
    n_before = q(conn, "select count(*) from public.ine_pe_points")[0][0]
    conn.execute("update public.pipeline_settings set value = -1 where key = 'ine_points.max_outside_ratio'")   # SINTÉTICO: la base rechazará
    try:
        Faults.bump_first = 2          # otro cambio distinto al de la prueba anterior (hash nuevo)
        r = run("proyectos_ine.py", ["--layer", "pe", "--no-storage", "--no-geocheck", "--pause", "0", "--base-url", f"{base}/ine"], e)
    finally:
        Faults.bump_first = False
        conn.execute("update public.pipeline_settings set value = 0.05 where key = 'ine_points.max_outside_ratio'")
    assert r.returncode == 4 and "puntos fuera de su comuna" in r.stderr and "No quedó nada vigente" in r.stderr
    assert q(conn, "select count(*) from public.ine_pe_points")[0][0] == n_before, "la publicación es todo-o-nada"
    assert q(conn, "select count(*) from public.ine_pe_stage")[0][0] == 0, "la zona de paso se limpia"
    assert q(conn, "select status from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key = 'ine_pe_nacional' order by n desc limit 1")[0][0] == "rejected"


def test_ine_crf_full_load(conn, env):
    e, base = env
    r = run("proyectos_ine.py", ["--layer", "crf", "--no-storage", "--pause", "0", "--base-url", f"{base}/ine"], e)
    assert r.returncode == 0, r.stdout[-800:] + r.stderr
    n = q(conn, "select n from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key = 'ine_crf_nacional' and s.status = 'loaded'")[0][0]
    total = json.loads((ETL / "proyectos" / "tests" / "fixtures" / "ine_crf.geojson").read_text(encoding="utf-8"))["features"]
    assert q(conn, "select count(*) from public.ine_crf_polygons where snapshot_n = %s", n)[0][0] == len(total)
    assert q(conn, "select count(*) from public.ine_crf_polygons where snapshot_n = %s and comuna_cut !~ '^[0-9]{5}$'", n)[0][0] == 0
    assert q(conn, "select count(*) from public.ine_crf_polygons where snapshot_n = %s and geom_status = 0 and geom_original is null", n)[0][0] == len(total)


def test_seia_full_load_both_layers_and_praderas(conn, env):
    e, base = env
    r = run("proyectos_seia.py", ["--no-storage", "--no-geocheck", "--pause", "0", "--base-url", f"{base}/seia"], e)
    assert r.returncode == 0, r.stdout[-800:] + r.stderr
    assert r.stdout.count('"result": "published"') == 2
    assert q(conn, "select count(*) from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key like 'seia%' and s.status = 'loaded'")[0][0] == 2
    exc = q(conn, "select (validation_report ->> 'typology_excluded_count')::int, row_count_raw, rejected_count from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key = 'seia_proyectos_dia'")[0]
    assert q(conn, "select count(*) from public.building_projects where service_layer = 2")[0][0] + exc[0] + exc[2] == exc[1] == 140
    p = q(conn, "select geo_status, geo_distance_m > 1000, ST_Y(geom), comuna_cuts::text from public.building_projects where expediente_id = 2147600353")[0]
    assert p[0] == 2 and p[1] and abs(p[2] + 33.80201299999993) < 1e-9, "Praderas La Dehesa: outside_declared de punta a punta, con el punto original intacto"
    assert p[3] == "{13115}"
    assert q(conn, "select count(*) from public.seia_stage")[0][0] == 0
    assert q(conn, "select count(*) from public.building_projects where comuna_cuts = '{}'")[0][0] == q(conn, "select count(*) from public.building_projects where geo_status = 3")[0][0]
