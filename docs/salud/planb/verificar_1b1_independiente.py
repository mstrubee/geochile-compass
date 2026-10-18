"""Verificación INDEPENDIENTE de la pregunta 1b-1 (Fase 1b): recalcula desde los archivos originales, sin pasar por el ETL ni por el lector de etl/salud/isapre.py.
Uso:  python -I verificar_1b1_independiente.py <directorio>   donde <directorio> contiene establecimientos_20261014.csv y dl_isapre/cartera2025.xlsx,
y una base local con la captura cargada llamada isa_real (puerto 5433). Solo LEE. El resultado debe coincidir con get_isapre_resumen_sin_alta('hospital', 12).
"""
import csv, sys, unicodedata, subprocess, openpyxl
S = sys.argv[1]
norm = lambda s: " ".join("".join(c for c in unicodedata.normalize("NFKD", str(s)) if not unicodedata.combining(c)).lower().replace("´", "").replace("'", "").split())
# 1) conjunto de comunas con alta complejidad (definición «hospital» y «ampliada») desde el CSV, sin pasar por la base
rows = list(csv.DictReader(open(f"{S}/establecimientos_20261014.csv", encoding="utf-8-sig"), delimiter=";"))
vig = [r for r in rows if r["EstadoFuncionamiento"].strip().lower().startswith("vigente")]
alta = [r for r in vig if r["NivelComplejidadEstabGlosa"].startswith("Alta")]
hosp = {r["ComunaCodigo"] for r in alta if r["TipoEstablecimientoGlosa"].strip() == "Hospital"}
print("comunas con hospital de alta complejidad (CSV):", len(hosp))
amp = {r["ComunaCodigo"] for r in alta if r["TipoEstablecimientoGlosa"].strip() in ("Hospital", "Clínica", "Centro de Especialidades")}
print("(ampliada, tipos Hospital/Clínica/Centro de Especialidades):", len(amp), "[definición exacta de la base: ver DISENO §2]")
# 2) la base
q = lambda sql: subprocess.run(["psql", "-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "isa_real", "-Atc", sql], capture_output=True, text=True).stdout.split("\n")
db_hosp = {l for l in q("select cut from public._health_comunas_sin_alta('hospital')") if l}
all_cuts = {l.split("|")[0]: l.split("|")[1] for l in q("select cut, name from public.comunas") if l}
sin_csv = set(all_cuts) - hosp
print("sin hospital alta: CSV", len(sin_csv), "base", len(db_hosp), "iguales:", sin_csv == db_hosp)
# 3) suma de 60+ desde el XLSX directo con openpyxl (hojas «Cotizantes (F|M|SI)» y «Cargas (F|M|SI)»; tramos 60-64..>=100 = columnas 13ª..21ª de los 22 tramos)
wb = openpyxl.load_workbook(f"{S}/dl_isapre/cartera2025.xlsx", read_only=True, data_only=True)
byname = {norm(n): c for c, n in all_cuts.items()}
tot = 0; unmatched = set(); seen = set()
for sh in [f"{a} ({s})" for a in ("Cotizantes", "Cargas") for s in ("F", "M", "SI")]:
    for r in wb[sh].iter_rows(values_only=True):
        r = list(r)
        if len(r) < 26 or not isinstance(r[4], (int, float)): continue
        reg, name = r[1], r[3]
        if not name or norm(name).startswith(("total", "sin dato", "fuente", "nota")): continue
        key = norm(name)
        cut = byname.get(key)
        if cut is None: unmatched.add(str(name)); continue
        if cut in db_hosp:
            tot += sum(int(x or 0) for x in r[4 + 12:4 + 21]); seen.add(cut)
print("60+ en comunas sin hospital de alta complejidad (XLSX directo):", tot, "| comunas sumadas:", len(seen), "| nombres sin cruzar:", sorted(unmatched)[:10])
