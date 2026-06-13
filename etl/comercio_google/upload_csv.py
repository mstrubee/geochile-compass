#!/usr/bin/env python3
"""
upload_csv.py — Carga red_comercial_final.csv a Supabase via Edge Function.

Uso:
  python -m etl.comercio_google.upload_csv --csv /ruta/red_comercial_final.csv

Requiere en .env o variables de entorno:
  SUPABASE_URL      → https://xxxx.supabase.co
  SYNC_API_TOKEN    → token compartido con la Edge Function
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from .config import setup_logging, validate_env
from etl.comercio_osm import sync


def csv_to_records(csv_path: Path) -> list[dict]:
    records = []
    with open(csv_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            records.append({
                "osm_id":         row["osm_id"],
                "osm_type":       "node",
                "nombre":         row.get("nombre") or None,
                "marca":          row.get("marca") or None,
                "marca_estandar": row.get("marca_estandar") or "Otros",
                "categoria":      row.get("categoria") or None,
                "subcategoria":   row.get("subcategoria") or None,
                "cadena":         row.get("cadena") or None,
                "direccion":      row.get("direccion") or None,
                "comuna":         row.get("comuna") or None,
                "region":         row.get("region") or None,
                "codigo_region":  None,
                "latitud":        float(row["latitud"]) if row.get("latitud") else None,
                "longitud":       float(row["longitud"]) if row.get("longitud") else None,
                "tags":           {},
                "fuente":         row.get("fuente") or "kml",
                "osm_version":    None,
            })
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    log = setup_logging(logging.DEBUG if args.verbose else logging.INFO)

    try:
        validate_env()
    except EnvironmentError as exc:
        log.error(str(exc))
        return 1

    log.info("Leyendo CSV: %s", args.csv)
    records = csv_to_records(args.csv)
    log.info("%d registros cargados", len(records))

    log.info("Cargando catálogo de marcas…")
    sync.load_db_catalog()

    log.info("Iniciando sync → Supabase…")
    t = time.time()
    stats = sync.sync_all(records)
    log.info("Sync completado en %.1fs", time.time() - t)
    log.info(
        "Resultado: +%d nuevos  ~%d actualizados  ✗%d eliminados  =%d sin cambio",
        stats["nuevos"], stats["actualizados"], stats["eliminados"], stats["sin_cambio"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
