#!/usr/bin/env python3
"""Impacto del cambio de fuente de población sobre `analysis_settings.small_commune_pop_threshold` (solo lectura, no toca ninguna base).

Cruza por CUT la población del CSV anterior (p. ej. `git show main:public/ine_communes.csv`, con columna `poblacion`) con la censada del D1 (XLSX) y lista
las comunas que cambian de lado respecto de cada umbral. Regla del código: pequeña ⇔ 0 < población ≤ umbral.

  git show 277deb2:public/ine_communes.csv > /tmp/ine_old.csv
  python etl/censo/impacto_umbral.py --xlsx D1_....xlsx --csv-old /tmp/ine_old.csv [--umbral 10000 --umbral 50000] [--detalle]
"""
import sys

sys.dont_write_bytecode = True

import argparse
import csv
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from censo.poblacion import read_workbook  # noqa: E402

DEFAULT = (5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--csv-old", required=True, help="CSV anterior con columnas commune_id,commune_name,poblacion")
    ap.add_argument("--umbral", type=int, action="append", help="umbral(es) a evaluar (por defecto una serie de 5.000 a 100.000)")
    ap.add_argument("--detalle", action="store_true", help="lista las comunas que cambian de lado")
    a = ap.parse_args()
    censo = read_workbook(a.xlsx)
    with open(a.csv_old, encoding="utf-8") as f:
        old = {r["commune_id"].zfill(5): (r["commune_name"], int(float(r["poblacion"]))) for r in csv.DictReader(f)}
    pares = [(cut, old[cut][0], old[cut][1], c.trio.total) for cut, c in sorted(censo.comunas.items()) if cut in old]
    print(f"comunas cruzadas por CUT: {len(pares)} · en el Censo sin CSV: {len(censo.comunas) - len(pares)} · en el CSV sin Censo: {len(set(old) - set(censo.comunas))}")
    for thr in a.umbral or DEFAULT:
        ch = [p for p in pares if (0 < p[2] <= thr) != (0 < p[3] <= thr)]
        print(f"umbral {thr:>7}: cambian de lado {len(ch):>3} (pasan a pequeña {sum(1 for p in ch if p[3] <= thr)}, dejan de serlo {sum(1 for p in ch if p[2] <= thr)})")
        if a.detalle:
            for cut, name, o, t in sorted(ch, key=lambda p: p[3]):
                print(f"    {cut} {name:<28} CSV {o:>9,} -> Censo {t:>9,}  ({'pequeña' if t <= thr else 'no pequeña'} ahora)".replace(",", "."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
