"""ETL de población censada 2024 (INE, D1). DATOS 100 % SINTÉTICOS: un libro inventado con la estructura del real (hojas Nota, 1, 2 y 4; las 346 comunas de
public/codigos_territoriales.csv con población inventada). Las cifras reales (346, 18.480.432, Santiago 438.856, Puente Alto 568.086, Camarones 861) se verifican con el
archivo real en el informe del PR y en el runbook; si defines CENSO_D1_XLSX con la ruta del original, también se prueban aquí."""
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

ETL = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ETL))
sys.dont_write_bytecode = True

openpyxl = pytest.importorskip("openpyxl")
from censo import poblacion as P  # noqa: E402
from proyectos.common import read_comunas_csv  # noqa: E402

REF = read_comunas_csv()
REF_CUTS = {r["cut"] for r in REF}
REG_NAMES = {r["region_cut"]: f"Región {r['region_cut']}" for r in REF}


def synthetic():
    """{cut: (región, provincia, nombre, total, hombres, mujeres)} y los 18 grupos por comuna (suman exactamente el total, por sexo)."""
    com = {}
    for i, r in enumerate(sorted(REF, key=lambda x: x["cut"]), 1):
        h, m = 1000 + i - (i % 7), 1000 + i + (i % 7)
        com[r["cut"]] = (r["region_cut"], r["cut"][:3], r["name"], h + m, h, m)
    return com


def split(h, m):
    out = []
    for i in range(18):
        gh, gm = h // 18 + (1 if i < h % 18 else 0), m // 18 + (1 if i < m % 18 else 0)
        out.append((gh + gm, gh, gm))
    return out


def make_workbook(path, *, tweak=None, drop_group=None, extra_comuna=None, nota=True, published="27 de marzo, 2025", nota2=True):
    """Libro sintético. `tweak(sheets)` puede alterar las filas antes de escribir (para probar cada cuadre)."""
    com = synthetic()
    sheets = {"Nota": [[None] * 8, [None, None, None, None, "Nota de presentación"], [None], [None], [None, f"Fecha de publicación: {published}."] if nota else [None],
                       [None, "2. Definiciones"], [None, "Variables", None, "Definición"],
                       [None, "Población censada", None, "Cantidad total de residentes habituales censados."]]}
    tot = [sum(v[3] for v in com.values()), sum(v[4] for v in com.values()), sum(v[5] for v in com.values())]
    regs = {}
    for v in com.values():
        a = regs.setdefault(v[0], [0, 0, 0])
        a[0] += v[3]
        a[1] += v[4]
        a[2] += v[5]
    s1 = [[""], [""], ["1. Población censada por sexo y razón hombre-mujer, según región."], ["Código región", "Región", "Población censada", "Hombres", "Mujeres", "Razón hombre-mujer"],
          [0, "País", *tot, 94.3]]
    for k in sorted(regs, key=int):
        s1.append([int(k), REG_NAMES[k], *regs[k], 95.0])
    sheets["1"] = s1
    s2 = [[""], [""], ["2. Población censada por sexo y razón hombre-mujer, según comuna."],
          ["Código región", "Región", "Código provincia", "Provincia", "Código comuna", "Comuna", "Población censada", "Hombres", "Mujeres", "Razón hombre-mujer"],
          [0, "País", 0, "País", 0, "País", *tot, 94.3]]
    s4 = [[""], [""], ["4. Población censada por sexo y razón hombre-mujer, según grupos de edad quinquenal y comuna."],
          ["Código región", "Región", "Código provincia", "Provincia", "Código comuna", "Comuna", "Grupos de edad", "Población censada", "Hombres", "Mujeres", "Razón hombre-mujer"],
          [0, "País", 0, "País", 0, "País", "Total País", *tot, 94.3]]
    pais_g = [[0, 0, 0] for _ in range(18)]
    for cut, (reg, prov, name, t, h, m) in sorted(com.items()):
        s2.append([int(reg), REG_NAMES[reg], int(prov), "Provincia", int(cut), name, t, h, m, 90.0])
        s4.append([int(reg), REG_NAMES[reg], int(prov), "Provincia", int(cut), name, "Total Comuna", t, h, m, 90.0])
        for i, (gt, gh, gm) in enumerate(split(h, m)):
            for j, x in enumerate((gt, gh, gm)):
                pais_g[i][j] += x
            if drop_group and drop_group == (cut, P.GRUPOS[i]):
                continue
            s4.append([int(reg), REG_NAMES[reg], int(prov), "Provincia", int(cut), name, P.GRUPOS[i], gt, gh, gm, 90.0])
    for i, g in enumerate(P.GRUPOS):
        s4.insert(5 + i, [0, "País", 0, "País", 0, "País", g, *pais_g[i], 100.0])
    s2.append(["Fuente: Censo de Población y Vivienda 2024 - Instituto Nacional de Estadísticas.\nNota 2: La tabla fue actualizada el 04-12-2025 debido al cambio de nombre de la comuna de Paihuano."]
              if nota2 else [None])
    sheets["2"], sheets["4"] = s2, s4
    if extra_comuna:
        s2.insert(5, [1, "x", 1, "x", extra_comuna, "Comuna inventada", 10, 5, 5, 100.0])
    if tweak:
        tweak(sheets)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    wb.save(path)
    return path


