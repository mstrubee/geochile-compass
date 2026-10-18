"""ETL de la cartera Isapre (Fase 1b). DATOS 100 % SINTÉTICOS (nombres «FIXTURE», conteos inventados): reproducen la ESTRUCTURA y las rarezas del XLSX real
(hojas por rol y sexo, número de región 20/'-'/0, filas de subtotal regional, «Sin dato Comuna», O'Higgins con apóstrofo tipográfico) sin redistribuir cifras reales.
Las cifras reales (2.517.305 beneficiarios, 23.958 celdas, 2.783 primarias…) se verifican con el archivo real en el informe de la fase.

La prueba de carga contra Postgres (TEST_DATABASE_URL) corre solo si la base se llama *test* y tiene aplicada 20261103000000_isapre_cartera.
"""
import json
import os
import random
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import pytest

ETL = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ETL))
sys.dont_write_bytecode = True

openpyxl = pytest.importorskip("openpyxl")
from salud import isapre as I  # noqa: E402

COMUNAS = [{"cut": "13101", "name": "Santiago", "region_cut": "13"}, {"cut": "13102", "name": "Cerrillos", "region_cut": "13"},
           {"cut": "11302", "name": "OHiggins", "region_cut": "11"}, {"cut": "05101", "name": "Valparaiso", "region_cut": "05"}]
ALIASES = [{"region_cut": "11", "name": "O'Higgins", "cut": "11302"}]
ROLES_SHEET = {("cotizante", "F"): "Cotizantes (F)", ("cotizante", "M"): "Cotizantes (M)", ("cotizante", "SI"): "Cotizantes (SI)",
               ("carga", "F"): "Cargas (F)", ("carga", "M"): "Cargas (M)", ("carga", "SI"): "Cargas (SI)"}


def vec(**kw) -> list[int]:
    v = [0] * 22
    for k, x in kw.items():
        v[int(k[1:])] = x                      # vec(t4=60) → tramo 4
    return v


def rand_vec(rng: random.Random, small=0.1, zero=0.55) -> list[int]:
    return [0 if rng.random() < zero else (rng.randint(1, 4) if rng.random() < small else rng.randint(5, 60)) for _ in range(22)]


# unidad: (región int, provincia, nombre en el archivo) -> {(rol, sexo): vector}
def make_workbook(path, units: dict, *, region_total_delta=0, pais_delta=0, drop_sheet=None, month=("DICIEMBRE", 2025), sdr=None, tot_alt_delta=0):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Indice"
    ws.append([None, None, "ESTADÍSTICA ANUAL FIXTURE"])
    ws.append([None, None])
    ws.append([None, None, None, None, month[0], month[1]])
    sheets = {}

    def sheet(name):
        s = wb.create_sheet(name)
        for r in range(6):
            s.append([None] * 4)
        s.append(["N°", "Nombre", None, None] + I.TRAMOS)           # fila 7 (encabezado de tramos)
        sheets[name] = s
        return s

    def total_row(s, label, region, vals):
        s.append([region, label, "-", "-"] + vals + [sum(vals)])

    def data_rows(names, getter):
        for name in names:
            s = sheet(name)
            by_region: dict[int, list[int]] = {}
            for (reg, prov, com), per in units.items():
                v = getter(per)
                s.append([reg, f"Región {reg:02d}", prov, com] + v + [sum(v)])
                cur = by_region.setdefault(reg, [0] * 22)
                by_region[reg] = [a + b for a, b in zip(cur, v)]
            sdr_v = getter(sdr) if sdr else [0] * 22
            for reg, v in sorted(by_region.items()):
                vv = list(v)
                if reg == min(by_region):
                    vv[5] += region_total_delta
                s.append([reg, f"Región {reg:02d}", "-", "-"] + vv + [sum(vv)])
            if sdr:
                s.append([0, "Sin dato Region", "Sin dato Provincia", "Sin dato Comuna"] + sdr_v + [sum(sdr_v)])
            tot = [sum(x) for x in zip(*by_region.values())]
            tot = [a + b for a, b in zip(tot, sdr_v)]
            tot[5] += pais_delta
            s.append([20, "Total Pais", "-", "-"] + tot + [sum(tot)])
            s.append([None, "Fecha extracción de información:", datetime(2026, 1, 22)])
    for (rol, sexo), name in ROLES_SHEET.items():
        data_rows([name], lambda per, rol=rol, sexo=sexo: per.get((rol, sexo), [0] * 22))
    for rol, name in (("cotizante", "Cotizantes"), ("carga", "Cargas")):
        data_rows([name], lambda per, rol=rol: [sum(per.get((rol, s), [0] * 22)[i] for s in I.SEXOS) for i in range(22)])
    for rol, name in (("cotizante", "Total Cotizantes"), ("carga", "Total Cargas")):
        data_rows([name], lambda per, rol=rol: [sum(per.get((rol, s), [0] * 22)[i] for s in I.SEXOS) + (tot_alt_delta if i == 3 else 0) for i in range(22)])
    wb.create_sheet("Notas")
    wb.create_sheet("Ficha Metadatos")
    if drop_sheet:
        del wb[drop_sheet]
    wb.save(path)


