#!/usr/bin/env python3
"""Carga a Supabase de la distribución del sistema previsional de salud por REGIÓN (CASEN 2024), con error muestral. Nivel: ESTIMADA (rango con IC 95 %).

  1) Ensayo (no escribe NADA): lee la base .sav (solo 7 columnas), estima por región con linealización de Taylor, contrasta con el tabulado OFICIAL y reporta:

       python etl/salud_casen.py --dry-run [--sav casen_2024.sav --tabulado Salud_Casen_2024.xlsx]

  2) Carga real (la migración 20261103000100 debe estar aplicada):

       export SUPABASE_DB_URL=postgresql://...  SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...
       python etl/salud_casen.py [--sav ... --tabulado ...]

SOLO regional (D6): nunca comunal. No se guarda ninguna fila de persona. La base (≈ 750 MB) no se sube a Storage; se registra su SHA-256 y su URL.
Sin --sav descarga la base y el tabulado oficiales. Requiere pyreadstat (etl/requirements.txt).
Opciones: --origin-url · --declared-date · --work-dir · --no-storage · --stage-only · --json · --captured-by.
Códigos de salida: 0 ok · 2 estructura · 3 la fuente falló · 4 base de datos/Storage · 5 la estimación no coincide con el tabulado oficial o no cuadran los totales.
"""
import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from salud.casen_runner import run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sav", help="casen_2024.sav ya descargado")
    ap.add_argument("--tabulado", help="Salud_Casen_2024.xlsx ya descargado")
    ap.add_argument("--origin-url", help="con --sav: URL de la que se descargó")
    ap.add_argument("--sav-url", help=argparse.SUPPRESS)
    ap.add_argument("--tabulado-url", help=argparse.SUPPRESS)
    ap.add_argument("--declared-date", help="fecha de PUBLICACIÓN de la base (AAAA-MM-DD), p. ej. su Last-Modified")
    ap.add_argument("--work-dir", help="carpeta temporal para las descargas (por defecto /tmp)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-storage", action="store_true")
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--captured-by")
    return ap


if __name__ == "__main__":
    sys.exit(run(build_parser().parse_args()))
