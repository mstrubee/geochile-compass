"""CLI de punta a punta (subproceso) contra el servidor ArcGIS falso que sirve recortes REALES."""
import json
import os
import subprocess
import sys
from pathlib import Path

from conftest import Faults

ETL = Path(__file__).resolve().parents[2]


def run(script, args, env_extra=None):
    env = {k: v for k, v in os.environ.items() if k not in ("SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-B", str(ETL / script), *args], capture_output=True, text=True, env=env, timeout=120)


def snapshot_tree():
    return sorted(str(p) for p in ETL.rglob("*") if p.is_file() and "__pycache__" not in str(p) and ".pytest_cache" not in str(p)
                  and "output" in p.parts)


def test_ine_dry_run_ok_and_writes_nothing(server):
    before = snapshot_tree()
    r = run("proyectos_ine.py", ["--dry-run", "--base-url", f"{server}/ine", "--pause", "0"])
    assert r.returncode == 0, r.stderr
    out = r.stdout
    assert "DRY-RUN (no se escribe NADA" in out and out.count("VEREDICTO: LISTO PARA CARGAR") == 2
    assert "un registro NO es un permiso" in out and "obra TERMINADA, no un permiso" in out
    assert "por confirmar" in out                                   # licencia nunca inventada
    assert snapshot_tree() == before, "el dry-run no debe escribir archivos"


def test_ine_dry_run_json_is_parseable(server):
    r = run("proyectos_ine.py", ["--dry-run", "--layer", "pe", "--json", "--base-url", f"{server}/ine", "--pause", "0", "--no-geocheck"])
    assert r.returncode == 0, r.stderr
    s = json.loads(r.stdout)
    assert s["consistent"] and s["downloaded"] == 300 and s["ready"] and s["geocheck_skipped"] == "--no-geocheck"
    assert len(s["sha256"]) == 64


def test_ine_count_drift_exits_3(server):
    Faults.count_drift = True
    r = run("proyectos_ine.py", ["--dry-run", "--layer", "pe", "--base-url", f"{server}/ine", "--pause", "0"])
    assert r.returncode == 3, r.stdout[-600:]
    assert "NO COINCIDEN" in r.stdout and "DETENIDO" in r.stdout


def test_ine_missing_field_exits_2(server):
    Faults.drop_field = "PRECISION_"
    r = run("proyectos_ine.py", ["--dry-run", "--layer", "pe", "--base-url", f"{server}/ine", "--pause", "0"])
    assert r.returncode == 2 and "FALTAN: PRECISION_" in r.stdout


def test_ine_empty_layer_exits_2(server):
    Faults.empty = True
    r = run("proyectos_ine.py", ["--dry-run", "--layer", "crf", "--base-url", f"{server}/ine", "--pause", "0"])
    assert r.returncode == 2 and "la capa viene vacía" in r.stdout


def test_ine_unreachable_source_exits_3():
    r = run("proyectos_ine.py", ["--dry-run", "--layer", "pe", "--base-url", "http://127.0.0.1:9/ine", "--pause", "0"])
    assert r.returncode == 3 and "ERROR DE LA FUENTE" in r.stderr and "No se cargó nada" in r.stderr


def test_ine_real_load_without_db_url_stops():
    r = run("proyectos_ine.py", ["--layer", "pe", "--base-url", "http://127.0.0.1:9/ine"])
    assert r.returncode != 0 and "SUPABASE_DB_URL" in (r.stderr + r.stdout)


def test_seia_dry_run_ok(server):
    before = snapshot_tree()
    r = run("proyectos_seia.py", ["--dry-run", "--base-url", f"{server}/seia", "--pause", "0"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.count("VEREDICTO: LISTO PARA CARGAR") == 2
    assert "FILTRO POR TIPOLOGÍA" in r.stdout and "ESTADO DE EVALUACIÓN" in r.stdout and "FECHA_CALIFICACION no es permiso" in r.stdout
    assert snapshot_tree() == before


def test_seia_single_layer_json(server):
    r = run("proyectos_seia.py", ["--dry-run", "--layer", "2", "--json", "--base-url", f"{server}/seia", "--pause", "0", "--no-geocheck"])
    assert r.returncode == 0, r.stderr
    s = json.loads(r.stdout)
    assert s["stats"]["form"] == "DIA" and s["stats"]["accepted"] > 0
    assert s["stats"]["accepted"] + s["stats"]["typology_excluded_count"] + s["stats"]["rejected"] == 140
