"""Extremo a extremo contra una base REAL con las migraciones de permisos (1-3) y del SEIA aplicadas y `comunas` sembrada.

Solo corre si TEST_DATABASE_URL está definida Y el nombre de la base contiene 'test' (limpia las tablas del SEIA):

  TEST_DATABASE_URL=postgresql://postgres:***@127.0.0.1/seia_test python -m pytest etl/seia/tests/test_db.py

Los expedientes son SINTÉTICOS (ver conftest.py); las comunas y sus polígonos son los reales del repo.
"""
import json
import os

import pytest

import seia_proyectos as cli
from conftest import make_feature

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="define TEST_DATABASE_URL (base de PRUEBA con las migraciones aplicadas)")


@pytest.fixture
def conn(monkeypatch):
    import psycopg
    c = psycopg.connect(URL, autocommit=True)
    name = c.execute("select current_database()").fetchone()[0]
    if "test" not in name:
        pytest.skip(f"la base {name!r} no parece de prueba: no se toca")
    if c.execute("select count(*) from public.comunas where geom is not null").fetchone()[0] < 300:
        pytest.skip("falta sembrar comunas (python etl/permisos_comunas.py seed)")
    c.execute("""truncate public.seia_projects, public.seia_current_snapshot, public.seia_rejected_rows,
                 public.seia_project_geo_reviews, public.source_snapshots, public.source_checks, public.source_alerts
                 restart identity cascade""")
    c.execute("update public.pipeline_settings set value = 0.005 where key = 'publish.max_reject_ratio'")
    c.execute("update public.pipeline_settings set value = 2 where key = 'retention.keep_snapshots'")
    monkeypatch.setenv("SUPABASE_DB_URL", URL)
    yield c
    c.close()


def q(conn, sql, *a):
    return conn.execute(sql, a).fetchall()


def inside(conn, cut):
    """Un punto dentro de la comuna REAL (lon, lat)."""
    return conn.execute("select ST_X(p), ST_Y(p) from (select ST_PointOnSurface(geom) p from public.comunas where cut = %s) t", (cut,)).fetchone()


def dataset(conn, n=400):
    """n expedientes: la mayoría dentro de su comuna; casos de calidad conocidos; 1 sin ID (rechazado)."""
    lb, lc = inside(conn, "13115"), inside(conn, "13114")
    fs = []
    for i in range(1, n + 1):
        fs.append(make_feature(i, comunas="Lo Barnechea", lonlat=lb) if i % 2 else make_feature(i, comunas="Las Condes", lonlat=lc))
    fs[0] = make_feature(1, comunas="Lo Barnechea", lonlat=(lb[0], -33.80))                      # el caso reportado: punto fuera de su comuna
    fs[1] = make_feature(2, comunas="Comuna Inventada", lonlat=lc)                               # comuna sin cruzar
    fs[2] = make_feature(3, comunas="Lo Barnechea, Comuna Inventada", lonlat=lb)                 # una comuna sí y otra no
    fs[3] = make_feature(4, comunas="Las Condes", geometry=None)                                 # sin punto
    fs[4] = make_feature(5, comunas="Las Condes", lonlat=(-7050000, -3335000))                   # coordenadas en metros: sin punto, no se "arregla"
    fs[5] = make_feature(6, ID_EXPEDIENTE=None)                                                  # sin ID: se rechaza
    return fs


def run(fake, capsys, *extra):
    code = cli.main(["--base-url", fake.base, "--record-origin-base", "https://example.test/MapServer", "--pause", "0", "--layer", "dia",
                     "--no-storage", "--captured-by", "test", *extra])
    out = capsys.readouterr()
    return code, out.out, out.err