def units_basic():
    return {(13, "Provincia Santiago", "Santiago"): {("cotizante", "F"): vec(t4=60, t5=150, t12=40, t13=30, t21=3), ("cotizante", "M"): vec(t4=50, t12=20), ("carga", "F"): vec(t0=12, t1=9, t2=2),
                                                  ("carga", "SI"): vec(t0=1)},
            (13, "Provincia Santiago", "Cerrillos"): {("cotizante", "F"): vec(t5=7, t6=9), ("carga", "M"): vec(t12=2)},
            (11, "Provincia Capitán Prat", "O’Higgins"): {("cotizante", "F"): vec(t7=30, t14=6)},
            (5, "Provincia Valparaíso", "Valparaíso"): {("cotizante", "M"): vec(t9=15)}}


def read(tmp_path, units=None, **kw):
    p = tmp_path / "cartera.xlsx"
    make_workbook(p, units or units_basic(), **kw)
    return p, I.read_workbook(p, COMUNAS, ALIASES)


# ------------------------------------------------------------------------------------------------ lectura y cruce
def test_read_period_units_alias_and_sin_dato(tmp_path):
    sdr = {("cotizante", "F"): vec(t21=15)}
    p, c = read(tmp_path, sdr=sdr)
    assert (c.period_month, c.period_year) == (12, 2025) and str(c.extraction_date) == "2026-01-22"
    assert set(c.units) == {"13101", "13102", "11302", "05101", "SDR"}
    assert c.units["11302"].kind == "comuna" and c.units["SDR"].kind == "sin_dato_region" and c.units["SDR"].region_cut is None     # O’Higgins (apóstrofo tipográfico) cruza por alias
    assert c.unit_rows == 5 and not c.rejections
    assert c.counts[("13101", "cotizante", "F")][4] == 60 and c.counts[("13101", "carga", "SI")][0] == 1


def test_unknown_comuna_is_rejected_with_code_not_guessed(tmp_path):
    u = units_basic()
    u[(13, "Provincia Santiago", "Comuna Inventada")] = {("cotizante", "F"): vec(t3=9)}
    _p, c = read(tmp_path, u)
    assert [r.code for r in c.rejections] == ["cut_unknown"] and "Comuna Inventada" in c.rejections[0].detail
    assert "13101" in c.units and c.unit_rows == len(c.units) + 1


def test_sin_dato_comuna_row_per_region(tmp_path):
    u = units_basic()
    u[(13, "Sin dato Provincia", "Sin dato Comuna")] = {("cotizante", "F"): vec(t5=11)}
    _p, c = read(tmp_path, u)
    assert "SDC13" in c.units and c.units["SDC13"].kind == "sin_dato_comuna" and c.units["SDC13"].region_cut == "13"


def test_missing_sheet_and_missing_period_are_structure_errors(tmp_path):
    p = tmp_path / "x.xlsx"
    make_workbook(p, units_basic(), drop_sheet="Cargas (SI)")
    with pytest.raises(I.StructureError, match="faltan hojas"):
        I.read_workbook(p, COMUNAS, ALIASES)
    make_workbook(p, units_basic(), month=("NADA", "x"))
    with pytest.raises(I.StructureError, match="período"):
        I.read_workbook(p, COMUNAS, ALIASES)


