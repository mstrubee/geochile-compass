#!/usr/bin/env python3
"""Carga a Supabase de la cartera de beneficiarios Isapre por comuna, edad y sexo (Superintendencia de Salud).

  1) Ensayo (no escribe NADA): lee el XLSX, cruza comunas a CUT con alias explícitos, cuadra contra los totales del propio archivo (con datos completos),
     aplica la supresión de conteos pequeños (regla 5) y reporta:

       python etl/salud_isapre.py --dry-run [--file estadistica-anual-de-cartera-de-beneficiarios-comunal-2025.xlsx --declared-date 2026-01-28] [--db]

  2) Carga real (la migración 20261103000000 debe estar aplicada):

       export SUPABASE_DB_URL=postgresql://...  SUPABASE_URL=https://xxxx.supabase.co  SUPABASE_SERVICE_ROLE_KEY=...
       python etl/salud_isapre.py [--file ...]

Los conteos COMPLETOS van al esquema restringido salud_restringido; la base suprime y re-valida al publicar. PERÍODO (del archivo) y PUBLICACIÓN
(Last-Modified o --declared-date) se guardan por separado. Sin --file descarga la URL verificada de dic-2025.
Opciones: --origin-url · --declared-date · --no-storage · --stage-only · --json · --captured-by.
Códigos de salida: 0 ok · 2 estructura o cuadre · 3 la fuente falló · 4 base de datos/Storage · 5 rechazos sobre el máximo.
"""
import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from salud.isapre_runner import run  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="XLSX ya descargado (si falta, se descarga)")
    ap.add_argument("--origin-url", help="con --file: URL de la que se descargó")
    ap.add_argument("--declared-date", help="con --file: fecha de PUBLICACIÓN (AAAA-MM-DD), p. ej. el Last-Modified")
    ap.add_argument("--url", help="URL del XLSX (por defecto la verificada de dic-2025)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--db", action="store_true", help="en --dry-run, leer comunas y umbrales de la base (solo lectura)")
    ap.add_argument("--no-storage", action="store_true")
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--captured-by")
    return ap


if __name__ == "__main__":
    sys.exit(run(build_parser().parse_args()))
