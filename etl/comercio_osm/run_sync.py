#!/usr/bin/env python3
"""
run_sync.py — Entry point del ETL de Red Comercial Nacional.

Uso:
  # Sincronización completa (extrae Overpass + sincroniza DB)
  python -m etl.comercio_osm.run_sync

  # Solo poblar brand_catalog (primera vez)
  python -m etl.comercio_osm.run_sync --seed-catalog

  # Solo extraer y guardar a CSV (debug, sin escribir en la DB)
  python -m etl.comercio_osm.run_sync --dry-run

  # Categoría específica
  python -m etl.comercio_osm.run_sync --categoria farmacia

Variables de entorno requeridas en .env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

from .config import setup_logging, validate_env, CATEGORY_TAG_MAP
from . import extractor, sync

OUTPUT_DIR = Path(__file__).parent.parent / "output"


def main() -> int:
    parser = argparse.ArgumentParser(description="ETL Red Comercial Nacional — OSM → Supabase")
    parser.add_argument(
        "--categoria",
        choices=list(CATEGORY_TAG_MAP.keys()),
        default=None,
        help="Extraer solo esta categoría (por defecto: todas)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Solo extrae y guarda CSV; no escribe en la DB",
    )
    parser.add_argument(
        "--seed-catalog",
        action="store_true",
        help="Poblar brand_catalog en la DB y salir",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Logging en nivel DEBUG",
    )
    args = parser.parse_args()

    import logging
    log = setup_logging(logging.DEBUG if args.verbose else logging.INFO)

    # ── Validar entorno ─────────────────────────────────────────────────────
    if not args.dry_run:
        try:
            validate_env()
        except EnvironmentError as e:
            log.error(str(e))
            return 1

    # ── Opción: seed del catálogo ────────────────────────────────────────────
    if args.seed_catalog:
        log.info("Poblando brand_catalog…")
        sync.seed_brand_catalog()
        log.info("Listo.")
        return 0

    # ── Extracción OSM ───────────────────────────────────────────────────────
    log.info("═══ Inicio extracción OSM ═══")
    t_start = time.time()

    if args.categoria:
        # Extracción de una sola categoría
        from . import overpass as ov
        tag_filters = CATEGORY_TAG_MAP[args.categoria]
        elements    = ov.fetch_category(tag_filters, args.categoria)
        records     = []
        for el in elements:
            rec = extractor._osm_element_to_record(el, forced_categoria=args.categoria)
            if rec:
                records.append(rec)
        log.info("Categoría '%s': %d registros normalizados", args.categoria, len(records))
    else:
        records = extractor.extract_all()

    log.info("Extracción completada en %.1fs — %d registros totales", time.time() - t_start, len(records))

    if not records:
        log.warning("No se extrajeron registros. Verifica la conexión a Overpass.")
        return 1

    # ── Guardar CSV de diagnóstico ───────────────────────────────────────────
    OUTPUT_DIR.mkdir(exist_ok=True)
    csv_path = OUTPUT_DIR / "comercio_osm_extract.csv"
    log.info("Guardando CSV de diagnóstico → %s", csv_path)
    fieldnames = [
        "osm_id", "osm_type", "nombre", "marca", "marca_estandar",
        "categoria", "subcategoria", "cadena",
        "direccion", "comuna", "region",
        "latitud", "longitud", "fuente",
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)
    log.info("  CSV guardado: %d filas", len(records))

    # ── Dry-run: no escribir en la DB ────────────────────────────────────────
    if args.dry_run:
        log.info("Modo --dry-run: sync omitida. Revisa el CSV en %s", csv_path)
        return 0

    # ── Sincronización incremental ───────────────────────────────────────────
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