def test_row_total_not_matching_tramos_is_structure_error(tmp_path):
    p = tmp_path / "x.xlsx"
    make_workbook(p, units_basic())
    wb = openpyxl.load_workbook(p)
    wb["Cotizantes (F)"].cell(row=8, column=27).value = 1                       # la columna «total» de la primera fila
    wb.save(p)
    with pytest.raises(I.StructureError, match="fila total"):
        I.read_workbook(p, COMUNAS, ALIASES)


# ------------------------------------------------------------------------------------------------ cuadres con los totales del propio archivo
def test_reconcile_ok_on_consistent_workbook(tmp_path):
    p, c = read(tmp_path)
    rec = I.reconcile(c, p)
    assert rec and all(ok for ok, _ in rec.values()), {k: v for k, v in rec.items() if not v[0]}


@pytest.mark.parametrize("kw,needle", [({"region_total_delta": 1}, "subtotal regional"), ({"pais_delta": 3}, "Total País"), ({"tot_alt_delta": 1}, "idéntica")])
def test_reconcile_detects_inconsistent_totals(tmp_path, kw, needle):
    p, c = read(tmp_path, **kw)
    rec = I.reconcile(c, p)
    assert any((not ok) and needle in k for k, (ok, _) in rec.items()), rec


# ------------------------------------------------------------------------------------------------ supresión (réplica del algoritmo de la base)
def sup(values):
    return I.suppress_group(values)


def test_primary_zero_published_and_total_rule():
    g = sup(vec(t4=100, t5=200, t6=1, t7=4, t8=5))
    cells = {c.tramo: c for c in g.cells}
    assert cells[6].suppressed and cells[6].kind == "primary" and cells[7].kind == "primary" and not cells[8].suppressed      # 5 se publica
    assert cells[0].n_pub == 0 and not cells[0].suppressed                                                                  # el cero se publica
    assert g.total_pub == 310 and g.suppressed_cells == 2 and g.residual == 5 and g.cuadre_ok


def test_single_primary_forces_complementary_smallest_ge_threshold_lowest_tramo_on_tie():
    g = sup(vec(t12=2, t13=5, t14=5, t15=9))
    cells = {c.tramo: c for c in g.cells}
    assert cells[12].kind == "primary" and cells[13].kind == "complementary" and not cells[14].suppressed and g.suppressed_cells == 2
    assert (cells[13].lo, cells[13].hi) == (5, 6) and (cells[12].lo, cells[12].hi) == (1, 2) and g.residual == 7 and g.cuadre_ok


def test_total_below_threshold_is_suppressed_and_no_complementary_needed():
    g = sup(vec(t21=1))
    assert g.total_pub is None and g.suppressed_cells == 1 and g.residual is None and g.cuadre_ok and not any(c.kind == "complementary" for c in g.cells)
    g3 = sup(vec(t2=1, t7=1, t11=1))
    assert g3.total_pub is None and g3.suppressed_cells == 3
    assert sup([0] * 22).total_pub == 0 and sup([0] * 22).suppressed_cells == 0


def test_bounds_contain_the_real_value_and_hi_never_exceeds_residual():
    v = vec(t4=6, t5=8, t6=3, t9=5)
    g = sup(v)
    for c in g.cells:
        if c.suppressed:
            assert c.lo <= v[c.tramo] <= c.hi <= g.residual