def read(tmp_path, **kw):
    p = make_workbook(tmp_path / "d1.xlsx", **kw)
    return p, P.read_workbook(p)


def failing(c):
    return [k for k, (ok, _d) in P.reconcile(c, REF_CUTS, REF_CUTS - {"12202"}).items() if not ok]


def test_reads_dates_definition_and_counts(tmp_path):
    _p, c = read(tmp_path)
    assert c.published == date(2025, 3, 27) and "Nota 2" in (c.updated_note or "") and "04-12-2025" in c.updated_note
    assert c.definition == "Cantidad total de residentes habituales censados."
    assert len(c.comunas) == 346 and len(c.edades) == 346 * 18 and len(c.regiones) == 16 and len(c.total_h4) == 346
    assert all(x.cut.isdigit() and len(x.cut) == 5 for x in c.comunas.values())          # el CUT sin el cero inicial se normaliza a 5 dígitos
    assert "01101" in c.comunas and c.pais.total == sum(x.trio.total for x in c.comunas.values())


def test_all_reconciliations_pass_on_a_consistent_workbook(tmp_path):
    _p, c = read(tmp_path)
    assert failing(c) == []
    rec = P.reconcile(c, REF_CUTS, REF_CUTS - {"12202"})
    assert len(rec) >= 12


def test_missing_sheet_or_header_is_a_structure_error(tmp_path):
    p = make_workbook(tmp_path / "x.xlsx")
    wb = openpyxl.load_workbook(p)
    del wb["4"]
    wb.save(p)
    with pytest.raises(P.StructureError):
        P.read_workbook(p)
    p2 = make_workbook(tmp_path / "y.xlsx", tweak=lambda s: s["2"].__setitem__(3, ["a", "b", "c"]))
    with pytest.raises(P.StructureError):
        P.read_workbook(p2)


def test_unexpected_age_group_and_duplicates_are_structure_errors(tmp_path):
    def bad_group(s):
        s["4"][30][6] = "5 a 10"
    with pytest.raises(P.StructureError):
        P.read_workbook(make_workbook(tmp_path / "g.xlsx", tweak=bad_group))

    def dup(s):
        s["2"].insert(6, list(s["2"][6]))
    with pytest.raises(P.StructureError):
        P.read_workbook(make_workbook(tmp_path / "d.xlsx", tweak=dup))


@pytest.mark.parametrize("name,tweak,needle", [
    ("país ≠ Σ comunas", lambda s: s["2"][4].__setitem__(6, s["2"][4][6] + 1), "Σ comunas = total país"),
    ("hoja 1 ≠ hoja 2 (país)", lambda s: s["1"][4].__setitem__(2, s["1"][4][2] + 1), "hoja 2 = hoja 1"),
    ("región ≠ Σ comunas", lambda s: s["1"][10].__setitem__(2, s["1"][10][2] + 1), "total regional"),
    ("hombres + mujeres ≠ total", lambda s: s["2"][7].__setitem__(7, s["2"][7][7] + 1), "hombres + mujeres"),
    ("Σ edades ≠ comuna", lambda s: s["4"][40].__setitem__(7, s["4"][40][7] + 1), "Σ edades"),
    ("«Total Comuna» ≠ hoja 2", lambda s: s["4"][23].__setitem__(7, s["4"][23][7] + 1), "Total Comuna"),
])
def test_each_reconciliation_detects_its_inconsistency(tmp_path, name, tweak, needle):
    _p, c = read(tmp_path, tweak=tweak)
    bad = failing(c)
    assert any(needle in k for k in bad), (name, bad)


