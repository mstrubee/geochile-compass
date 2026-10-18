#!/usr/bin/env python3
"""Carga a Supabase de la población CENSADA 2024 por comuna, sexo y edad (INE, Censo 2024, tabulado D1).

  1) Ensayo (no escribe NADA): lee el XLSX, cuadra con sus propios totales y con los códigos del repo y reporta:

       python etl/censo_poblacion.py --dry-run [--file D1_Poblacion-censada-por-sexo-y-edad-en-grupos-quinquenales.xlsx --declared-date 2025-12-04] [--db]

  2) Carga real (la migración 20261104000000 debe estar aplicada):

       export SUPABASE_DB_URL=postgresql://...  SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...
       python etl/censo_poblacion.py [--file ...]

PERÍODO (año del censo) y PUBLICACIÓN (27-03-2025 en la hoja Nota; Last-Modified o --declared-date) se guardan por separado. Sin --file descarga la URL verificada.
Opciones: --origin-url · --declared-date · --db (en --dry-run, comunas de la base, solo lectura) · --no-storage · --stage-only · --json · --captured-by · --url.
Códigos de salida: 0 ok · 2 estructura o cuadre · 3 la fuente falló · 4 base de datos/Storage.
"""
import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from censo.poblacion_runner import run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="XLSX ya descargado (si falta, se descarga)")
    ap.add_argument("--origin-url", help="con --file: URL de la que se descargó")
    ap.add_argument("--declared-date", help="con --file: fecha de la copia (Last-Modified, AAAA-MM-DD); la FECHA DE PUBLICACIÓN la toma de la hoja Nota del archivo")
    ap.add_argument("--url", help="URL del XLSX (por defecto la verificada)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--db", action="store_true", help="en --dry-run, leer las comunas de la base (solo lectura)")
    ap.add_argument("--no-storage", action="store_true")
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--captured-by")
    return ap


if __name__ == "__main__":
    sys.exit(run(build_parser().parse_args()))
