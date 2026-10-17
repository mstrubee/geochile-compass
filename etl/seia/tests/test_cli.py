"""CLI de punta a punta SIN base de datos (--dry-run) contra el servidor ArcGIS falso."""
import json
import os
from pathlib import Path

import pytest

import seia_proyectos as cli
from conftest import make_feature


@pytest.fixture(autouse=True)
def sin_base(monkeypatch):
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)


def run(fake, capsys, *extra):
    code = cli.main(["--base-url", fake.base, "--pause", "0", *extra])
    out = capsys.readouterr()
    return code, out.out, out.err


def feats(n, **kw):
    return [make_feature(i, **kw) for i in range(1, n + 1)]


def test_ensayo_de_las_dos_capas_cuadra_y_no_escribe_nada(fake, capsys, tmp_path, monkeypatch):
    fake.layers[1], fake.layers[2] = feats(5), feats(30)
    monkeypatch.chdir(tmp_path)
    code, out, err = run(fake, capsys, "--dry-run")
    assert code == 0, out + err
    assert "capa EIA" in out and "capa DIA" in out and "⇒ OK" in out
    assert "conteo del servicio: 30" in out and "conteo del servicio: 5" in out
    assert "ENSAYO: no se escribió nada" in out
    assert list(tmp_path.iterdir()) == []                    # ni archivos ni __pycache__


def test_el_reporte_muestra_lo_que_hay_que_decidir(fake, capsys):
    fake.layers[2] = feats(10) + [make_feature(11, comunas="Comuna Inventada"), make_feature(12, geometry=None),
                                  make_feature(13, FECHA_PRESENTACION="texto raro")]
    code, out, _ = run(fake, capsys, "--layer", "dia", "--dry-run")
    assert "'Comuna Inventada'" in out and "sin punto: 1" in out
    assert "bad_date:FECHA_PRESENTACION: 1" in out and "date_utc_midnight:FECHA_PRESENTACION" in out
    assert "h.1) Proyectos inmobiliarios" in out and "Aprobado" in out


def test_el_servicio_dice_mas_de_lo_que_entrega(fake, capsys):
    fake.layers[2] = feats(20)
    fake.count_lie = 3
    code, out, _ = run(fake, capsys, "--layer", "dia", "--dry-run")
    assert code == 3 and "NO CUADRA" in out and "paginación incompleta" in out


def test_el_servicio_cambia_mientras_se_pagina(fake, capsys):
    fake.layers[2] = feats(20)
    fake.count_drift = 1
    code, out, _ = run(fake, capsys, "--layer", "dia", "--dry-run")
    assert code == 3 and "cambió mientras se paginaba" in out


def test_rechazos_tolerados_cargan_pero_avisan_con_codigo_5(fake, capsys):
    fake.layers[2] = feats(600) + [make_feature(601, ID_EXPEDIENTE=None), make_feature(602, ID_EXPEDIENTE=None)]   # 2/602 = 0,33 %
    code, out, _ = run(fake, capsys, "--layer", "dia", "--dry-run")
    assert code == 5 and "RECHAZOS: missing_id=2" in out and "NO SE CARGA" not in out


def test_rechazos_sobre_el_umbral_no_se_cargan(fake, capsys):
    fake.layers[2] = feats(98) + [make_feature(99, ID_EXPEDIENTE=None), make_feature(100, ID_EXPEDIENTE=None)]       # 2 %
    code, out, _ = run(fake, capsys, "--layer", "dia", "--dry-run")
    assert code == 5 and "NO SE CARGA" in out and "tasa de rechazo" in out


def test_guardar_el_original_y_reproducirlo_sin_red(fake, capsys, tmp_path):
    fake.layers[2] = feats(40) + [make_feature(41, comunas="Nada")]
    fake.last_edit = 1760000000000
    code, out, _ = run(fake, capsys, "--layer", "dia", "--dry-run", "--save-dir", str(tmp_path / "orig"), "--json")
    assert code == 0
    live = json.loads(out)[0]
    saved = list((tmp_path / "orig").glob("*.seia.gz"))
    assert len(saved) == 1 and saved[0].name == f"seia_proyectos_dia_{live['content_sha256'][:12]}.seia.gz"
    assert live["declared_date"] == "2025-10-09" and "editingInfo" in live["declared_date_note"]
    # sin red: el servidor ya no existe y el reporte es el mismo
    fake.stop()
    code, out, _ = cli.main(["--layer", "dia", "--dry-run", "--json", "--from-archive", str(saved[0])]), capsys.readouterr().out, None
    again = json.loads(out)[0]
    assert code == 0 and again["from_archive"] is True
    assert again["content_sha256"] == live["content_sha256"] and again["cuadre"] == live["cuadre"]
    assert again["declared_date"] == live["declared_date"] and again["origin_url"] == live["origin_url"]


def test_from_archive_exige_una_capa_y_que_coincida(fake, capsys, tmp_path):
    fake.layers[2] = feats(10)
    run(fake, capsys, "--layer", "dia", "--dry-run", "--save-dir", str(tmp_path))
    f = str(next(tmp_path.glob("*.seia.gz")))
    assert cli.main(["--dry-run", "--from-archive", f]) == 2                           # layer=all no vale
    assert "UNA capa" in capsys.readouterr().err
    assert cli.main(["--dry-run", "--layer", "eia", "--from-archive", f]) == 2         # el archivo es de la DIA
    assert "ARCHIVO NO UTILIZABLE" in capsys.readouterr().err
    assert cli.main(["--dry-run", "--layer", "dia", "--from-archive", str(tmp_path / "no_existe")]) == 2


@pytest.fixture
def sin_esperas(monkeypatch):
    from seia import arcgis
    monkeypatch.setattr(arcgis.time, "sleep", lambda *_: None)          # los reintentos no duermen en las pruebas


def test_servicio_caido_es_error_de_red_con_codigo_4(capsys, sin_esperas):
    code = cli.main(["--base-url", "http://127.0.0.1:1", "--pause", "0", "--layer", "dia", "--dry-run"])
    err = capsys.readouterr().err
    assert code == 4 and "NO SE PUDO CAPTURAR" in err


def test_una_capa_caida_no_impide_procesar_la_otra(fake, capsys, sin_esperas):
    fake.layers[1], fake.layers[2] = feats(5), feats(5)
    fake.fail_status, fake.fail_layer = 500, 1                       # solo la EIA falla
    code, out, err = run(fake, capsys, "--dry-run")
    assert code == 4                                                 # el error de red se informa…
    assert "[EIA] NO SE PUDO CAPTURAR" in err
    assert "capa DIA" in out and "⇒ OK" in out and "capa EIA" not in out   # …y la DIA igual se procesó
