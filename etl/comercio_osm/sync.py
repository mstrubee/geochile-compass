"""
sync.py — Sincronización incremental de POIs OSM → Supabase/PostGIS.

Estrategia:
  1. Carga todos los osm_id existentes en la DB (solo IDs, no geometrías).
  2. Compara con los IDs extraídos de Overpass:
       • Nuevos     → INSERT
       • Existentes → UPDATE si osm_version cambió o han pasado >7 días
       • Ausentes   → soft-delete (eliminado = TRUE)
  3. Todo en batches de UPSERT_BATCH_SIZE para no saturar el pool de conexiones.
  4. Registra el resultado en comercio_poi_sync_log.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from .config import (
    SUPABASE_DB_URL,
    TABLE_COMERCIO_POI,
    TABLE_SYNC_LOG,
    UPSERT_BATCH_SIZE,
)

log = logging.getLogger("comercio_osm.sync")


# ─────────────────────────────────────────────────────────────────────────────
# Conexión a la DB
# ─────────────────────────────────────────────────────────────────────────────

def _get_conn():
    return psycopg2.connect(SUPABASE_DB_URL, connect_timeout=30)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _batches(lst: list, size: int):
    for i in range(0, len(lst), size):
        yield lst[i : i + size]


# ─────────────────────────────────────────────────────────────────────────────
# Operaciones de DB
# ─────────────────────────────────────────────────────────────────────────────

def _load_existing_ids(conn) -> dict[str, tuple[int | None, bool]]:
    """
    Carga {osm_id: (osm_version, eliminado)} de todos los registros en la DB.
    """
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT osm_id, osm_version, eliminado FROM {TABLE_COMERCIO_POI}"
        )
        return {row[0]: (row[1], row[2]) for row in cur.fetchall()}


def _upsert_batch(conn, records: list[dict]) -> tuple[int, int]:
    """
    Inserta o actualiza un batch de registros.
    Devuelve (nuevos, actualizados).
    """
    if not records:
        return 0, 0

    sql = f"""
        INSERT INTO {TABLE_COMERCIO_POI} (
            osm_id, osm_type, nombre, marca, marca_estandar,
            categoria, subcategoria, cadena,
            direccion, comuna, region, codigo_region,
            latitud, longitud,
            geom,
            tags, fuente, osm_version,
            fecha_actualizacion, fecha_creacion, eliminado
        ) VALUES (
            %(osm_id)s, %(osm_type)s, %(nombre)s, %(marca)s, %(marca_estandar)s,
            %(categoria)s, %(subcategoria)s, %(cadena)s,
            %(direccion)s, %(comuna)s, %(region)s, %(codigo_region)s,
            %(latitud)s, %(longitud)s,
            ST_SetSRID(ST_MakePoint(%(longitud)s, %(latitud)s), 4326),
            %(tags)s::jsonb, %(fuente)s, %(osm_version)s,
            NOW(), NOW(), FALSE
        )
        ON CONFLICT (osm_id) DO UPDATE SET
            osm_type            = EXCLUDED.osm_type,
            nombre              = EXCLUDED.nombre,
            marca               = EXCLUDED.marca,
            marca_estandar      = EXCLUDED.marca_estandar,
            categoria           = EXCLUDED.categoria,
            subcategoria        = EXCLUDED.subcategoria,
            cadena              = EXCLUDED.cadena,
            direccion           = EXCLUDED.direccion,
            comuna              = EXCLUDED.comuna,
            region              = EXCLUDED.region,
            latitud             = EXCLUDED.latitud,
            longitud            = EXCLUDED.longitud,
            geom                = EXCLUDED.geom,
            tags                = EXCLUDED.tags,
            osm_version         = EXCLUDED.osm_version,
            fecha_actualizacion = NOW(),
            eliminado           = FALSE,
            fecha_eliminacion   = NULL
        RETURNING (xmax = 0) AS is_insert   -- TRUE si fue INSERT, FALSE si fue UPDATE
    """

    params_list = []
    for rec in records:
        row = dict(rec)
        # tags debe ser JSON string para psycopg2
        row["tags"] = json.dumps(row.get("tags") or {})
        params_list.append(row)

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, params_list, page_size=100)
        # execute_batch no devuelve RETURNING; contamos manualmente.
        # Para una versión más precisa usar executemany + fetchall.

    conn.commit()

    # Heurística: asumimos que registros con osm_id ya conocido son updates
    return len(records), 0   # se ajusta en sync_all


def _soft_delete_batch(conn, osm_ids: list[str]) -> int:
    """Marca como eliminados todos los osm_ids de la lista."""
    if not osm_ids:
        return 0
    total = 0
    with conn.cursor() as cur:
        for batch in _batches(osm_ids, UPSERT_BATCH_SIZE):
            cur.execute(
                f"""
                UPDATE {TABLE_COMERCIO_POI}
                SET eliminado = TRUE, fecha_eliminacion = NOW()
                WHERE osm_id = ANY(%s) AND NOT eliminado
                """,
                (batch,),
            )
            total += cur.rowcount
    conn.commit()
    return total


def _start_log(conn) -> int:
    """Inserta una fila en sync_log con status='running' y devuelve su id."""
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {TABLE_SYNC_LOG} (status) VALUES ('running') RETURNING id"
        )
        log_id = cur.fetchone()[0]
    conn.commit()
    return log_id


def _finish_log(conn, log_id: int, stats: dict, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE {TABLE_SYNC_LOG} SET
                sync_end               = NOW(),
                registros_nuevos       = %(nuevos)s,
                registros_actualizados = %(actualizados)s,
                registros_eliminados   = %(eliminados)s,
                registros_sin_cambio   = %(sin_cambio)s,
                total_osm_features     = %(total)s,
                error                  = %(error)s,
                status                 = %(status)s
            WHERE id = %(id)s
            """,
            {
                "id":          log_id,
                "nuevos":      stats.get("nuevos", 0),
                "actualizados":stats.get("actualizados", 0),
                "eliminados":  stats.get("eliminados", 0),
                "sin_cambio":  stats.get("sin_cambio", 0),
                "total":       stats.get("total", 0),
                "error":       error,
                "status":      "error" if error else "ok",
            },
        )
    conn.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Función principal de sincronización