def test_missing_age_group_missing_comuna_and_unknown_code(tmp_path):
    _p, c = read(tmp_path, drop_group=("13101", "30 a 34"))
    assert any("18 grupos" in k for k in failing(c)) and any("Σ edades" in k for k in failing(c))
    _p, c = read(tmp_path, tweak=lambda s: s["2"].pop(7))
    assert any("346" in k for k in failing(c))
    _p, c = read(tmp_path, extra_comuna=99999)
    assert any("códigos" in k for k in failing(c))                       # un código que no está en codigos_territoriales.csv


def test_geojson_polygon_without_population_fails_but_comuna_without_polygon_is_informative(tmp_path):
    _p, c = read(tmp_path)
    ok = P.reconcile(c, REF_CUTS, REF_CUTS - {"12202"})
    assert all(v[0] for v in ok.values())
    extra = P.reconcile(c, REF_CUTS, REF_CUTS | {"99999"})
    assert any(not v[0] and "polígonos sin población" in v[1] for v in extra.values())


def test_name_differences_are_informative_only(tmp_path):
    _p, c = read(tmp_path)
    names = {cut: ("Otro nombre" if cut == "13101" else x.name) for cut, x in c.comunas.items()}
    assert [d[0] for d in P.name_differences(c, names)] == ["13101"]
    assert failing(c) == []


def test_publication_date_is_parsed_from_the_note_and_absent_is_none(tmp_path):
    _p, c = read(tmp_path, published="4 de diciembre, 2025")
    assert c.published == date(2025, 12, 4)
    _p, c = read(tmp_path, nota=False)
    assert c.published is None


@pytest.mark.skipif(not os.environ.get("CENSO_D1_XLSX"), reason="define CENSO_D1_XLSX con el original del INE para contrastar con las cifras reales")
def test_real_file_figures():
    c = P.read_workbook(os.environ["CENSO_D1_XLSX"])
    assert len(c.comunas) == 346 and c.pais.total == 18_480_432 and c.published == date(2025, 3, 27)
    assert c.comunas["13101"].trio.total == 438_856 and c.comunas["13201"].trio.total == 568_086 and c.comunas["15102"].trio.total == 861
    assert [k for k, (ok, _d) in P.reconcile(c, REF_CUTS, REF_CUTS - {"12202"}).items() if not ok] == []


# ------------------------------------------------------------------------------------------------ CLI (subproceso)
def run_cli(args, env_extra=None):
    env = {k: v for k, v in os.environ.items() if k not in ("SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-W", "ignore", "-B", str(ETL / "censo_poblacion.py"), *args], capture_output=True, text=True, env=env, timeout=180)


def tree():
    return sorted(str(p) for p in ETL.rglob("*") if p.is_file() and "__pycache__" not in str(p) and ".pytest_cache" not in str(p))


def test_cli_dry_run_ok_prints_verdict_and_writes_nothing(tmp_path):
    p = make_workbook(tmp_path / "D1.xlsx")
    before = tree()
    r = run_cli(["--dry-run", "--file", str(p), "--declared-date", "2025-12-04"], {"CENSO_OUT_DIR": str(tmp_path / "out")})
    assert r.returncode == 0, r.stdout + r.stderr
    out = r.stdout
    assert "DRY-RUN (no se escribe NADA" in out and "LISTO para cargar" in out and "población censada" in out.lower() and "NO es proyección" in out
    assert "PUBLICACIÓN ........ 2025-03-27" in out and "Fecha de la copia .. 2025-12-04" in out and "CC BY-SA 4.0" in out and "[NO COMPROBADO]" in out
    assert "346 comunas · 6228 filas de edad" in out and "✘" not in out
    assert tree() == before and not (tmp_path / "out").exists()


