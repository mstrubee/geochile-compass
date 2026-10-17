"""Acceso a Supabase/Postgres para el ETL del SEIA. Usa SUPABASE_DB_URL (conexión directa a Postgres).

El archivo ORIGINAL (las páginas del servicio, sin tocar) va a Storage (bucket privado `source-snapshots`); las filas entran
a `seia_projects`; y SOLO `seia_publish_snapshot()` mueve el puntero de la foto vigente (re-valida en la base).
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import quote

from .normalize import Parsed

COPY_COLUMNS = ("snapshot_id", "source_id", "external_id", "name", "submission_form_declared", "typology_letter",
                "typology_name", "region_declared", "comunas_declared", "comuna_cuts", "comunas_unresolved", "titular",
                "status_declared", "submitted_at", "qualified_at", "investment_usd", "expediente_url", "geom", "raw")


def connect(url: str | None = None):
    import psycopg

    url = url or os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise SystemExit("Falta SUPABASE_DB_URL (conexión directa a Postgres del proyecto Supabase).")
    return psycopg.connect(url)


def load_reference(conn, source_key: str) -> tuple[list[dict], list[dict], dict[str, float]]:
    """comunas (única fuente de CUT), alias propios de la fuente SEIA y umbrales, desde la BASE."""
    with conn.cursor() as cur:
        cur.execute("select cut, name, region_cut from public.comunas order by cut")
        comunas = [{"cut": r[0], "name": r[1], "region_cut": r[2]} for r in cur.fetchall()]
        cur.execute("""select a.raw_name_norm, a.cut from public.comuna_name_aliases a
                         join public.data_sources d on d.id = a.source_id where d.source_key = %s""", (source_key,))
        aliases = [{"name": r[0], "cut": r[1]} for r in cur.fetchall()]
        cur.execute("select key, value from public.pipeline_settings")
        settings = {k: float(v) for k, v in cur.fetchall()}
    return comunas, aliases, settings


def upload_archive(data: bytes, storage_path: str) -> None:
    import requests

    base, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir el original a Storage (o use --no-storage).")
    url = f"{base.rstrip('/')}/storage/v1/object/source-snapshots/{quote(storage_path)}"
    r = requests.post(url, data=data, timeout=300, headers={
        "Authorization": f"Bearer {key}", "apikey": key, "x-upsert": "false", "Content-Type": "application/gzip"})
    # el nombre lleva el SHA-256 del contenido: si ya existe es el MISMO contenido
    if r.status_code not in (200, 201) and not (r.status_code in (400, 409) and "exists" in r.text.lower()):
        raise RuntimeError(f"Storage rechazó la subida ({r.status_code}): {r.text[:200]}")


def record_check(conn, source_key: str, outcome: str, *, checked_by: str, sha: str | None = None,
                 latest: date | None = None, detail: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute("select id from public.data_sources where source_key = %s", (source_key,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"data_sources no tiene {source_key}: ¿se aplicó la migración de permisos (parte 1)?")
        cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                       values (%s, 'automatic', %s, %s, %s, %s, %s)""", (row[0], outcome, sha, latest, detail, checked_by))
    conn.commit()


def _ewkt(lon: float | None, lat: float | None) -> str | None:
    return None if lon is None or lat is None else f"SRID=4326;POINT({lon!r} {lat!r})"