# ─────────────────────────────────────────────────────────────────────────────

def sync_all(new_records: list[dict[str, Any]]) -> dict[str, int]:
    """
    Sincroniza la lista de registros extraídos de Overpass con la tabla
    comercio_poi de Supabase/PostGIS.

    Devuelve un dict de estadísticas.
    """
    log.info("Conectando a Supabase DB…")
    conn = _get_conn()

    log_id = _start_log(conn)
    stats: dict[str, int] = {
        "total":       len(new_records),
        "nuevos":      0,
        "actualizados":0,
        "eliminados":  0,
        "sin_cambio":  0,
    }

    try:
        # ── Cargar estado actual de la DB ───────────────────────────────────
        log.info("Cargando IDs existentes en la DB…")
        existing = _load_existing_ids(conn)
        existing_ids = set(existing.keys())
        incoming_ids = {r["osm_id"] for r in new_records}

        log.info("  DB: %d registros  |  OSM: %d registros", len(existing_ids), len(incoming_ids))

        # ── Clasificar registros ────────────────────────────────────────────
        to_insert: list[dict] = []
        to_update: list[dict] = []

        for rec in new_records:
            oid = rec["osm_id"]
            if oid not in existing_ids:
                to_insert.append(rec)
            else:
                db_version, db_eliminado = existing[oid]
                new_version = rec.get("osm_version")
                # Actualizar si: versión cambió, estaba eliminado, o versión desconocida
                if db_eliminado or db_version != new_version or new_version is None:
                    to_update.append(rec)
                else:
                    stats["sin_cambio"] += 1

        # ── Soft-delete de POIs que ya no existen en OSM ───────────────────
        ids_to_delete = [
            oid for oid in existing_ids
            if oid not in incoming_ids and not existing[oid][1]  # solo los no eliminados
        ]

        # ── Ejecutar operaciones en la DB ───────────────────────────────────
        if to_insert:
            log.info("Insertando %d registros nuevos…", len(to_insert))
            t0 = time.time()
            for i, batch in enumerate(_batches(to_insert, UPSERT_BATCH_SIZE), 1):
                _upsert_batch(conn, batch)
                if i % 5 == 0:
                    log.info("  … %d/%d insertados", min(i * UPSERT_BATCH_SIZE, len(to_insert)), len(to_insert))
            stats["nuevos"] = len(to_insert)
            log.info("  ✓ %d inserts en %.1fs", len(to_insert), time.time() - t0)

        if to_update:
            log.info("Actualizando %d registros…", len(to_update))
            t0 = time.time()
            for batch in _batches(to_update, UPSERT_BATCH_SIZE):
                _upsert_batch(conn, batch)
            stats["actualizados"] = len(to_update)
            log.info("  ✓ %d updates en %.1fs", len(to_update), time.time() - t0)

        if ids_to_delete:
            log.info("Marcando como eliminados: %d registros…", len(ids_to_delete))
            stats["eliminados"] = _soft_delete_batch(conn, ids_to_delete)
            log.info("  ✓ %d soft-deletes", stats["eliminados"])

        _finish_log(conn, log_id, stats)
        log.info(
            "═══ Sync completada: +%d nuevos, ~%d actualizados, ✗%d eliminados, =%d sin cambio ═══",
            stats["nuevos"], stats["actualizados"], stats["eliminados"], stats["sin_cambio"],
        )

    except Exception as exc:
        log.error("Error durante la sync: %s", exc, exc_info=True)
        _finish_log(conn, log_id, stats, error=str(exc))
        raise

    finally:
        conn.close()

    return stats