def test_carga_completa_publica_y_valida_la_geografia(conn, fake, capsys):
    fake.layers[2] = dataset(conn)
    fake.last_edit = 1760000000000
    code, out, err = run(fake, capsys)
    assert code == 5, out + err                                              # 5 = hubo rechazados (1 de 400, bajo el umbral): se cargó igual
    assert '"result": "published"' in out

    snap = q(conn, "select status, rejected_count, row_count_raw, declared_date, scope, granularity, capture_method, storage_path from public.source_snapshots")[0]
    assert snap[:7] == ("loaded", 1, 400, __import__("datetime").date(2025, 10, 9), "full", "snapshot", "api")
    assert snap[7].startswith("seia_proyectos_dia/") and snap[7].endswith(".seia.gz")
    assert q(conn, "select (validation_report ->> 'service_count')::int from public.source_snapshots")[0][0] == 400
    assert q(conn, "select count(*) from public.seia_projects")[0][0] == 399                                 # 400 − 1 rechazado
    assert q(conn, "select count(*) from public.seia_projects_current_v")[0][0] == 399
    st = dict(q(conn, "select geo_check_status, count(*) from public.seia_projects_current_v group by 1"))
    assert st == {"inside": 395, "outside_declared": 1, "comuna_unmatched": 1, "no_geometry": 2}, st
    one = lambda eid: q(conn, "select geo_check_status, geo_check_detail from public.seia_projects_current_v where external_id = %s", str(2000000000 + eid))[0]
    assert one(1)[0] == "outside_declared"                                                                  # caso Praderas La Dehesa
    assert one(3)[0] == "inside" and one(3)[1]["unresolved"] == ["Comuna Inventada"]                         # lo no resuelto se ve
    assert one(5)[0] == "no_geometry"                                                                       # coordenadas en metros: no se corrigen
    rej = q(conn, "select reason_code, row_ref ->> 'objectid' from public.seia_rejected_rows")
    assert rej == [("missing_id", "6")]
    assert q(conn, "select outcome from public.source_checks")[0][0] == "ok_new_data"
    # lo guardado en columnas no se repite en raw; el original (X/Y/NUEVO_X…) sí queda
    raw = q(conn, "select raw from public.seia_projects where external_id = %s", str(2000000010))[0][0]
    assert "NOMBRE_PROYECTO" not in raw and raw["X"] == raw["NUEVO_X"] and "OBJECTID" in raw
    row = q(conn, "select submitted_at, investment_usd, typology_letter, comuna_cuts, source_id = (select id from public.data_sources where source_key = 'seia_proyectos_dia') from public.seia_projects where external_id = %s", str(2000000010))[0]
    assert str(row[0]) == "2019-05-20" and str(row[1]) == "1000010.00" and row[2] == "h.1" and row[3] == ["13114"] and row[4]


def test_recargar_lo_mismo_no_duplica(conn, fake, capsys):
    fake.layers[2] = dataset(conn)
    run(fake, capsys)
    code, out, _ = run(fake, capsys)
    assert '"result": "already_loaded"' in out
    assert q(conn, "select count(*) from public.source_snapshots")[0][0] == 1
    assert q(conn, "select count(*) from public.seia_projects")[0][0] == 399
    assert [r[0] for r in q(conn, "select outcome from public.source_checks order by id")] == ["ok_new_data", "ok_same_content"]


def test_foto_nueva_mueve_el_puntero_y_la_purga_acota_el_espacio(conn, fake, capsys):
    base = dataset(conn)
    fake.layers[2] = base
    run(fake, capsys)
    # foto 2: desaparece un expediente y otro cambia de nombre
    fake.layers[2] = [f for f in base if f["id"] != 10]
    fake.layers[2][20] = make_feature(fake.layers[2][20]["id"], comunas="Lo Barnechea", lonlat=inside(conn, "13115"), NOMBRE_PROYECTO="RENOMBRADO")
    code, out, _ = run(fake, capsys)
    assert '"result": "published"' in out
    assert [r[0] for r in q(conn, "select status from public.source_snapshots order by n")] == ["superseded", "loaded"]
    assert q(conn, "select count(*) from public.seia_projects_current_v where external_id = %s", str(2000000010))[0][0] == 0     # ya no está en el servicio
    assert q(conn, "select count(*) from public.seia_projects where external_id = %s", str(2000000010))[0][0] == 1              # …pero su foto histórica se conserva (K = 2)
    assert q(conn, "select count(*) from public.seia_projects_current_v where name = 'RENOMBRADO'")[0][0] == 1
    assert q(conn, "select count(*) from public.seia_current_snapshot")[0][0] == 1
    # foto 3: con K = 2 la purga borra las filas de la primera, pero conserva su registro y su archivo
    fake.layers[2] = [f for f in base if f["id"] not in (10, 11)]
    run(fake, capsys)
    assert q(conn, "select count(*) from public.source_snapshots")[0][0] == 3
    assert q(conn, "select count(distinct snapshot_id) from public.seia_projects")[0][0] == 2
    assert q(conn, "select count(*) from public.seia_projects where external_id = %s", str(2000000010))[0][0] == 0


def test_no_cuadra_no_toca_la_base(conn, fake, capsys):
    fake.layers[2] = dataset(conn)
    fake.count_lie = 5
    code, out, _ = run(fake, capsys)
    assert code == 3 and "NO CUADRA" in out
    assert q(conn, "select count(*) from public.source_snapshots")[0][0] == 0
    assert q(conn, "select count(*) from public.seia_projects")[0][0] == 0