@pytest.mark.parametrize("pairs,case", [
    ({"t5": 1, "t8": 1, "t9": 30}, "k·1 (R = Σ cotas inferiores)"),
    ({"t5": 4, "t8": 4, "t9": 30}, "k·4 sin complementaria (R = 4·k)"),
    ({"t5": 1, "t6": 5, "t7": 9}, "1 + complementaria de 5 (R = Σ cotas inferiores)"),
    ({"t2": 1, "t3": 1, "t4": 1, "t5": 1}, "total «<5» con cuatro celdas de 1 (caso combinado)"),
])
def test_determined_group_withholds_its_total_and_publishes_bounds_without_residual(pairs, case):
    v = vec(**pairs)
    g = sup(v)
    assert g.total_withheld and g.total_pub is None and g.residual is None, case
    for c in g.cells:
        if c.suppressed:
            assert c.lo <= v[c.tramo] <= c.hi, case
            assert c.hi == 4 if c.kind == "primary" else c.hi == min(x for i, x in enumerate(v) if not g.cells[i].suppressed and x >= 5)


@pytest.mark.parametrize("pairs", [{"t5": 2, "t8": 3, "t9": 30}, {"t5": 4, "t8": 3, "t9": 30}, {"t2": 1, "t3": 1, "t4": 1}, {"t5": 1, "t6": 6, "t7": 9}])
def test_neighbour_groups_that_do_not_determine_are_not_withheld(pairs):
    g = sup(vec(**pairs))
    assert not g.total_withheld


def test_withheld_complementary_without_another_published_cell_has_no_publishable_bound():
    with pytest.raises(I.SuppressionError):
        sup(vec(t5=1, t6=5))                    # total 6 = 1 + 5 y no hay otra celda ≥ 5: la cota superior de la complementaria no existe


def test_region_withheld_replica_rules(tmp_path):
    def g(**pairs):
        return sup(vec(**pairs))
    def reg(groups, total):                 # cartera mínima en la región 01: una unidad por grupo; el replica solo necesita el total regional y los grupos
        cart = I.Cartera(12, 2025, None)
        gr = {}
        for n, gg in enumerate(groups):
            u = f"0110{n}"
            cart.units[u] = I.Unit(u, "comuna", "01", u, u)
            for sx in I.SEXOS:
                gr[(u, sx)] = gg if sx == "F" else sup([0] * 22)
        cart.counts = {("01100", "cotizante", "F"): [total] + [0] * 21}
        return I.region_withheld(cart, gr)
    one = g(t5=2)                       # «<5» de 2: único grupo sin total
    big = g(t5=30)
    assert reg([one, big], 32) == {"01"}                                        # k = 1
    assert reg([g(t5=1), g(t5=1), big], 32) == {"01"}                           # R = 2 = Σ cotas inferiores
    assert reg([g(t5=4), g(t5=4), big], 38) == {"01"}                           # R = 8 = 4·2
    assert reg([g(t5=2), g(t5=3), big], 35) == set()                            # R = 5: no determina
    ret = g(t5=1, t6=1, t7=30)          # retenido: total 32, publicado 30, Σ cotas inferiores 2
    assert ret.total_withheld
    assert reg([ret, g(t5=1)], 33) == {"01"}                                    # combinado: 32 + 1 = Σ cotas inferiores (publicadas + cotas)
    assert reg([ret, g(t5=3)], 35) == set()                                     # 35 ≠ 33


def test_property_thousands_of_random_groups():
    rng = random.Random(42)
    comp = prim = withheld_n = 0
    for _ in range(4000):
        v = rand_vec(rng, small=rng.choice([0.02, 0.1, 0.4]), zero=rng.choice([0.2, 0.55, 0.9]))
        g = sup(v)
        total = sum(v)
        pub = [c for c in g.cells if not c.suppressed]
        assert all(not (1 <= c.n_pub <= 4) for c in pub)                                              # nada de 1–4 publicado
        assert all(c.suppressed for c in g.cells if 1 <= v[c.tramo] <= 4)                             # todo 1–4 real está suprimido
        assert all(c.n_pub == v[c.tramo] for c in pub)                                                # lo publicado es lo real
        if g.total_pub is not None:
            assert g.suppressed_cells != 1                                                            # 0 o ≥ 2: no se despeja por resta
            assert g.total_pub == g.published_sum + g.residual == total
            assert not g.total_withheld
            assert not (g.suppressed_cells and (g.residual == g.lo_sum or (g.residual == 4 * g.suppressed_cells and not any(c.kind == "complementary" for c in g.cells))))   # el residuo no determina nada
        elif g.total_withheld:
            assert g.residual is None and g.suppressed_cells > 0                                      # retenido: sin total, sin residuo, sin cota «<5»
        else:
            assert 1 <= total <= 4
            assert g.lo_sum < 4                                                                       # «<5» con cuatro celdas de 1 se retiene
        assert g.cuadre_ok
        for c in g.cells:
            if c.suppressed:
                assert c.lo <= v[c.tramo] <= c.hi
                withheld_n += g.total_withheld
                prim += c.kind == "primary"
                comp += c.kind == "complementary"
        if g.total_pub is not None and g.suppressed_cells:
            comp_cell = [c for c in g.cells if c.kind == "complementary"]
            if comp_cell:
                cand = sorted((v[i], i) for i, x in enumerate(g.cells) if not x.suppressed and v[i] >= 5) + [(v[comp_cell[0].tramo], comp_cell[0].tramo)]
                assert min(cand)[1] == comp_cell[0].tramo                                             # la complementaria es la menor ≥ 5 (empate: menor tramo)
    assert prim > 1000 and comp > 100 and withheld_n > 50                                             # la prueba ejercita las tres ramas y la retención


