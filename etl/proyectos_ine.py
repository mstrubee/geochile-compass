#!/usr/bin/env python3
"""Carga a Supabase de los permisos georreferenciados (PE_NACIONAL, puntos) y las recepciones finales (CRF_NACIONAL, polígonos) del INE.

COMANDO ÚNICO. Corre en TU máquina (la sesión de desarrollo no alcanza el servicio del INE):

  1) Ensayo: no escribe NADA (ni base, ni Storage, ni disco). Descarga las dos capas, valida y reporta conteos, rechazos,
     validación geográfica, calidad de las geometrías y el cuadre externo con MINVU:

       python etl/proyectos_ine.py --dry-run [--minvu-file ./PE...anual....xlsx | --db]

  2) Carga real (la misma línea sin --dry-run):

       export SUPABASE_DB_URL=postgresql://...  SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...
       python etl/proyectos_ine.py

Opciones: --layer pe|crf|all · --stage-only (no publica) · --no-storage (no sube el GeoJSON normalizado; queda copia local en etl/output/proyectos/) ·
--no-geocheck · --json · --base-url (para pruebas) · --page-size.
Códigos de salida: 0 ok · 2 campos/estructura · 3 conteos del servidor no cuadran o la fuente falló · 4 base de datos/Storage · 5 rechazos sobre el máximo.
"""
import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from proyectos.runner import run_ine  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--layer", choices=["pe", "crf", "all"], default="all")
    ap.add_argument("--dry-run", action="store_true", help="solo imprime el reporte; no escribe nada")
    ap.add_argument("--db", action="store_true", help="en --dry-run, leer comunas y MINVU de la base (solo lectura)")
    ap.add_argument("--minvu-file", help="archivo ANUAL de MINVU para el cuadre externo (diagnóstico)")
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
    sys.exit(run_ine(build_parser().parse_args()))
