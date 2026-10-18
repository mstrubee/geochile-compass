"""ETL de CASEN regional (Fase 1b). DATOS 100 % SINTÉTICOS: una «encuesta» inventada (16 regiones, estratos y conglomerados) y un tabulado oficial inventado con la
estructura del real (hoja 3: bloques Estimación / Población expandida / Error estándar / Casos muestrales y notas de «no fiable»). Las cifras reales (96 estimaciones,
67 publicables, coincidencia con el tabulado oficial a 3·10^-6 pp) se verifican con los archivos reales en el informe de la fase.
"""
import json
import math
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

ETL = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ETL))
sys.dont_write_bytecode = True

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")
openpyxl = pytest.importorskip("openpyxl")
from salud import casen as C  # noqa: E402

REGION_NAMES = {1: "Tarapacá", 2: "Antofagasta", 3: "Atacama", 4: "Coquimbo", 5: "Valparaíso", 6: "O'Higgins", 7: "Maule", 8: "Biobío", 9: "La Araucanía", 10: "Los Lagos", 11: "Aysén",
                12: "Magallanes", 13: "Región Metropolitana", 14: "Los Ríos", 15: "Arica y Parinacota", 16: "Ñuble"}
SIS_LABEL = {"fonasa": "Sistema Público FONASA", "isapre": "Isapre", "ffaa": "FF.AA. y del Orden", "ninguno": "Ninguno (particular)", "otro": "Otro sistema", "nosabe": "No sabe"}


def survey(seed=1, strata=3, psu=20, per_psu=8):
    """Encuesta SINTÉTICA: por región `strata` estratos × `psu` conglomerados × `per_psu` personas; pesos y previsión inventados."""
    rng = np.random.default_rng(seed)
    rows = []
    for reg in range(1, 17):
        for h in range(strata):
            for j in range(psu):
                for _ in range(per_psu):
                    p = rng.random()
                    s13 = 1 if p < 0.78 else 2 if p < 0.96 else 3 if p < 0.985 else 4 if p < 0.998 else 5 if p < 0.9995 else -88
                    rows.append((reg, float(rng.integers(20, 200)), reg * 100000 + h, reg * 10000000 + h * 1000 + j, s13))
    return pd.DataFrame(rows, columns=["region", "expr", "varstrat", "varunit", "s13"])