def test_servicio_caido_queda_registrado_para_la_alerta_de_frescura(conn, fake, capsys, monkeypatch):
    from seia import arcgis
    monkeypatch.setattr(arcgis.time, "sleep", lambda *_: None)
    fake.fail_status = 500
    code, _, err = run(fake, capsys)
    assert code == 4 and "NO SE PUDO CAPTURAR" in err
    r = q(conn, "select outcome, method, detail from public.source_checks")
    assert r[0][0] == "unreachable" and r[0][1] == "automatic" and "HTTP 500" in r[0][2]


def test_stage_only_deja_el_snapshot_validado_sin_cambiar_lo_vigente(conn, fake, capsys):
    fake.layers[2] = dataset(conn)
    code, out, _ = run(fake, capsys, "--stage-only")
    assert '"result": "staged"' in out
    assert q(conn, "select status from public.source_snapshots")[0][0] == "validated"
    assert q(conn, "select count(*) from public.seia_current_snapshot")[0][0] == 0
    assert q(conn, "select count(*) from public.seia_projects_current_v")[0][0] == 0         # nada se ve en el mapa
    assert q(conn, "select count(*) from public.seia_project_geo_checks")[0][0] == 399        # pero la validación ya corrió


def test_publicacion_rechazada_por_la_base_deja_rastro_y_se_puede_reintentar(conn, fake, capsys):
    fake.layers[2] = dataset(conn)
    # un error DENTRO de la publicación (aquí, la purga con una retención inválida) revierte también la publicación:
    # publicar y purgar van en la misma transacción
    conn.execute("update public.pipeline_settings set value = 0 where key = 'retention.keep_snapshots'")
    code, out, err = run(fake, capsys)
    assert code == 4 and "ERROR" in err
    assert q(conn, "select status from public.source_snapshots")[0][0] == "rejected"
    assert "retención" in q(conn, "select validation_report ->> 'publish_error' from public.source_snapshots")[0][0]
    assert q(conn, "select count(*) from public.seia_current_snapshot")[0][0] == 0                            # nada pasó a vigente
    assert q(conn, "select count(*) from public.seia_projects_current_v")[0][0] == 0
    assert q(conn, "select count(*) from public.seia_projects")[0][0] == 399                                   # las filas del intento siguen ahí…
    # …se corrige la causa y se reintenta con el MISMO contenido: reutiliza el snapshot rechazado (no choca con el hash único)
    conn.execute("update public.pipeline_settings set value = 2 where key = 'retention.keep_snapshots'")
    code, out, _ = run(fake, capsys)
    assert '"result": "published"' in out
    assert q(conn, "select count(*) from public.source_snapshots")[0][0] == 1
    assert q(conn, "select status from public.source_snapshots")[0][0] == "loaded"
    assert q(conn, "select count(*) from public.seia_projects")[0][0] == 399                                   # sin filas duplicadas del intento fallido
    assert q(conn, "select count(*) from public.seia_rejected_rows")[0][0] == 1


def test_el_etl_respeta_el_umbral_de_rechazo_de_la_base_y_no_intenta_cargar(conn, fake, capsys):
    fake.layers[2] = dataset(conn)
    conn.execute("update public.pipeline_settings set value = 0 where key = 'publish.max_reject_ratio'")     # la base no tolera ni 1 rechazo
    code, out, _ = run(fake, capsys)
    assert code == 5 and "NO SE CARGA" in out and "tasa de rechazo" in out
    assert q(conn, "select count(*) from public.source_snapshots")[0][0] == 0


def test_alias_de_la_fuente_resuelve_comunas_desde_la_base(conn, fake, capsys):
    lb = inside(conn, "13115")
    fs = dataset(conn)
    fs[1] = make_feature(2, comunas="Barnechea", lonlat=lb)                                                    # variante que no es un nombre oficial
    fake.layers[2] = fs
    conn.execute("""insert into public.comuna_name_aliases (source_id, raw_region_norm, raw_name_norm, cut, reason)
                    select id, '', 'barnechea', '13115', 'SINTETICO: variante del nombre' from public.data_sources where source_key = 'seia_proyectos_dia'""")
    try:
        run(fake, capsys)
        assert q(conn, "select geo_check_status, comuna_cuts from public.seia_projects_current_v where external_id = %s", str(2000000002))[0] == ("inside", ["13115"])
    finally:
        conn.execute("delete from public.comuna_name_aliases where raw_name_norm = 'barnechea'")


def test_dry_run_con_db_es_de_solo_lectura(conn, fake, capsys):
    fake.layers[2] = dataset(conn)
    code, out, _ = run(fake, capsys, "--dry-run", "--db")
    assert code == 5 and "ENSAYO" in out
    assert q(conn, "select count(*) from public.source_snapshots")[0][0] == 0
    assert q(conn, "select count(*) from public.source_checks")[0][0] == 0