def test_suppress_all_covers_every_unit_and_sex_even_if_absent(tmp_path):
    _p, c = read(tmp_path)
    g = I.suppress_all(c)
    assert len(g) == len(c.units) * 3 and all(len(x.cells) == 22 for x in g.values())
    # la suma completa de beneficiarios por unidad = cotizantes + cargas del archivo
    assert sum(x.total for (u, s), x in g.items() if u == "13101") == sum(sum(v) for (u, r, s), v in c.counts.items() if u == "13101")
    assert I.summarize(g)["grupos"] == len(g)


# ------------------------------------------------------------------------------------------------ CLI (subproceso)
def run_cli(args, env_extra=None):
    env = {k: v for k, v in os.environ.items() if k not in ("SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-W", "ignore", "-B", str(ETL / "salud_isapre.py"), *args], capture_output=True, text=True, env=env, timeout=180)


def tree():
    return sorted(str(p) for p in ETL.rglob("*") if p.is_file() and "__pycache__" not in str(p) and ".pytest_cache" not in str(p))


def test_cli_dry_run_ok_and_writes_nothing(tmp_path):
    p = tmp_path / "estadistica-anual-de-cartera-de-beneficiarios-comunal-2025.xlsx"
    make_workbook(p, units_basic())
    # el cruce usa public/codigos_territoriales.csv: se usan comunas REALES (Santiago, Cerrillos, Valparaíso) y el alias O'Higgins
    before = tree()
    r = run_cli(["--dry-run", "--file", str(p), "--declared-date", "2026-01-28"])
    assert r.returncode == 0, r.stdout + r.stderr
    out = r.stdout
    assert "DRY-RUN (no se escribe NADA" in out and "✔ cuadra" in out and "LISTO para cargar" in out
    assert "PERÍODO ............ 2025-12" in out and "PUBLICACIÓN ........ 2026-01-28" in out and "extracción de datos (en el archivo): 2026-01-22" in out
    assert "NO DECLARADA" in out and "política de presentación, no una protección real" in out and "[NO COMPROBADO]" in out
    assert tree() == before, "el dry-run no debe escribir archivos"


def test_cli_json_and_exit_codes(tmp_path):
    p = tmp_path / "c.xlsx"
    make_workbook(p, units_basic())
    r = run_cli(["--dry-run", "--file", str(p), "--json"])
    assert r.returncode == 0, r.stderr
    s = json.loads(r.stdout)
    assert s["ready"] and s["cartera"]["unit_rows"] == 4 and len(s["sha256"]) == 64 and s["suppression"]["threshold"] == 5
    bad = tmp_path / "bad.xlsx"
    make_workbook(bad, units_basic(), region_total_delta=1)
    r = run_cli(["--dry-run", "--file", str(bad)])
    assert r.returncode == 2 and "NO SE CARGA" in r.stdout and "✘" in r.stdout                  # un cuadre falla
    miss = tmp_path / "miss.xlsx"
    make_workbook(miss, units_basic(), drop_sheet="Cargas (F)")
    assert run_cli(["--dry-run", "--file", str(miss)]).returncode == 2                          # estructura
    assert run_cli(["--dry-run", "--file", str(tmp_path / "nada.xlsx")]).returncode == 3        # la fuente falla
    u = units_basic()
    for i in range(30):
        u[(13, "Provincia Santiago", f"Comuna Inventada {i}")] = {("cotizante", "F"): vec(t3=9)}
    many = tmp_path / "many.xlsx"
    make_workbook(many, u)
    assert run_cli(["--dry-run", "--file", str(many)]).returncode == 5                          # rechazos sobre el máximo


