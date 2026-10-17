#!/usr/bin/env python3
"""Carga a Supabase de los proyectos del SEIA (EIA y DIA) de tipologías inmobiliarias y urbanas.

COMANDO ÚNICO. Corre en TU máquina:

  1) Ensayo (no escribe NADA): descarga las capas, filtra por tipología (por LETRA), cruza comunas por nombre, valida el punto
     contra la comuna declarada y reporta conteos, rechazos y discrepancias:

       python etl/proyectos_seia.py --dry-run [--db]

  2) Carga real:

       export SUPABASE_DB_URL=postgresql://...  SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...
       python etl/proyectos_seia.py

Un nombre de comuna que no cruza NO detiene la carga (el proyecto queda comuna_unmatched); agregue un alias en etl/proyectos/aliases_seia.json.
Opciones: --layer 1|2|all · --stage-only · --no-storage · --no-geocheck · --json.
Códigos de salida: 0 ok · 2 campos/estructura · 3 conteos del servidor no cuadran o la fuente falló · 4 base de datos/Storage · 5 rechazos sobre el máximo.
"""
import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from proyectos.runner import run_seia  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--layer", choices=["1", "2", "all"], default="all", help="1 = EIA, 2 = DIA")
    ap.add_argument("--dry-run", action="store_true", help="solo imprime el reporte; no escribe nada")
    ap.add_argument("--db", action="store_true", help="en --dry-run, leer comunas, alias y reglas de la base (solo lectura)")
    ap.add_argument("--no-storage", action="store_true")
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--no-geocheck", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--captured-by")
    ap.add_argument("--base-url", help=argparse.SUPPRESS)
    ap.add_argument("--page-size", type=int, default=2000)
    ap.add_argument("--pause", type=float, default=0.2)
    return ap


if __name__ == "__main__":
    sys.exit(run_seia(build_parser().parse_args()))
