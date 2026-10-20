#!/usr/bin/env python3
"""Carga a Supabase de la capacidad hospitalaria: camas de dotación (DEIS/DIGERA) y ocupación REM 20 (DEIS/MINSAL, datos.gob.cl, CC0).

  1) Ensayo (no escribe NADA): lee los archivos, valida cada cuadre, imprime los controles de Hospital Luis Tisné y Hospital San Luis (Buin):

       python etl/salud_capacidad.py --dry-run [--source rem20|dotacion|all] [--rem20-file Indicadores_REM20.csv] [--dotacion-file "Dotación de camas 2010-2025 ... SNSS.xlsx"] [--db]

  2) Carga real (la migración 20261108000000 y los establecimientos 1a deben estar aplicados):

       export SUPABASE_DB_URL=postgresql://...  SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...
       python etl/salud_capacidad.py [--source all]

Sin --rem20-file la URL VIGENTE se resuelve por CKAN (package_show; la URL del recurso lleva la fecha y cambia) y se registra la URL efectiva en source_snapshots.origin_url.
Sin --dotacion-file se busca «Dotación de camas 2010-<año> Establecimientos Pertenecientes al SNSS.xlsx» con el año más nuevo que exista (--dotacion-year fija el año).
Opciones: --rem20-origin-url / --dotacion-origin-url (con archivo local: de dónde lo descargó) · --rem20-declared-date / --dotacion-declared-date (AAAA-MM-DD, fecha de modificación) ·
--db (en --dry-run, empalma con la captura vigente de establecimientos, solo lectura) · --no-storage · --stage-only · --json · --captured-by · --ckan-url.
Códigos de salida: 0 ok · 2 estructura o cuadre · 3 la fuente falló · 4 base de datos/Storage.
"""
import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from salud.capacidad_runner import run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["rem20", "dotacion", "all"], default="all")
    ap.add_argument("--rem20-file", help="CSV ya descargado (si falta, se descarga por CKAN)")
    ap.add_argument("--rem20-origin-url", help="con --rem20-file: URL de la que se descargó")
    ap.add_argument("--rem20-declared-date", help="con --rem20-file: fecha de modificación (AAAA-MM-DD)")
    ap.add_argument("--rem20-url", help="URL del CSV (en vez de resolverla por CKAN)")
    ap.add_argument("--ckan-url", help=argparse.SUPPRESS)
    ap.add_argument("--dotacion-file", help="XLSX ya descargado (si falta, se descarga)")
    ap.add_argument("--dotacion-origin-url", help="con --dotacion-file: URL de la que se descargó")
    ap.add_argument("--dotacion-declared-date", help="con --dotacion-file: fecha de modificación (AAAA-MM-DD)")
    ap.add_argument("--dotacion-year", type=int, help="año final del nombre del archivo (por defecto, el más nuevo que exista)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--db", action="store_true", help="en --dry-run, empalmar con los establecimientos de la base (solo lectura)")
    ap.add_argument("--no-storage", action="store_true")
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--captured-by")
    return ap


if __name__ == "__main__":
    sys.exit(run(build_parser().parse_args()))