# ─────────────────────────────────────────────────────────────────────────────
# Inicializar / poblar brand_catalog en la DB (run once)
# ─────────────────────────────────────────────────────────────────────────────

def seed_brand_catalog() -> None:
    """
    Puebla la tabla brand_catalog con todas las entradas del catálogo Python.
    Es idempotente (usa INSERT … ON CONFLICT DO UPDATE).
    """
    from . import catalog as cat
    from .config import TABLE_BRAND_CATALOG

    entries = cat.all_entries()
    log.info("Poblando brand_catalog con %d entradas…", len(entries))

    conn = _get_conn()
    try:
        sql = f"""
            INSERT INTO {TABLE_BRAND_CATALOG} (raw_name, marca_estandar, categoria, subcategoria, color_hex, icon_emoji)
            VALUES (%(raw)s, %(marca)s, %(cat)s, %(subcat)s, %(color)s, %(icon)s)
            ON CONFLICT (LOWER(raw_name)) DO UPDATE SET
                marca_estandar = EXCLUDED.marca_estandar,
                categoria      = EXCLUDED.categoria,
                subcategoria   = EXCLUDED.subcategoria,
                color_hex      = EXCLUDED.color_hex,
                icon_emoji     = EXCLUDED.icon_emoji
        """
        params = []
        seen_raw = set()
        for raw, entry in entries:
            r = raw.lower()
            if r in seen_raw:
                continue
            seen_raw.add(r)
            params.append({
                "raw":   raw,
                "marca": entry["marca_estandar"],
                "cat":   entry["categoria"],
                "subcat":entry.get("subcategoria"),
                "color": entry.get("color", "#6B7280"),
                "icon":  entry.get("icon", "📍"),
            })

        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, params, page_size=200)
        conn.commit()
        log.info("  ✓ brand_catalog poblado con %d entradas únicas", len(params))
    finally:
        conn.close()
