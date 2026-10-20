"""ETL de capacidad hospitalaria (REM 20 y dotación de camas, DEIS). DATOS 100 % SINTÉTICOS: un CSV y un XLSX inventados con la estructura de los reales.
Las cifras reales (Tisné 303/296/280 camas y 84,83 %; Buin 100 camas y 76,38 %; 168.474 filas; «Total País» 26.738) se verifican con los archivos reales en el informe del PR y en el runbook;
si defines CAP_REM20_CSV y CAP_DOTACION_XLSX con las rutas de los originales, también se prueban aquí."""
import csv
import io
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

ETL = Path(__file__).resolve().parents[2]
ROOT = ETL.parent
sys.path.insert(0, str(ETL))
sys.dont_write_bytecode = True

openpyxl = pytest.importorskip("openpyxl")
from salud import capacidad as C  # noqa: E402
from salud import capacidad_runner as R  # noqa: E402

TISNE, BUIN, PRIV = "112101", "113150", "124210"


# ------------------------------------------------------------------------------------------------ fixtures sintéticos
def rem20_rows():
    """Tisné: áreas 402 (100/120 por mes) y 330 (10/40) de 2025-01 a 2026-03; en 2026-03: 90/100 y 5/0. Buin: área 403 (50/100) solo 2025-07 a 2025-12."""
    rows = []
    for y, m in [(2025, i) for i in range(1, 13)] + [(2026, i) for i in range(1, 4)]:
        last = (y, m) == (2026, 3)
        for area, o, d, ol, dl in ((402, 100, 120, 90, 100), (330, 10, 40, 5, 0)):
            rows.append((y, TISNE, area, m, ol if last else o, dl if last else d))
    for m in range(7, 13):
        rows.append((2025, BUIN, 403, m, 50, 100))
    return rows


def rem20_csv(rows=None, *, header=None, tweak=None, pert=1) -> bytes:
    rows = rows if rows is not None else rem20_rows()
    out = io.StringIO()
    w = csv.writer(out, delimiter=";", lineterminator="\n")
    w.writerow(header or C.REM20_COLUMNS)
    for y, code, area, m, o, d in rows:
        idx = f"{100.0 * o / d:.2f}" if d > 0 else "0.00"
        line = [y, pert, "12", "Metropolitano Oriente", code, f"FIXTURE {code}", area, "Área " + str(area), m, o, d, 5, 2, 0, 0, idx, "1.0", "1.0", "0.0", "1.0"]
        w.writerow(line)
    text = out.getvalue()
    return (tweak(text) if tweak else text).encode("utf-8")


NOTES = ["* A partir del año 2014, la agrupación de camas es por áreas funcionales.", "******* FIXTURE no declara dotación 2025."]


