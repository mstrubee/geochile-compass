#!/usr/bin/env python3
"""Siembra y verificación de la tabla `comunas` (ÚNICA fuente de CUT de la base).

  python etl/permisos_comunas.py seed [--dry-run]   # crea/actualiza comunas, geometrías (con reparación auditada) y alias
  python etl/permisos_comunas.py check              # exit 1 si la base y public/comunas.geojson / codigos_territoriales.csv divergen

Usa SUPABASE_DB_URL. `check` es seguro para correr en CI o antes de desplegar.
"""
import sys

sys.dont_write_bytecode = True

import argparse
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from permisos import db, seed  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["seed", "check"])
    ap.add_argument("--dry-run", action="store_true", help="seed: hace todo y revierte (no deja cambios)")
    args = ap.parse_args(argv)
    conn = db.connect()
    try:
        if args.action == "seed":
            stats = seed.seed(conn, dry_run=args.dry_run)
            print(json.dumps(stats, ensure_ascii=False, indent=2, default=str))
            flagged = {k: v for k, v in stats["results"].items() if v.get("status") not in ("ok", "absent")}
            if flagged:
                print("\nGeometrías reparadas o que requieren revisión:")
                for cut, r in flagged.items():
                    print(f"  {cut}: {r}")
            return 0
        problems = seed.check(conn)
        if problems:
            print("DIVERGENCIA entre la base y los archivos del repo:")
            for p in problems:
                print("  ✘", p)
            return 1
        print("OK: la tabla `comunas` coincide con codigos_territoriales.csv y comunas.geojson (346 comunas, 345 geometrías).")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