# ------------------------------------------------------------------------------------------------ carga real (base de PRUEBA): la base y la réplica Python coinciden
URL = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(scope="module")
def conn():
    if not URL:
        pytest.skip("define TEST_DATABASE_URL (base de PRUEBA con 20261103000000 aplicada)")
    import psycopg
    c = psycopg.connect(URL, autocommit=True)
    name = c.execute("select current_database()").fetchone()[0]
    if "test" not in name:
        pytest.skip(f"la base {name!r} no parece de prueba: no se toca")
    if c.execute("select to_regclass('public.isapre_cartera_celda')").fetchone()[0] is None:
        pytest.skip("la base no tiene aplicada 20261103000000_isapre_cartera")
    c.execute("truncate salud_restringido.isapre_stage")
    c.execute("delete from salud_restringido.isapre_unidad")
    c.execute("delete from public.isapre_cartera_unidad")
    c.execute("delete from public.geo_rejected_rows where snapshot_id in (select id from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s))", (I.SOURCE_KEY,))
    c.execute("delete from public.source_checks where source_id in (select id from public.data_sources where source_key = %s)", (I.SOURCE_KEY,))
    c.execute("delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s)", (I.SOURCE_KEY,))
    yield c
    # la base de prueba queda como estaba: otras suites (p. ej. establecimientos) cuentan sus propias capturas
    c.execute("truncate salud_restringido.isapre_stage")
    c.execute("delete from salud_restringido.isapre_unidad")
    c.execute("delete from public.isapre_cartera_unidad")
    c.execute("delete from public.geo_rejected_rows where snapshot_id in (select id from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s))", (I.SOURCE_KEY,))
    c.execute("delete from public.source_checks where source_id in (select id from public.data_sources where source_key = %s)", (I.SOURCE_KEY,))
    c.execute("delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s)", (I.SOURCE_KEY,))
    c.close()


def load(path, tmp_path, *extra):
    return run_cli(["--file", str(path), "--no-storage", "--declared-date", "2026-01-28", *extra], {"SUPABASE_DB_URL": URL, "SALUD_OUT_DIR": str(tmp_path / "out")})


