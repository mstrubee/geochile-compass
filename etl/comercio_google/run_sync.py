#!/usr/bin/env python3
"""
run_sync.py — Entry point del ETL Red Comercial Nacional vía Google Places.

Uso:
  # Sync completo (extrae Google Places + escribe en DB)
  python -m etl.comercio_google.run_sync

  # Solo extraer y guardar CSV (debug, sin escribir en DB)
  python -m etl.comercio_google.run_sync --dry-run

  # Logs detallados
  python -m etl.comercio_google.run_sync --verbose

Variables de entorno requeridas (.env o GitHub Secrets):
  VITE_GOOGLE_MAPS_KEY  (o GOOGLE_MAPS_API_KEY)
  SUPABASE_URL
  SYNC_API_TOKEN
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
import time
from pathlib import Path

from .config import setup_logging, validate_env
from . import extractor
from . import supplement

# Reutiliza la capa de sync del módulo OSM (misma Edge Function, sin cambios).
# El primer sync de Google elimina los registros OSM automáticamente porque
# la lógica de soft-delete borra todo lo que no aparece en la lista entrante.
from etl.comercio_osm import sync

OUTPUT_DIR = Path(__file__).parent.parent / "output"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="ETL Red Comercial Nacional — Google Places → Supabase"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Solo extrae y guarda CSV; no escribe en la DB",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Logging en nivel DEBUG",
    )
    parser.add_argument(
        "--skip-supplement", action="store_true",
        help="Omite el suplemento Text Search (solo Nearby Search)",
    )
    args = parser.parse_args()

    log = setup_logging(logging.DEBUG if args.verbose else logging.INFO)

    # ── Validar entorno ─────────────────────────────────────────────────────
    if not args.dry_run:
        try:
            validate_env()
        except EnvironmentError as exc:
            log.error(str(exc))
            return 1

    # ── Cargar catálogo de marcas desde la DB ───────────────────────────────
    if not args.dry_run:
        log.info("Cargando catálogo de marcas desde brand_catalog…")
        sync.load_db_catalog()

    # ── Extracción Nearby Search ────────────────────────────────────────────
    log.info("═══ Fase 1: Nearby Search (grilla geográfica) ═══")
    t_start = time.time()
    records = extractor.extract_all()
    elapsed = time.time() - t_start
    log.info("Nearby Search completado en %.1fs — %d registros únicos", elapsed, len(records))

    if not records:
        log.warning("No se extrajeron registros. Verifica la API key y los permisos.")
        return 1

    # ── Suplemento Text Search por marca ─────────────────────────────────────
    if not args.skip_supplement:
        log.info("═══ Fase 2: Text Search suplemento por marca ═══")
        t_sup = time.time()
        seen_ids = {r["osm_id"] for r in records}
        sup_records = supplement.run_supplement(seen_ids)
        log.info(
            "Suplemento completado en %.1fs — %d registros adicionales",
            time.time() - t_sup, len(sup_records),
        )
        records = records + sup_records
        log.info("Total combinado: %d registros únicos", len(records))
    else:
        log.info("Suplemento omitido (--skip-supplement)")

    # ── Guardar CSV de diagnóstico ───────────────────────────────────────────
    OUTPUT_DIR.mkdir(exist_ok=True)
    csv_path = OUTPUT_DIR / "comercio_google_extract.csv"
    fieldnames = [
        "osm_id", "nombre", "marca", "marca_estandar",
        "categoria", "subcategoria", "cadena",
        "direccion", "comuna", "region",
        "latitud", "longitud", "fuente",
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)
    log.info("CSV de diagnóstico guardado: %d filas → %s", len(records), csv_path)

    if args.dry_run:
        log.info("Modo --dry-run: sync omitida. Revisa el CSV en %s", csv_path)
        return 0

    # ── Sincronización incremental → Supabase ────────────────────────────────
    log.info("═══ Inicio sync incremental → Supabase ═══")
    t_sync = time.time()
    stats  = sync.sync_all(records)
    log.info("Sync completada en %.1fs", time.time() - t_sync)
    log.info(
        "Resultado: +%d nuevos  ~%d actualizados  ✗%d eliminados  =%d sin cambio",
        stats["nuevos"], stats["actualizados"], stats["eliminados"], stats["sin_cambio"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