def dotacion_xlsx(path, *, tweak=None, years=(2024, 2025), total_pais=None):
    """Una hoja con el encabezado de 4 filas del real. Tisné: totales 296 (2024) y 280 (2025) con áreas 402 y 330; Buin 100/100; Metropolitano (114104) en DOS bloques; un establecimiento con celda de texto."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"2010-{years[-1]}"
    ws.append(["DOTACIÓN DE CAMAS HOSPITALARIAS DE ESTABLECIMIENTOS PERTENECIENTES AL SNSS (Públicos)"])
    ws.append(["Fuente: DEIS, DIGERA"])
    ws.append(["Nombre Servicio de Salud", "Código Establecimiento", "Tipo de Establecimiento", "Nombre Establecimiento", "Cod. Área Funcional", "Área Funcional", *[f"{y}*" if y == 2014 else y for y in years]])
    blocks = [
        ("Metropolitano Oriente", 112101, "Alta complejidad", "FIXTURE Tisné", [(100, [296, 280]), (402, [216, 200]), (330, [80, 80])]),
        ("Metropolitano Sur", 113150, "Mediana complejidad", "FIXTURE Buin", [(100, [100, 100]), (403, [100, 100])]),
        ("Metropolitano Occidente", 114104, "Alta complejidad", "FIXTURE Metropolitano**", [(100, [240, None]), (402, [240, None])]),
        ("Metropolitano Oriente", 114104, "Alta complejidad", "FIXTURE Metropolitano", [(100, [0, 180]), (402, [None, 180])]),
        ("Maule", 116104, "Baja complejidad", "FIXTURE sin dato", [(100, [10, "*******"]), (403, [10, "*******"])]),
    ]
    tp = [sum((b[4][0][1][i] or 0) for b in blocks if isinstance(b[4][0][1][i], int)) for i in range(len(years))]
    ws.append([None] * 5 + ["Total País", *(total_pais or tp)])
    for serv, code, tipo, name, areas in blocks:
        for k, (area, vals) in enumerate(areas):
            ws.append([serv if True else None, code if area == 100 else None, tipo if area == 100 else None, name, area, "Total" if area == 100 else f"Área {area}", *vals])
    ws.append([])
    for t in NOTES:
        ws.append([t])
    if tweak:
        tweak(ws)
    wb.save(path)
    return path


# ------------------------------------------------------------------------------------------------ REM 20
def test_rem20_parses_components_and_sums_duplicate_keys():
    rows = rem20_rows() + [(2025, BUIN, 403, 7, 30, 60)]                               # clave repetida (Buin 2025-07): se SUMA y se cuenta
    d = C.read_rem20(rem20_csv(rows))
    assert d.rows_raw == len(rows) and len(d.rows) == len(rows) - 1
    assert d.dup_keys == [(BUIN, "2025-07", 403)]
    v = d.rows[(BUIN, date(2025, 7, 1), 403)]
    assert v[0] == 80 and v[1] == 160 and v[6] == 2
    assert d.first_period == date(2025, 1, 1) and d.last_period == date(2026, 3, 1) and d.period_end == date(2026, 3, 31)
    assert d.codes == {TISNE, BUIN} and d.pertenencia == {1: len(rows)} and not d.missing_months and not d.unknown_areas
    assert all(ok for ok, _ in C.reconcile_rem20(d, {TISNE, BUIN}).values())


def test_occupancy_is_sum_over_sum_never_the_mean_of_area_indices():
    d = C.read_rem20(rem20_csv())
    o, dsp, meses, idx = C.occupancy(d, TISNE, date(2025, 1, 1), date(2025, 12, 1))
    assert (o, dsp, meses, idx) == (1320, 1920, 12, 68.75)                              # (83,33 + 25,00) / 2 daría 54,17: NO
    assert C.occupancy(d, TISNE, date(2026, 3, 1), date(2026, 3, 1)) == (95, 100, 1, 95.0)
    assert C.occupancy(d, BUIN, date(2025, 1, 1), date(2025, 12, 1))[2:] == (6, 50.0)   # año incompleto: 6 meses, no se completa
    assert C.occupancy(d, "999999", date(2025, 1, 1), date(2025, 12, 1)) == (0, 0, 0, None)


def test_occupancy_with_zero_available_is_no_data_not_zero_percent():
    d = C.read_rem20(rem20_csv([(2025, TISNE, 402, 1, 0, 0), (2025, TISNE, 330, 1, 0, 0)]))
    assert C.occupancy(d, TISNE, date(2025, 1, 1), date(2025, 1, 1)) == (0, 0, 1, None)
    assert d.disp_zero_rows == 2 and d.index_mismatch == 0                              # el archivo publica 0,00 con denominador 0: es «sin denominador»


def test_rem20_requires_the_exact_header():
    bad = [c for c in C.REM20_COLUMNS if c != "TRASLADOS"]
    with pytest.raises(C.StructureError, match="columnas"):
        C.read_rem20(rem20_csv(header=bad + ["OTRA"]))
    with pytest.raises(C.StructureError, match="columnas"):
        C.read_rem20(rem20_csv(header=list(reversed(C.REM20_COLUMNS))))
    with pytest.raises(C.StructureError, match="vacío"):
        C.read_rem20(b"")


def test_rem20_published_index_must_match_the_official_formula():
    d = C.read_rem20(rem20_csv(tweak=lambda t: t.replace(";83.33;", ";83.90;", 1)))
    assert d.index_mismatch == 1
    rec = C.reconcile_rem20(d)
    assert rec["índice ocupacional publicado = fórmula oficial (ocupados / disponibles × 100) en TODAS las filas"][0] is False
    assert not all(ok for ok, _ in rec.values())


def test_rem20_detects_missing_months_unknown_areas_and_bad_values():
    rows = [r for r in rem20_rows() if not (r[0] == 2025 and r[3] == 5)]
    d = C.read_rem20(rem20_csv(rows))
    assert d.missing_months == ["2025-05"] and C.reconcile_rem20(d)["todos los meses entre el primero y el último están presentes"][0] is False
    d = C.read_rem20(rem20_csv([(2025, TISNE, 999, 1, 1, 2)]))
    assert d.unknown_areas == {999} and C.reconcile_rem20(d)["todas las áreas funcionales están registradas (health_areas_funcionales)"][0] is False
    with pytest.raises(C.StructureError, match="6 dígitos"):
        C.read_rem20(rem20_csv([(2025, "12345", 402, 1, 1, 2)]))
    with pytest.raises(C.StructureError, match="negativo"):
        C.read_rem20(rem20_csv([(2025, TISNE, 402, 1, -1, 2)]))
    with pytest.raises(C.StructureError, match="entero"):
        C.read_rem20(rem20_csv(tweak=lambda t: t.replace(";100;120;5;", ";cien;120;5;", 1)))
    with pytest.raises(C.StructureError, match="fuera de rango"):
        C.read_rem20(rem20_csv([(2025, TISNE, 402, 13, 1, 2)]))


def test_rem20_reports_establishments_that_are_not_part_of_the_snss():
    d = C.read_rem20(rem20_csv([(2025, PRIV, 403, 1, 5, 10)], pert=2))
    assert d.non_pertenece == {PRIV: ("FIXTURE 124210", 2025, 2025)} and d.pertenencia == {2: 1}


def test_rem20_reconcile_flags_codes_without_a_match_in_the_establishments_layer():
    d = C.read_rem20(rem20_csv())
    rec = C.reconcile_rem20(d, {TISNE})
    ok, detail = rec["todo código empalma con la captura vigente de establecimientos"]
    assert ok is False and BUIN in detail


# ------------------------------------------------------------------------------------------------ Dotación
def test_dotacion_propagates_the_code_sums_the_two_blocks_and_skips_text_cells(tmp_path):
    d = C.read_dotacion(dotacion_xlsx(tmp_path / "d.xlsx"))
    assert d.years == [2024, 2025] and d.blocks == 5 and d.codes == {"112101", "113150", "114104", "116104"}
    assert d.rows[("112101", 2025, 100)] == 280 and d.rows[("112101", 2025, 402)] == 200 and d.rows[("112101", 2024, 330)] == 80       # código heredado por posición
    assert d.rows[("114104", 2024, 100)] == 240 and d.rows[("114104", 2025, 100)] == 180 and d.codes_multi_block == {"114104"}       # dos bloques: se suman (celdas vacías = sin dato)
    assert d.rows[("114104", 2024, 100)] == 240 + 0                                                                                    # un 0 publicado se conserva
    assert ("116104", 2025, 100) not in d.rows and ("116104", 2025, 403) not in d.rows                                                # '*******' = sin dato: no se guarda
    assert [(y, c) for _r, y, _t, c in d.text_cells] == [(2025, "116104"), (2025, "116104")]
    assert d.total_pais == {2024: 646, 2025: 560} and len(d.notes) == 2 and d.notes[0].startswith("* A partir del año 2014")
    assert all(ok for ok, _ in C.reconcile_dotacion(d, {"112101", "113150", "114104", "116104"}).values())
    assert C.dotacion_period(d) == (date(2024, 1, 1), date(2025, 12, 31)) and C.beds(d, "113150", 2025) == 100 and C.beds(d, "116104", 2025) is None


def test_dotacion_total_pais_must_match_the_sum_of_totals_in_every_year(tmp_path):
    d = C.read_dotacion(dotacion_xlsx(tmp_path / "d.xlsx", total_pais=[646, 561]))
    ok, detail = C.reconcile_dotacion(d)["Σ de los totales por establecimiento = «Total País» del archivo, en TODOS los años"]
    assert ok is False and "2025" in detail


def test_dotacion_total_is_stored_as_published_even_when_it_is_not_the_sum_of_the_areas(tmp_path):
    def tweak(ws):
        for row in ws.iter_rows():
            if row[4].value == 402 and row[3].value == "FIXTURE Tisné":
                row[7].value = 190                                                                                                   # Σ áreas 2025 = 270 ≠ total publicado 280
    d = C.read_dotacion(dotacion_xlsx(tmp_path / "d.xlsx", tweak=tweak))
    assert d.rows[("112101", 2025, 100)] == 280 and ("112101", 2025, 280, 270) in d.total_vs_areas
    assert all(ok for ok, _ in C.reconcile_dotacion(d).values())                                                                     # informativo: no detiene la carga


def test_dotacion_rejects_conflicting_blocks_bad_structure_and_unknown_areas(tmp_path):
    def conflict(ws):
        for row in ws.iter_rows():
            if row[4].value == 402 and row[3].value == "FIXTURE Metropolitano":
                row[6].value = 5                                                                                                     # 2024: ya había 240 en el otro bloque
    with pytest.raises(C.StructureError, match="dos bloques"):
        C.read_dotacion(dotacion_xlsx(tmp_path / "a.xlsx", tweak=conflict))
    wb = openpyxl.Workbook()
    wb.active.append(["sin encabezado"])
    wb.save(tmp_path / "b.xlsx")
    with pytest.raises(C.StructureError, match="encabezado"):
        C.read_dotacion(tmp_path / "b.xlsx")

    def unknown(ws):
        for row in ws.iter_rows():
            if row[4].value == 403 and row[3].value == "FIXTURE Buin":
                row[4].value = 777
    d = C.read_dotacion(dotacion_xlsx(tmp_path / "c.xlsx", tweak=unknown))
    assert d.unknown_areas == {777} and C.reconcile_dotacion(d)["todas las áreas funcionales están registradas (health_areas_funcionales)"][0] is False

    def negative(ws):
        for row in ws.iter_rows():
            if row[4].value == 402 and row[3].value == "FIXTURE Tisné":
                row[7].value = -3
    with pytest.raises(C.StructureError, match="negativo"):
        C.read_dotacion(dotacion_xlsx(tmp_path / "d.xlsx", tweak=negative))


def test_known_areas_are_exactly_the_ones_seeded_by_the_migration():
    sql = (ROOT / "supabase" / "migrations" / "20261108000000_health_capacity.sql").read_text(encoding="utf-8")
    block = sql[sql.index("insert into public.health_areas_funcionales"):sql.index("on conflict (area) do nothing")]
    seeded = {int(m) for m in re.findall(r"\((\d{3}), '", block)}
    assert seeded == C.KNOWN_AREAS | {C.TOTAL_AREA}


# ------------------------------------------------------------------------------------------------ fuentes (sin red)
class _Resp:
    def __init__(self, data=None, content=b"", headers=None, url="https://x.test/f", status=200):
        self._d, self.content, self.headers, self.url, self.status_code = data, content, headers or {}, url, status

    def json(self):
        return self._d

    def raise_for_status(self):
        pass


def pkg(resources, license_id="cc-zero"):
    return {"success": True, "result": {"license_id": license_id, "license_title": "Creative Commons CCZero", "resources": resources}}


RES = {"name": "Indicadores_REM20.csv", "format": "csv", "url": "https://datos.gob.cl/d/indicadores_rem20_20991231.csv", "last_modified": "2099-12-31T04:00:00.1", "id": "abc", "size": 10}


def test_ckan_resolves_the_current_url_and_requires_cc0(monkeypatch):
    monkeypatch.setattr(R, "_get", lambda url, **kw: _Resp(pkg([RES, {"name": "Diccionario", "format": "xlsx", "url": "https://x/d.xlsx"}])))
    info = R.resolve_rem20()
    assert info["url"].endswith("indicadores_rem20_20991231.csv") and info["license_id"] == "cc-zero" and info["last_modified"].startswith("2099-12-31")
    monkeypatch.setattr(R, "_get", lambda url, **kw: _Resp(pkg([RES], license_id="cc-by")))
    with pytest.raises(RuntimeError, match="licencia"):
        R.resolve_rem20()
    monkeypatch.setattr(R, "_get", lambda url, **kw: _Resp(pkg([])))
    with pytest.raises(RuntimeError, match="exactamente un recurso"):
        R.resolve_rem20()
    monkeypatch.setattr(R, "_get", lambda url, **kw: _Resp(pkg([RES, dict(RES, id="otro")])))
    with pytest.raises(RuntimeError, match="exactamente un recurso"):
        R.resolve_rem20()


def test_fetch_rem20_records_the_effective_url_and_ckan_date(monkeypatch):
    csv_bytes = rem20_csv()
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        return _Resp(pkg([RES]), url="x") if "package_show" in url else _Resp(content=csv_bytes, url="https://cdn.datos.gob.cl/efectiva.csv")
    monkeypatch.setattr(R, "_get", fake_get)

    class A:
        rem20_file = rem20_url = ckan_url = None
    raw, name, origin, declared, method, info = R.fetch_rem20(A())
    assert raw == csv_bytes and origin == "https://cdn.datos.gob.cl/efectiva.csv" and calls[1] == RES["url"] and name == "indicadores_rem20_20991231.csv"
    assert declared[0] == date(2099, 12, 31) and "CKAN" in declared[1] and method == "automatic_download"


def test_fetch_dotacion_picks_the_newest_year_that_exists(monkeypatch, tmp_path):
    import requests
    xlsx = dotacion_xlsx(tmp_path / "d.xlsx")
    ok_year = date.today().year - 1 if date.today().year - 1 > 2025 else 2025
    seen = []

    def head(url, **kw):
        seen.append(url)
        good = f"2010-{ok_year}" in requests.utils.unquote(url)
        return _Resp(status=200 if good else 404, headers={"content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if good else "text/html"})
    monkeypatch.setattr(requests, "head", head)
    monkeypatch.setattr(R, "_get", lambda url, **kw: _Resp(content=Path(xlsx).read_bytes(), headers={"last-modified": "Mon, 20 Oct 2025 16:12:50 GMT"}, url=url))

    class A:
        dotacion_file = None
        dotacion_year = None
    raw, name, origin, declared, method, info = R.fetch_dotacion(A())
    assert name == f"Dotación de camas 2010-{ok_year} Establecimientos Pertenecientes al SNSS.xlsx" and "%C3%B3n%20de%20camas%202010-" in origin and declared[0] == date(2025, 10, 20) and info["year_in_name"] == ok_year
    assert requests.utils.unquote(seen[0]).count(str(date.today().year + 1)) == 1                  # empieza por el año más nuevo posible y baja


# ------------------------------------------------------------------------------------------------ CLI
def run_cli(args, env=None):
    e = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", **(env or {})}
    return subprocess.run([sys.executable, "-B", str(ETL / "salud_capacidad.py"), *args], capture_output=True, text=True, env=e, cwd=ROOT)


def test_cli_dry_run_reports_controls_and_writes_nothing(tmp_path):
    (tmp_path / "r.csv").write_bytes(rem20_csv())
    dotacion_xlsx(tmp_path / "d.xlsx")
    r = run_cli(["--dry-run", "--rem20-file", str(tmp_path / "r.csv"), "--dotacion-file", str(tmp_path / "d.xlsx")], {"SALUD_OUT_DIR": str(tmp_path / "out")})
    assert r.returncode == 0, r.stdout + r.stderr
    assert "VEREDICTO: LISTO para cargar" in r.stdout and "[NO COMPROBADO]" in r.stdout and "NO COMPROBADO en este ensayo" in r.stdout
    assert "índice 68,75 %" in r.stdout and "índice 95,00 %" in r.stdout and "2024: 296 · 2025: 280" in r.stdout and not (tmp_path / "out").exists()


def test_cli_stops_with_exit_2_on_bad_structure_and_with_3_when_the_source_fails(tmp_path):
    (tmp_path / "bad.csv").write_bytes(rem20_csv(header=C.REM20_COLUMNS[:-1]))
    r = run_cli(["--dry-run", "--source", "rem20", "--rem20-file", str(tmp_path / "bad.csv")])
    assert r.returncode == 2 and "ESTRUCTURA INVÁLIDA" in r.stderr
    (tmp_path / "bad_index.csv").write_bytes(rem20_csv(tweak=lambda t: t.replace(";83.33;", ";83.90;", 1)))
    r = run_cli(["--dry-run", "--source", "rem20", "--rem20-file", str(tmp_path / "bad_index.csv")])
    assert r.returncode == 2 and "NO SE CARGA" in r.stdout and "fórmula oficial" in r.stdout
    r = run_cli(["--dry-run", "--source", "rem20", "--rem20-file", str(tmp_path / "no_existe.csv")])
    assert r.returncode == 3 and "ERROR DE LA FUENTE" in r.stderr


@pytest.mark.skipif(not (os.environ.get("CAP_REM20_CSV") and os.environ.get("CAP_DOTACION_XLSX")), reason="define CAP_REM20_CSV y CAP_DOTACION_XLSX con los originales del DEIS para contrastar con las cifras reales")
def test_real_files_reproduce_the_verified_controls():
    r = C.read_rem20(Path(os.environ["CAP_REM20_CSV"]).read_bytes())
    if r.rows_raw == 168474:                                                                   # el archivo verificado el 2026-10-20 (sha256 5085664576…)
        assert (r.rows_raw, len(r.rows), len(r.codes), r.dup_keys.__len__()) == (168474, 168471, 208, 3)
        assert C.occupancy(r, TISNE, date(2025, 1, 1), date(2025, 12, 1)) == (87230, 102835, 12, 84.83)
        assert C.occupancy(r, BUIN, date(2025, 1, 1), date(2025, 12, 1)) == (27370, 35836, 12, 76.38)
        assert C.occupancy(r, TISNE, date(2026, 8, 1), date(2026, 8, 1)) == (7791, 8897, 1, 87.57)
        assert C.occupancy(r, BUIN, date(2026, 8, 1), date(2026, 8, 1)) == (2383, 3059, 1, 77.9)
    assert all(ok for ok, _ in C.reconcile_rem20(r).values())
    d = C.read_dotacion(os.environ["CAP_DOTACION_XLSX"])
    assert [C.beds(d, TISNE, y) for y in (2023, 2024, 2025)] == [303, 296, 280] and [C.beds(d, BUIN, y) for y in (2023, 2024, 2025)] == [100, 100, 100]
    assert d.total_pais[2025] == 26738 and len(d.codes) == 196 and all(ok for ok, _ in C.reconcile_dotacion(d).values())


# ------------------------------------------------------------------------------------------------ carga real a la base de PRUEBA
URL = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(scope="module")
def conn():
    if not URL:
        pytest.skip("define TEST_DATABASE_URL (base de PRUEBA con 20261108000000 aplicada)")
    import psycopg
    c = psycopg.connect(URL, autocommit=True)
    name = c.execute("select current_database()").fetchone()[0]
    if "test" not in name:
        pytest.skip(f"la base {name!r} no parece de prueba: no se toca")
    if c.execute("select to_regclass('public.health_rem20_month')").fetchone()[0] is None:
        pytest.skip("la base no tiene aplicada 20261108000000_health_capacity")
    keys = (C.REM20_SOURCE_KEY, C.DOTACION_SOURCE_KEY)

    def clean():
        c.execute("truncate public.health_rem20_month_stage, public.health_beds_dotacion_stage")
        c.execute("delete from public.health_rem20_month")
        c.execute("delete from public.health_beds_dotacion")
        c.execute("delete from public.source_checks where source_id in (select id from public.data_sources where source_key = any(%s))", (list(keys),))
        c.execute("delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = any(%s))", (list(keys),))
        c.execute("delete from public.health_establishments where snapshot_n in (select n from public.source_snapshots where storage_path = 'test/cap-est')")
        c.execute("delete from public.source_snapshots where storage_path = 'test/cap-est'")
    clean()
    c.execute("""insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status, loaded_at)
                 select d.id, 'test', 'manual_download', 'https://example.test/est', 'test/cap-est', encode(sha256('cap-est'::bytea), 'hex'), current_date, current_date, 'snapshot', 4, 'loaded', now()
                   from public.data_sources d where d.source_key = 'deis_establecimientos'""")
    c.execute("""insert into public.health_establishments (snapshot_n, code, name, region_cut, comuna_cut, tipo_glosa, tipo_norm, dependencia_norm, snss, complejidad, tipo_atencion, clase_servicio,
                                                           clase_fuente, alta_hospital, alta_ampliada, estado, geo_status)
                 select s.n, v.code, 'FIXTURE ' || v.code, '13', '13101', 'Hospital', 'hospital', v.dep, v.snss, 'alta', 'hospitalaria', 'hospitalario', 'oficial', false, false, 'vigente', 4
                   from public.source_snapshots s, (values ('112101', 'servicio_salud', true), ('113150', 'servicio_salud', true), ('114104', 'servicio_salud', true), ('116104', 'servicio_salud', true), ('124210', 'privado', false)) v(code, dep, snss)
                  where s.storage_path = 'test/cap-est'""")
    yield c
    clean()                                                                                       # la base de prueba queda como estaba
    c.close()


def _env(tmp_path):
    return {"SUPABASE_DB_URL": URL, "SALUD_OUT_DIR": str(tmp_path / "out")}


def test_load_publishes_both_sources_checks_values_and_is_idempotent(conn, tmp_path):
    (tmp_path / "r.csv").write_bytes(rem20_csv())
    dotacion_xlsx(tmp_path / "d.xlsx")
    args = ["--no-storage", "--rem20-file", str(tmp_path / "r.csv"), "--rem20-origin-url", "https://datos.gob.cl/d/indicadores_rem20_20991231.csv", "--rem20-declared-date", "2026-04-01",
            "--dotacion-file", str(tmp_path / "d.xlsx"), "--dotacion-origin-url", "https://repositoriodeis.minsal.cl/x/dot.xlsx", "--dotacion-declared-date", "2025-10-20"]
    r = run_cli(args, _env(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.count('"result": "published"') == 2
    cap = conn.execute("select public.get_health_capacity(%s)", (TISNE,)).fetchone()[0]
    assert cap["dotacion"]["total"] == 280 and cap["dotacion"]["year"] == 2025 and [a["camas"] for a in cap["dotacion"]["areas"]] == [80, 200]
    assert cap["ocupacion_anual"]["year"] == 2025 and cap["ocupacion_anual"]["indice"] == 68.75 and cap["ocupacion_anual"]["months"] == 12
    assert cap["ocupacion_mes"]["period"] == "2026-03" and cap["ocupacion_mes"]["indice"] == 95.0
    assert cap["fuentes"]["rem20"]["origin_url"] == "https://datos.gob.cl/d/indicadores_rem20_20991231.csv" and cap["fuentes"]["rem20"]["declared_date"] == "2026-04-01"
    assert cap["fuentes"]["dotacion"]["declared_date"] == "2025-10-20" and cap["fuentes"]["dotacion"]["license_label"].startswith("[NO COMPROBADO]")
    assert all(v["client_ready"] is False for v in cap["client_ready"].values())
    buin = conn.execute("select public.get_health_capacity(%s)", (BUIN,)).fetchone()[0]
    assert buin["ocupacion_anual"]["months"] == 6 and buin["ocupacion_mes"] is None
    priv = conn.execute("select public.get_health_capacity(%s)", (PRIV,)).fetchone()[0]
    assert priv["snss"] is False and priv["dotacion"] is None and priv["ocupacion_anual"] is None and priv["ocupacion_mes"] is None
    sin = conn.execute("select public.get_health_capacity(%s)", ("116104",)).fetchone()[0]
    assert sin["dotacion"] is not None and sin["dotacion"]["year"] == 2025 or sin["dotacion"] is None                  # la celda de texto no se guardó
    assert conn.execute("select count(*) from public.health_beds_dotacion where code = '116104' and year = 2025").fetchone()[0] == 0
    snaps = conn.execute("""select d.source_key, s.status, s.granularity, s.period_start, s.period_end, s.capture_method from public.source_snapshots s join public.data_sources d on d.id = s.source_id
                             where d.source_key = any(%s) order by 1""", ([C.DOTACION_SOURCE_KEY, C.REM20_SOURCE_KEY],)).fetchall()
    assert snaps == [(C.DOTACION_SOURCE_KEY, "loaded", "year", date(2024, 1, 1), date(2025, 12, 31), "manual_download"), (C.REM20_SOURCE_KEY, "loaded", "month", date(2025, 1, 1), date(2026, 3, 31), "manual_download")]
    assert conn.execute("select count(*) from public.health_rem20_month_stage").fetchone()[0] == 0
    r2 = run_cli(args, _env(tmp_path))
    assert r2.returncode == 0 and r2.stdout.count('"result": "already_loaded"') == 2


def test_load_stops_before_touching_the_base_when_a_code_has_no_match(conn, tmp_path):
    """La carga real también empalma con la captura vigente de establecimientos; la base además lo re-valida (supabase/tests/health_capacity.sql)."""
    conn.execute("delete from public.health_rem20_month")
    conn.execute("delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s)", (C.REM20_SOURCE_KEY,))
    (tmp_path / "r.csv").write_bytes(rem20_csv(rem20_rows() + [(2025, "999999", 402, 1, 1, 2)]))      # un código que no está en la captura de establecimientos
    r = run_cli(["--no-storage", "--source", "rem20", "--rem20-file", str(tmp_path / "r.csv")], _env(tmp_path))
    assert r.returncode == 2 and "999999" in r.stdout and "NO SE CARGA" in r.stdout
    assert conn.execute("select count(*) from public.health_rem20_month").fetchone()[0] == 0
    assert conn.execute("select count(*) from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key = %s", (C.REM20_SOURCE_KEY,)).fetchone()[0] == 0
    assert conn.execute("select count(*) from public.health_rem20_month_stage").fetchone()[0] == 0


def test_a_failed_publication_leaves_the_snapshot_rejected_and_nothing_current(conn, tmp_path):
    """Si la base rechaza en la publicación (aquí: la fuente quedó con un snapshot posterior ya cargado), el snapshot queda rejected y la zona de paso vacía."""
    from salud import capacidad_db
    d = C.read_rem20(rem20_csv())
    conn.execute("delete from public.health_rem20_month")
    conn.execute("delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s)", (C.REM20_SOURCE_KEY,))
    conn.execute("""insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status, loaded_at)
                    select d.id, 'test', 'manual_download', 'https://example.test/nuevo', 'test/cap-nuevo', encode(sha256('cap-nuevo'::bytea), 'hex'), date '2030-01-01', date '2030-01-31', 'month', 1, 'loaded', now()
                      from public.data_sources d where d.source_key = %s""", (C.REM20_SOURCE_KEY,))
    c2 = capacidad_db.connect(URL)
    try:
        with pytest.raises(Exception, match="período más nuevo"):
            capacidad_db.run_load_rem20(conn=c2, d=d, origin_url="https://example.test/r.csv", file_name="r.csv", sha="a" * 64, raw=b"x", declared=(date(2026, 4, 1), "test"),
                                        captured_by="test", capture_method="manual_download", use_storage=False, publish=True,
                                        report={"rows_raw": d.rows_raw, "rows_stage": len(d.rows), "establecimientos": len(d.codes), "totales": d.totales}, layout={})
    finally:
        c2.close()
    assert conn.execute("select count(*) from public.health_rem20_month_stage").fetchone()[0] == 0
    assert conn.execute("select count(*) from public.health_rem20_month s join public.source_snapshots n on n.n = s.snapshot_n where n.sha256 = %s", ("a" * 64,)).fetchone()[0] == 0
    assert conn.execute("select status from public.source_snapshots where sha256 = %s", ("a" * 64,)).fetchone()[0] == "rejected"
    conn.execute("delete from public.source_snapshots where storage_path = 'test/cap-nuevo'")


def test_dry_run_with_db_stops_on_unmatched_codes_without_writing(conn, tmp_path):
    (tmp_path / "r.csv").write_bytes(rem20_csv(rem20_rows() + [(2025, "999999", 402, 1, 1, 2)]))
    r = run_cli(["--dry-run", "--db", "--source", "rem20", "--rem20-file", str(tmp_path / "r.csv")], _env(tmp_path))
    assert r.returncode == 2 and "999999" in r.stdout and "NO SE CARGA" in r.stdout
    assert conn.execute("select count(*) from public.health_rem20_month").fetchone()[0] == 0
    out = json.loads(run_cli(["--dry-run", "--db", "--json", "--source", "rem20", "--rem20-file", str(tmp_path / "r.csv")], _env(tmp_path)).stdout)
    assert out["rem20"]["ready"] is False and out["rem20"]["rows_raw"] == len(rem20_rows()) + 1
