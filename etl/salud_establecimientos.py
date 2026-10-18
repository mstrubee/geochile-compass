#!/usr/bin/env python3
"""Carga a Supabase del registro de establecimientos de salud (DEIS/MINSAL, datos.gob.cl, CC0).

COMANDO ÚNICO. Corre en TU máquina:

  1) Ensayo (no escribe NADA): lee el CSV, normaliza con equivalencias explícitas, rechaza con código, cuadra filas y valida cada punto
     contra la comuna que declara su registro (se MARCA, jamás se mueve):

       python etl/salud_establecimientos.py --dry-run [--file establecimientos_AAAAMMDD.csv] [--db]

  2) Carga real (la migración 20261102000000 debe estar aplicada):

       export SUPABASE_DB_URL=postgresql://...  SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...
       python etl/salud_establecimientos.py [--file establecimientos_AAAAMMDD.csv]

Sin --file descarga la URL verificada en la Fase 0 (o, con --ckan-latest, el recurso CSV más nuevo del paquete de datos.gob.cl).
Opciones: --origin-url (con --file: de dónde lo descargaste) · --no-storage · --stage-only · --no-geocheck · --json · --captured-by.
Un tipo de establecimiento nuevo (que health_tipo_clasificacion no conoce) DETIENE la carga: agregue su fila con su evidencia.
Códigos de salida: 0 ok · 2 estructura/columnas/tipos desconocidos · 3 la fuente falló · 4 base de datos/Storage · 5 rechazos sobre el máximo.
"""
import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from salud.runner import run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="CSV ya descargado (si falta, se descarga)")
    ap.add_argument("--origin-url", help="con --file: URL de la que se descargó (queda en source_snapshots.origin_url)")
    ap.add_argument("--url", help="URL del CSV (por defecto la verificada en la Fase 0)")
    ap.add_argument("--ckan-latest", action="store_true", help="elegir el recurso CSV más reciente del paquete CKAN")
    ap.add_argument("--ckan-url", help=argparse.SUPPRESS)
    ap.add_argument("--dry-run", action="store_true", help="solo imprime el reporte; no escribe nada")
    ap.add_argument("--db", action="store_true", help="en --dry-run, leer comunas, umbrales y tabla de clasificación de la base (solo lectura)")
    ap.add_argument("--no-storage", action="store_true")
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--no-geocheck", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--captured-by")
    return ap


if __name__ == "__main__":
    sys.exit(run(build_parser().parse_args()))