def test_load_matches_python_replica_cell_by_cell_and_is_idempotent(conn, tmp_path):
    rng = random.Random(7)
    real = [("13101", "Santiago", 13), ("13102", "Cerrillos", 13), ("05101", "Valparaíso", 5), ("11302", "O’Higgins", 11)]
    u = {}
    for cut, name, reg in real:
        u[(reg, f"Provincia {reg}", name)] = {(rol, s): rand_vec(rng, small=0.15, zero=0.5) for rol in I.ROLES for s in I.SEXOS}
    u[(13, "Sin dato Provincia", "Sin dato Comuna")] = {("cotizante", "F"): vec(t5=11, t6=2)}
    p = tmp_path / "c.xlsx"
    make_workbook(p, u, sdr={("cotizante", "M"): vec(t21=3)})
    r = load(p, tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert '"result": "published"' in r.stdout
    cart = I.read_workbook(p, [{"cut": c, "name": n, "region_cut": f"{rg:02d}"} for c, n, rg in real], ALIASES)
    py = I.suppress_all(cart)
    db = {(un, s, t): (n, sp, k, lo, hi) for un, s, t, n, sp, k, lo, hi in conn.execute("select unit, sexo, tramo, n_pub, suppressed, kind, lo, hi from public.isapre_cartera_celda").fetchall()}
    exp = {(un, s, c.tramo): (c.n_pub, c.suppressed, c.kind, c.lo, c.hi) for (un, s), g in py.items() for c in g.cells}
    assert db == exp and len(db) == len(cart.units) * 3 * 22
    grp = {(un, s): (tp, ps, k, rs, ls, ok, wh) for un, s, tp, ps, k, rs, ls, ok, wh in conn.execute(
        "select unit, sexo, total_pub, published_sum, suppressed_cells, residual, lo_sum, cuadre_ok, total_withheld from public.isapre_cartera_grupo").fetchall()}
    assert grp == {k: (g.total_pub, g.published_sum, g.suppressed_cells, g.residual, g.lo_sum, g.cuadre_ok, g.total_withheld) for k, g in py.items()}
    assert any(g.total_withheld for g in py.values())                                                      # el fixture aleatorio ejercita la retención
    withheld_db = {r for (r,) in conn.execute("select distinct region_cut from public.isapre_cartera_region where total is null").fetchall()}
    assert withheld_db == I.region_withheld(cart, py)                                                       # misma regla regional en la réplica y en la base
    assert conn.execute("select count(*) from salud_restringido.isapre_stage").fetchone()[0] == 0
    snap = conn.execute("select status, row_count_raw, rejected_count, declared_date, period_start, period_end, capture_method from public.source_snapshots "
                        "where source_id in (select id from public.data_sources where source_key = %s)", (I.SOURCE_KEY,)).fetchall()
    assert snap == [("loaded", len(cart.units), 0, date(2026, 1, 28), date(2025, 12, 1), date(2025, 12, 31), "manual_download")]
    # el conteo COMPLETO está en el esquema restringido y los publicados no lo muestran
    assert conn.execute("select coalesce(sum(n), 0) from salud_restringido.isapre_cartera").fetchone()[0] == sum(sum(v) for v in cart.counts.values())
    r2 = load(p, tmp_path)
    assert r2.returncode == 0 and '"result": "already_loaded"' in r2.stdout
    assert conn.execute("select count(*) from public.source_snapshots where source_id in (select id from public.data_sources where source_key = %s)", (I.SOURCE_KEY,)).fetchone()[0] == 1


def test_load_is_all_or_nothing_when_the_base_revalidates(conn, tmp_path):
    p = tmp_path / "c2.xlsx"
    make_workbook(p, units_basic(), month=("DICIEMBRE", 2024))
    # el período 2024 es más viejo que el 2025 ya publicado: la base lo rechaza y no deja nada vigente
    r = load(p, tmp_path)
    assert r.returncode == 4 and "período más nuevo" in r.stderr
    assert conn.execute("select status from public.source_snapshots where period_end = %s", (date(2024, 12, 31),)).fetchall() == [("rejected",)]
    assert conn.execute("select count(*) from salud_restringido.isapre_stage").fetchone()[0] == 0


MIGRATIONS_1B = ["20261103000000_isapre_cartera.sql", "20261103000100_casen_prevision.sql", "20261103000200_prevision_layer_nodes.sql"]


@pytest.mark.parametrize("name", MIGRATIONS_1B)
def test_migration_without_one_transaction_fails_immediately_and_changes_nothing(conn, name):
    """Las migraciones de 1b dependen de `psql -1` (tablas ON COMMIT DROP, advisory lock y SET LOCAL de transacción): sin -1 el guardrail del inicio las detiene antes de tocar nada."""
    import shutil
    psql = shutil.which("psql")
    if not psql:
        pytest.skip("no hay psql en el PATH")
    before = conn.execute("select count(*) from public._migration_log").fetchone()[0]
    r = subprocess.run([psql, URL, "-v", "ON_ERROR_STOP=1", "-f", str(ETL.parents[0] / "supabase" / "migrations" / name)], capture_output=True, text=True, timeout=120)
    assert r.returncode != 0 and "Guardrail" in r.stderr and "UNA transacción" in r.stderr, r.stdout + r.stderr
    assert conn.execute("select count(*) from public._migration_log").fetchone()[0] == before
