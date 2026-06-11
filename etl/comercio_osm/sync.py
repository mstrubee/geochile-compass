"""
sync.py — Sincronización incremental POIs OSM → Supabase via Edge Function.

Estrategia idéntica a la versión psycopg2, pero las escrituras van a través
de la Edge Function `sync-comercio-osm` autenticada con SYNC_API_TOKEN.
La Edge Function usa internamente el service_role key (gestionado por Lovable).

Flujo:
  1. Carga osm_id+version existentes por categoría (via Edge Function).
  2. Clasifica: nuevos / actualizar / sin cambio.
  3. Upsert en batches de UPSERT_BATCH_SIZE.
  4. Soft-delete de los osm_ids que ya no aparecen en OSM (por categoría).
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from .config import (
    SYNC_API_ENDPOINT,
    SYNC_API_TOKEN,
    UPSERT_BATCH_SIZE,
)

log = logging.getLogger("comercio_osm.sync")

# ─────────────────────────────────────────────────────────────────────────────
# HTTP helper
# ─────────────────────────────────────────────────────────────────────────────

def _call(action: str, **payload) -> dict:
    """POST a la Edge Function; lanza excepción si la respuesta no es 2xx."""
    resp = requests.post(
        SYNC_API_ENDPOINT,
        json={"action": action, **payload},
        headers={
            "Authorization": f"Bearer {SYNC_API_TOKEN}",
            "Content-Type": "application/json",
        },
        timeout=120,
    )
    try:
        body = resp.json()
    except Exception:
        body = {"raw": resp.text}

    if not resp.ok:
        raise RuntimeError(f"Edge Function error [{resp.status_code}]: {body}")

    return body


def _batches(lst: list, size: int):
    for i in range(0, len(lst), size):
        yield lst[i: i + size]


# ─────────────────────────────────────────────────────────────────────────────
# Operaciones DB (via Edge Function)
# ─────────────────────────────────────────────────────────────────────────────

def _load_existing_ids(
    categorias: set[str],
) -> dict[str, tuple[int | None, str]]:
    """
    Devuelve {osm_id: (osm_version, categoria)} consultando la Edge Function
    por cada categoría.
    """
    result: dict[str, tuple[int | None, str]] = {}
    for cat in categorias:
        data = _call("get_existing_ids", categoria=cat)
        for row in data.get("data") or []:
            result[row["osm_id"]] = (row.get("osm_version"), cat)
    return result


def _upsert_batch(records: list[dict]) -> None:
    """Envía un batch de registros al Edge Function para upsert."""
    if not records:
        return
    clean = []
    for rec in records:
        r = dict(rec)
        r["tags"] = r.get("tags") or {}   # asegurar dict (no string)
        clean.append(r)
    _call("upsert", records=clean)


def _soft_delete_batch(osm_ids: list[str], categoria: str) -> None:
    """Marca como eliminados los osm_ids de una categoría dada."""
    if not osm_ids:
        return
    for batch in _batches(osm_ids, UPSERT_BATCH_SIZE):
        _call("soft_delete", categoria=categoria, osm_ids=batch)


# ─────────────────────────────────────────────────────────────────────────────
# Función principal
# ─────────────────────────────────────────────────────────────────────────────

def sync_all(new_records: list[dict[str, Any]]) -> dict[str, int]:
    """
    Sincroniza la lista de registros extraídos de Overpass con Supabase
    a través de la Edge Function sync-comercio-osm.

    Devuelve estadísticas del proceso.
    """
    stats: dict[str, int] = {
        "total":        len(new_records),
        "nuevos":       0,
        "actualizados": 0,
        "eliminados":   0,
        "sin_cambio":   0,
    }

    # Categorías presentes en este lote de extracción
    categorias = {r["categoria"] for r in new_records}

    log.info("Cargando IDs existentes para %d categorías…", len(categorias))
    existing = _load_existing_ids(categorias)
    existing_ids  = set(existing.keys())
    incoming_ids  = {r["osm_id"] for r in new_records}

    log.info("  DB: %d  |  OSM: %d registros", len(existing_ids), len(incoming_ids))

    # ── Clasificar ─────────────────────────────────────────────────────────
    to_insert: list[dict] = []
    to_update: list[dict] = []

    for rec in new_records:
        oid = rec["osm_id"]
        if oid not in existing_ids:
            to_insert.append(rec)
        else:
            db_version, _ = existing[oid]
            new_version = rec.get("osm_version")
            if db_version != new_version or new_version is None:
                to_update.append(rec)
            else:
                stats["sin_cambio"] += 1

    # ── Soft-delete por categoría ──────────────────────────────────────────
    # Agrupar osm_ids desaparecidos de OSM por la categoría que tenían en DB
    cat_to_delete: dict[str, list[str]] = {}
    for oid in existing_ids:
        if oid not in incoming_ids:
            _, cat = existing[oid]
            cat_to_delete.setdefault(cat, []).append(oid)

    # ── Ejecutar en la DB (via Edge Function) ──────────────────────────────
    if to_insert:
        log.info("Insertando %d registros nuevos…", len(to_insert))
        t0 = time.time()
        for i, batch in enumerate(_batches(to_insert, UPSERT_BATCH_SIZE), 1):
            _upsert_batch(batch)
            if i % 5 == 0:
                log.info("  … %d/%d", min(i * UPSERT_BATCH_SIZE, len(to_insert)), len(to_insert))
        stats["nuevos"] = len(to_insert)
        log.info("  ✓ %d inserts en %.1fs", len(to_insert), time.time() - t0)

    if to_update:
        log.info("Actualizando %d registros…", len(to_update))
        t0 = time.time()
        for batch in _batches(to_update, UPSERT_BATCH_SIZE):
            _upsert_batch(batch)
        stats["actualizados"] = len(to_update)
        log.info("  ✓ %d updates en %.1fs", len(to_update), time.time() - t0)

    if cat_to_delete:
        for cat, ids in cat_to_delete.items():
            log.info("Soft-delete %d registros de '%s'…", len(ids), cat)
            _soft_delete_batch(ids, cat)
            stats["eliminados"] += len(ids)
        log.info("  ✓ %d total soft-deletes", stats["eliminados"])

    log.info(
        "═══ Sync completada: +%d nuevos, ~%d actualizados, ✗%d eliminados, =%d sin cambio ═══",
        stats["nuevos"], stats["actualizados"], stats["eliminados"], stats["sin_cambio"],
    )
    return stats


# ─────────────────────────────────────────────────────────────────────────────
# Poblar brand_catalog (run once / --seed-catalog)
# ─────────────────────────────────────────────────────────────────────────────

def seed_brand_catalog() -> None:
    """
    Puebla brand_catalog con todas las entradas del catálogo Python.
    Idempotente (upsert por marca_normalizada + categoría).
    """
    from . import catalog as cat

    entries_raw = cat.all_entries()
    log.info("Poblando brand_catalog con %d entradas…", len(entries_raw))

    params: list[dict] = []
    seen: set[str] = set()
    for raw, entry in entries_raw:
        key = raw.lower()
        if key in seen:
            continue
        seen.add(key)
        params.append({
            "raw_name":       raw,
            "marca_estandar": entry["marca_estandar"],
            "categoria":      entry["categoria"],
            "subcategoria":   entry.get("subcategoria"),
            "color_hex":      entry.get("color", "#6B7280"),
            "icon_emoji":     entry.get("icon", "📍"),
        })

    for batch in _batches(params, UPSERT_BATCH_SIZE):
        _call("seed_catalog", entries=batch)

    log.info("  ✓ brand_catalog poblado con %d entradas únicas", len(params))