def make_official(path, ests, df, *, tweak=None, notes=True, drop_year=False):
    """Tabulado oficial INVENTADO con la estructura de la hoja 3: lo que dice es lo que calculó el propio ETL (así se prueba el mecanismo del contraste)."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "3"
    ws.append(["Índice"] + [None] * 10)
    ws.append(["Distribución de la población según sistema previsional de salud (2006-2024), por región"])
    ws.append(["Porcentaje"])
    ws.append([None])
    rt = C.region_totals(df)

    def block(label, getter, total):
        ws.append([label] * 3 + [None] * 8) if label != "Estimación" else ws.append(["Estimación"] * 10)
        ws.append(["Categoría", "Desagregación", "2020", "2022", None if drop_year else 2024] if not drop_year else ["Categoría", "Desagregación", "2020", "2022", "2023"])
        for reg in range(1, 17):
            cut = f"{reg:02d}"
            for e in sorted((x for x in ests if x.region_cut == cut), key=lambda x: list(SIS_LABEL).index(x.sistema)):
                ws.append([REGION_NAMES[reg], SIS_LABEL[e.sistema], 1, 2, getter(e)])
            ws.append([REGION_NAMES[reg], "Total", 1, 2, total(cut)])
        ws.append([None])
    block("Estimación", lambda e: e.pct + (tweak or 0 if (e.region_cut, e.sistema) == ("03", "isapre") else 0), lambda c: 100)
    block("Población expandida", lambda e: 1, lambda c: int(round(rt[c]["pop"])))
    block("Error estándar", lambda e: e.se, lambda c: 0)
    block("Casos muestrales", lambda e: e.n_sample, lambda c: rt[c]["n"])
    if notes:
        ws.append(["Fuente: Ministerio de Desarrollo Social y Familia, Encuesta Casen."])
        ws.append(['En Casen 2024, categoría "Otro sistema" en regiones Tarapacá, Antofagasta, Atacama, O´Higgins, Araucanía, Metropolitana y Ñuble presentan estimación No fiable por tamaño muestral.'])
        ws.append(['En Casen 2024, categoría "Ninguno" en Región de Magallanes presenta estimación No fiable por tamaño muestral.'])
    wb.save(path)


# ------------------------------------------------------------------------------------------------ estadística
def test_t_quantile_matches_known_values():
    assert abs(C.t_quantile(30) - 2.0423) < 5e-4 and abs(C.t_quantile(100) - 1.9840) < 5e-4 and abs(C.t_quantile(1000) - 1.9623) < 5e-4 and abs(C.t_quantile(10 ** 6) - 1.95996) < 1e-4
    with pytest.raises(C.StructureError, match="grados de libertad"):
        C.t_quantile(10)


def test_taylor_variance_equals_the_closed_form_for_simple_random_sampling():
    """Un estrato, peso igual, cada persona su propio conglomerado: V(p̂) = p(1−p)/(n−1) (lo que da la fórmula de linealización)."""
    n, k = 400, 100
    df = pd.DataFrame({"region": [1] * n, "expr": [50.0] * n, "varstrat": [1] * n, "varunit": list(range(n)), "s13": [2] * k + [1] * (n - k)})
    e = {x.sistema: x for x in C.estimate(df)}["isapre"]
    p = k / n
    assert abs(e.pct - 25.0) < 1e-9 and abs(e.se - 100 * math.sqrt(p * (1 - p) / (n - 1))) < 1e-9
    assert e.n_sample == k and e.n_psu == n and e.n_strata == 1 and e.df == n - 1


def test_weights_and_clusters_change_the_error_as_expected():
    """Con conglomerados de 3 personas idénticas el error es MAYOR que tratando a cada persona como independiente (efecto de diseño > 1)."""
    rng = np.random.default_rng(3)
    base = (rng.random(200) < 0.2).astype(int)
    y = np.repeat(base, 3)
    mk = lambda unit: pd.DataFrame({"region": [1] * 600, "expr": [10.0] * 600, "varstrat": [1] * 600, "varunit": unit, "s13": np.where(y == 1, 2, 1)})  # noqa: E731
    clustered = {x.sistema: x for x in C.estimate(mk(np.repeat(np.arange(200), 3)))}["isapre"]
    srs = {x.sistema: x for x in C.estimate(mk(np.arange(600)))}["isapre"]
    assert abs(clustered.pct - srs.pct) < 1e-9 and clustered.se > 1.5 * srs.se


def test_percentages_per_region_sum_to_100_and_intervals_are_ordered():
    ests = C.estimate(survey())
    assert len(ests) == 96
    for r in C.REGIONS:
        assert abs(sum(e.pct for e in ests if e.region_cut == r) - 100) < 1e-9
    assert all(0 <= e.ci_lo <= e.pct <= e.ci_hi <= 100 and e.se >= 0 for e in ests) and min(e.df for e in ests) == 3 * 20 - 3


def test_read_sav_rejects_unknown_codes_and_missing_values(tmp_path):
    pyreadstat = pytest.importorskip("pyreadstat")
    df = survey()
    p = tmp_path / "ok.sav"
    pyreadstat.write_sav(df, str(p))
    assert len(C.read_sav(p)) == len(df)
    bad = df.copy()
    bad.loc[0, "s13"] = 9
    pyreadstat.write_sav(bad, str(tmp_path / "bad.sav"))
    with pytest.raises(C.StructureError, match="códigos de s13"):
        C.read_sav(tmp_path / "bad.sav")
    miss = df.copy()
    miss.loc[0, "expr"] = float("nan")
    pyreadstat.write_sav(miss, str(tmp_path / "miss.sav"))
    with pytest.raises(C.StructureError, match="perdidos"):
        C.read_sav(tmp_path / "miss.sav")


# ------------------------------------------------------------------------------------------------ tabulado oficial y publicabilidad
def test_read_official_blocks_totals_and_unreliable_notes(tmp_path):
    df = survey()
    ests = C.estimate(df)
    p = tmp_path / "t.xlsx"
    make_official(p, ests, df)
    off = C.read_official(p)
    assert len(off.pct) == 96 and len(off.se) == 96 and len(off.n) == 96 and len(off.pop) == 96 and len(off.n_total) == 16 and len(off.pop_total) == 16
    assert all(abs(off.pct[(e.region_cut, e.sistema)] - e.pct) < 1e-9 for e in ests)
    # «Araucanía», «O´Higgins» (acento agudo) y «Metropolitana» de las notas se resuelven; «Ninguno» solo en Magallanes
    assert {r for (r, s) in off.unreliable if s == "otro"} == {"01", "02", "03", "06", "09", "13", "16"}
    assert {(r, s) for (r, s) in off.unreliable if s == "ninguno"} == {("12", "ninguno")}
    assert len(off.notes) == 2


def test_publishable_needs_60_cases_and_no_official_unreliable_flag(tmp_path):
    df = survey()
    ests = C.estimate(df)
    p = tmp_path / "t.xlsx"
    make_official(p, ests, df)
    off = C.read_official(p)
    C.finalize(ests, off)
    by = {(e.region_cut, e.sistema): e for e in ests}
    assert by[("13", "isapre")].publishable and by[("13", "isapre")].reason is None
    assert not by[("13", "otro")].publishable and "no fiable" in by[("13", "otro")].reason                       # nota oficial
    small = [e for e in ests if e.n_sample < 60]
    assert small and all(not e.publishable and "60 casos" in e.reason for e in small)                              # < 60 casos
    assert all(e.publishable for e in ests if e.n_sample >= 60 and (e.region_cut, e.sistema) not in off.unreliable)


def test_compare_ok_and_detects_a_deviation(tmp_path):
    df = survey()
    ests = C.estimate(df)
    ok = tmp_path / "ok.xlsx"
    make_official(ok, ests, df)
    assert C.compare(ests, C.read_official(ok))["ok"]
    bad = tmp_path / "bad.xlsx"
    make_official(bad, ests, df, tweak=0.01)
    cmp_ = C.compare(ests, C.read_official(bad))
    assert not cmp_["ok"] and cmp_["max_diff_pct_pp"] >= 0.0099


def test_official_without_2024_column_is_a_structure_error(tmp_path):
    df = survey()
    p = tmp_path / "t.xlsx"
    make_official(p, C.estimate(df), df, drop_year=True)
    with pytest.raises(C.StructureError, match="2024"):
        C.read_official(p)


def test_no_comunal_output_exists_anywhere():
    """D6: el módulo solo agrupa por región; ninguna estructura de salida lleva comuna."""
    ests = C.estimate(survey())
    assert all(hasattr(e, "region_cut") and not hasattr(e, "comuna_cut") and not hasattr(e, "comuna") for e in ests)
    assert set(C.REGIONS) == {f"{i:02d}" for i in range(1, 17)}


# ------------------------------------------------------------------------------------------------ CLI (subproceso)
def run_cli(args, env_extra=None):
    env = {k: v for k, v in os.environ.items() if k not in ("SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    env.update(env_extra or {})
    return subprocess.run([sys.executable, "-W", "ignore", "-B", str(ETL / "salud_casen.py"), *args], capture_output=True, text=True, env=env, timeout=300)


def tree():
    return sorted(str(p) for p in ETL.rglob("*") if p.is_file() and "__pycache__" not in str(p) and ".pytest_cache" not in str(p))


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    pyreadstat = pytest.importorskip("pyreadstat")
    d = tmp_path_factory.mktemp("casen")
    df = survey()
    pyreadstat.write_sav(df, str(d / "casen_2024.sav"))
    make_official(d / "ok.xlsx", C.estimate(df), df)
    make_official(d / "bad.xlsx", C.estimate(df), df, tweak=0.01)
    # estrato con UN solo conglomerado: el tabulado «oficial» es el del propio cálculo, así que el contraste pasa y solo ese motivo detiene la carga
    lonely = df.copy()
    lonely = lonely[~((lonely["region"] == 5) & (lonely["varstrat"] == 500000) & (lonely["varunit"] != 50000000))]
    pyreadstat.write_sav(lonely, str(d / "lonely.sav"))
    make_official(d / "lonely.xlsx", C.estimate(lonely), lonely)
    return d


def test_cli_dry_run_ok_and_writes_nothing(files):
    before = tree()
    r = run_cli(["--dry-run", "--sav", str(files / "casen_2024.sav"), "--tabulado", str(files / "ok.xlsx"), "--declared-date", "2026-06-10", "--work-dir", str(files)])
    assert r.returncode == 0, r.stdout + r.stderr
    out = r.stdout
    assert "DRY-RUN (no se escribe NADA)" in out and "Estimada (siempre RANGO con IC 95 %)" in out and "SOLO regional (D6)" in out
    assert "PERÍODO ............ 2024" in out and "PUBLICACIÓN ........ 2026-06-10" in out and "NO DECLARADA" in out and "[NO COMPROBADO]" in out
    assert "✔ personas y población expandida" in out and "✔ estimación propia vs oficial" in out and "LISTO para cargar" in out
    assert tree() == before


def test_cli_json_and_exit_codes(files):
    r = run_cli(["--dry-run", "--json", "--sav", str(files / "casen_2024.sav"), "--tabulado", str(files / "ok.xlsx")])
    assert r.returncode == 0, r.stderr
    s = json.loads(r.stdout)
    assert s["ready"] and s["estimates"] == 96 and s["regions"] == 16 and s["compare"]["ok"] and s["publishable"] + s["not_publishable"] == 96 and len(s["sha256"]) == 64
    r = run_cli(["--dry-run", "--sav", str(files / "casen_2024.sav"), "--tabulado", str(files / "bad.xlsx")])
    assert r.returncode == 5 and "NO SE CARGA" in r.stdout                                                   # la estimación no coincide con el oficial
    assert run_cli(["--dry-run", "--sav", str(files / "no_existe.sav"), "--tabulado", str(files / "ok.xlsx")]).returncode in (2, 3)


def test_lonely_stratum_is_reported_and_blocks_the_load(files):
    r = run_cli(["--dry-run", "--sav", str(files / "lonely.sav"), "--tabulado", str(files / "lonely.xlsx")])
    assert r.returncode == 5, r.stdout + r.stderr
    assert "NO SE CARGA" in r.stdout and "un solo conglomerado" in r.stdout
    assert "✔ estimación propia vs oficial" in r.stdout                                                    # el contraste pasa: solo el estrato solitario detiene la carga
    j = json.loads(run_cli(["--dry-run", "--json", "--sav", str(files / "lonely.sav"), "--tabulado", str(files / "lonely.xlsx")]).stdout)
    assert j["lonely"] == 6 and not j["ready"]                                                             # 6 sistemas de la región 05 ven el estrato
    ok = json.loads(run_cli(["--dry-run", "--json", "--sav", str(files / "casen_2024.sav"), "--tabulado", str(files / "ok.xlsx")]).stdout)
    assert ok["lonely"] == 0 and ok["ready"]


def test_estimate_counts_lonely_strata_per_region():
    df = survey()
    df = df[~((df["region"] == 5) & (df["varstrat"] == 500000) & (df["varunit"] != 50000000))]
    ests = C.estimate(df)
    assert {e.region_cut for e in ests if e.lonely_strata} == {"05"} and all(e.lonely_strata == 1 for e in ests if e.region_cut == "05")