def run_load(*, conn, source_key: str, parsed: Parsed, summary: dict, archive: bytes, content_sha: str, meta: dict,
             captured_at: datetime, declared: tuple[date | None, str], captured_by: str,
             use_storage: bool, publish: bool = True) -> dict[str, Any]:
    from psycopg.types.json import Jsonb

    out: dict[str, Any] = {"source_key": source_key}
    with conn.cursor() as cur:
        cur.execute("select id from public.data_sources where source_key = %s", (source_key,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"data_sources no tiene {source_key}: ¿se aplicó la migración de permisos (parte 1)?")
        source_id = row[0]

        cur.execute("select id, n, status from public.source_snapshots where source_id = %s and sha256 = %s", (source_id, content_sha))
        existing = cur.fetchone()
        if existing and existing[2] in ("loaded", "superseded"):
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_same_content', %s, %s, 'el servicio no cambió (mismo SHA-256 de contenido)', %s)""",
                        (source_id, content_sha, captured_at.date(), captured_by))
            conn.commit()
            return {**out, "result": "already_loaded", "snapshot_id": str(existing[0])}

        storage_path = f"{source_key}/{captured_at.year}/{content_sha}.seia.gz"
        if use_storage:
            upload_archive(archive, storage_path)

        report = {"tool": {"name": "etl/seia_proyectos.py", "format": 1}, "service_count": summary["cuadre"]["service_count"],
                  "cuadre": summary["cuadre"], "rejections": summary["rejections"], "comunas": summary["comunas"]["rows"],
                  "warnings": summary["warnings"], "pages": summary["pages"], "archive_meta": meta}
        if existing:        # reintento de un snapshot que quedó a medias o rechazado: se limpia lo suyo y se reprocesa
            snap_id = existing[0]
            cur.execute("delete from public.seia_projects where snapshot_id = %s", (snap_id,))        # cascada: validaciones
            cur.execute("delete from public.seia_rejected_rows where snapshot_id = %s", (snap_id,))
            cur.execute("""update public.source_snapshots set status = 'received', validation_report = %s, rejected_count = %s, row_count_raw = %s
                            where id = %s""", (json.dumps(report, default=str), len(parsed.rejections), parsed.features_received, snap_id))
        else:
            cur.execute("""insert into public.source_snapshots
                (source_id, captured_at, captured_by, capture_method, origin_url, storage_path, sha256, size_bytes,
                 declared_date, declared_date_note, period_start, period_end, scope, granularity,
                 row_count_raw, rejected_count, status, validation_report)
                values (%s,%s,%s,'api',%s,%s,%s,%s,%s,%s,%s,%s,'full','snapshot',%s,%s,'received',%s)
                returning id""",
                (source_id, captured_at, captured_by, summary["origin_url"], storage_path, content_sha, len(archive),
                 declared[0], declared[1], captured_at.date(), captured_at.date(),
                 parsed.features_received, len(parsed.rejections), json.dumps(report, default=str)))
            snap_id = cur.fetchone()[0]

        for rj in parsed.rejections:
            cur.execute("insert into public.seia_rejected_rows (snapshot_id, row_ref, reason_code, detail, raw) values (%s,%s,%s,%s,%s)",
                        (snap_id, json.dumps({"objectid": rj.objectid}, default=str), rj.code, rj.detail, json.dumps(rj.raw, default=str)))

        with cur.copy(f"copy public.seia_projects ({', '.join(COPY_COLUMNS)}) from stdin") as cp:
            for r in parsed.rows:
                cp.write_row((snap_id, source_id, r.external_id, r.name, r.submission_form_declared, r.typology_letter,
                              r.typology_name, r.region_declared, r.comunas_declared, r.comuna_cuts, r.comunas_unresolved,
                              r.titular, r.status_declared, r.submitted_at, r.qualified_at, r.investment_usd,
                              r.expediente_url, _ewkt(r.lon, r.lat), Jsonb(r.raw)))
        cur.execute("update public.source_snapshots set status = 'validated' where id = %s", (snap_id,))
    conn.commit()
    out.update(snapshot_id=str(snap_id), staged=len(parsed.rows))

    with conn.cursor() as cur:
        cur.execute("select public.seia_check_geometry(%s)", (snap_id,))
        out["geo_check"] = cur.fetchone()[0]
    conn.commit()
    if not publish:
        return {**out, "result": "staged"}

    try:
        with conn.cursor() as cur:
            cur.execute("select public.seia_publish_snapshot(%s)", (snap_id,))
            out["publish"] = cur.fetchone()[0]
            cur.execute("select public.seia_purge_superseded(%s)", (source_id,))
            out["purge"] = cur.fetchone()[0]
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_new_data', %s, %s, 'snapshot publicado', %s)""",
                        (source_id, content_sha, captured_at.date(), captured_by))
        conn.commit()
    except Exception as e:      # la base rechazó la publicación: queda registrado, nada cambia de foto vigente
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute("""update public.source_snapshots set status = 'rejected',
                             validation_report = validation_report || jsonb_build_object('publish_error', %s::text) where id = %s""",
                        (str(e), snap_id))
        conn.commit()
        raise
    return {**out, "result": "published"}