def test_cli_json_and_exit_codes(tmp_path):
    p = make_workbook(tmp_path / "D1.xlsx")
    r = run_cli(["--dry-run", "--json", "--file", str(p)])
    assert r.returncode == 0, r.stderr
    s = json.loads(r.stdout)
    assert s["ready"] and s["censo"]["comunas"] == 346 and s["censo"]["edad_rows"] == 6228 and len(s["sha256"]) == 64 and s["declared_date"] == "2025-03-27"
    bad = make_workbook(tmp_path / "bad.xlsx", tweak=lambda sh: sh["2"][4].__setitem__(6, sh["2"][4][6] + 1))
    r = run_cli(["--dry-run", "--file", str(bad)])
    assert r.returncode == 2 and "NO SE CARGA" in r.stdout and "✘" in r.stdout
    assert run_cli(["--dry-run", "--file", str(tmp_path / "no_existe.xlsx")]).returncode == 3
    broken = tmp_path / "roto.xlsx"
    broken.write_bytes(b"no es un xlsx")
    assert run_cli(["--dry-run", "--file", str(broken)]).returncode == 2


# ------------------------------------------------------------------------------------------------ carga real a la base de PRUEBA
URL = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(scope="module")
def conn():
    if not URL:
        pytest.skip("define TEST_DATABASE_URL (base de PRUEBA con 20261104000000 aplicada)")
    import psycopg
    c = psycopg.connect(URL, autocommit=True)
    name = c.execute("select current_database()").fetchone()[0]
    if "test" not in name:
        pytest.skip(f"la base {name!r} no parece de prueba: no se toca")
    if c.execute("select to_regclass('public.poblacion_comunal')").fetchone()[0] is None:
        pytest.skip("la base no tiene aplicada 20261104000000_censo_poblacion")

    def clean():
        src = "select id from public.data_sources where source_key = %s"
        c.execute("truncate public.poblacion_comunal_stage, public.poblacion_comunal_edad_stage")
        c.execute("delete from public.poblacion_comunal")
        c.execute(f"delete from public.source_checks where source_id in ({src})", (P.SOURCE_KEY,))
        c.execute(f"delete from public.source_snapshots where source_id in ({src})", (P.SOURCE_KEY,))
    clean()
    yield c
    clean()                                                                    # la base de prueba queda como estaba: otras suites cuentan sus propias capturas
    c.close()


def test_load_publishes_checks_values_and_is_idempotent(conn, tmp_path):
    p = make_workbook(tmp_path / "D1.xlsx")
    env = {"SUPABASE_DB_URL": URL, "CENSO_OUT_DIR": str(tmp_path / "out")}
    r = run_cli(["--file", str(p), "--no-storage", "--declared-date", "2025-12-04"], env)
    assert r.returncode == 0, r.stdout + r.stderr
    assert '"result": "published"' in r.stdout
    com = synthetic()
    got = {cut: (n, rg, t, h, m) for cut, n, rg, t, h, m in conn.execute("select cut, comuna, region_cut, total, hombres, mujeres from public.get_poblacion_comunal()").fetchall()}
    assert got == {cut: (v[2], v[0], v[3], v[4], v[5]) for cut, v in com.items()}
    ed = conn.execute("select count(*), sum(total) from public.get_poblacion_comunal_edad()").fetchone()
    assert ed == (346 * 18, sum(v[3] for v in com.values()))
    snap = conn.execute("select status, row_count_raw, rejected_count, declared_date, period_start, period_end, capture_method from public.source_snapshots "
                        "where source_id in (select id from public.data_sources where source_key = %s)", (P.SOURCE_KEY,)).fetchall()
    assert snap == [("loaded", 346, 0, date(2025, 3, 27), date(2024, 1, 1), date(2024, 12, 31), "manual_download")]
    assert conn.execute("select count(*) from public.poblacion_comunal_stage").fetchone()[0] == 0
    r2 = run_cli(["--file", str(p), "--no-storage"], env)
    assert r2.returncode == 0 and '"result": "already_loaded"' in r2.stdout


def test_load_is_all_or_nothing_when_the_base_revalidates(conn, tmp_path):
    conn.execute("delete from public.poblacion_comunal")
    conn.execute("delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s)", (P.SOURCE_KEY,))
    bad = make_workbook(tmp_path / "bad.xlsx", tweak=lambda sh: sh["2"][4].__setitem__(6, sh["2"][4][6] + 1))
    r = run_cli(["--file", str(bad), "--no-storage"], {"SUPABASE_DB_URL": URL, "CENSO_OUT_DIR": str(tmp_path / "out")})
    assert r.returncode == 2                                                    # el ETL ya lo detiene antes de tocar la base
    assert conn.execute("select count(*) from public.poblacion_comunal").fetchone()[0] == 0
    assert conn.execute("select count(*) from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s)", (P.SOURCE_KEY,)).fetchone()[0] == 0
