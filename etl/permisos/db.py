"""Acceso a Supabase/Postgres para el ETL de permisos. Usa SUPABASE_DB_URL (conexión directa a Postgres).

El archivo ORIGINAL va a Storage (bucket privado `source-snapshots`) con su hash; las filas pasan por la
zona de paso `permit_stage`; y SOLO `publish_permit_snapshot()` las convierte en vigentes (re-valida en la base).
"""
from __future__ import annotations

import json
import os
from datetime import date
from typing import Any
from urllib.parse import quote

from .parse_minvu import LoadPlan, Parsed, sheet_series, stage_rows

SOURCE_KEYS = {"annual": "minvu_cedoc_permisos_anual", "monthly": "minvu_cedoc_permisos_mensual"}


def connect(url: str | None = None):
    import psycopg

    url = url or os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise SystemExit("Falta SUPABASE_DB_URL (conexión directa a Postgres del proyecto Supabase).")
    return psycopg.connect(url)


def load_reference(conn) -> tuple[list[dict], list[dict], dict[str, Any]]:
    """comunas, alias (de la fuente) y umbrales desde la BASE: `comunas` es la ÚNICA fuente de CUT."""
    with conn.cursor() as cur:
        cur.execute("select cut, name, region_cut from public.comunas order by cut")
        comunas = [{"cut": r[0], "name": r[1], "region_cut": r[2]} for r in cur.fetchall()]
        cur.execute("""select a.raw_region_norm, a.raw_name_norm, a.cut, a.reason, d.source_key
                         from public.comuna_name_aliases a join public.data_sources d on d.id = a.source_id""")
        aliases = [{"region_label": r[0], "name": r[1], "cut": r[2], "reason": r[3], "source_key": r[4]} for r in cur.fetchall()]
        cur.execute("select key, value from public.pipeline_settings")
        settings = {k: float(v) for k, v in cur.fetchall()}
    return comunas, aliases, settings


def upload_original(path: str, storage_path: str) -> None:
    import requests

    base, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir el original a Storage (o use --no-storage).")
    url = f"{base.rstrip('/')}/storage/v1/object/source-snapshots/{quote(storage_path)}"
    with open(path, "rb") as f:
        r = requests.post(url, data=f, timeout=300, headers={
            "Authorization": f"Bearer {key}", "apikey": key, "x-upsert": "false",
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
    # el nombre lleva el SHA-256: si ya existe es el MISMO contenido
    if r.status_code not in (200, 201) and not (r.status_code in (400, 409) and "exists" in r.text.lower()):
        raise RuntimeError(f"Storage rechazó la subida ({r.status_code}): {r.text[:200]}")


def _series_ids(cur, source_id, plan: LoadPlan) -> dict[str, int]:
    cur.execute("select id, metric, destination_declared, source_sheet from public.permit_series where source_id = %s and granularity = %s",
                (source_id, plan.granularity))
    rows = cur.fetchall()
    return {r[3]: r[0] for r in rows}


def run_load(*, conn, parsed: Parsed, plan: LoadPlan, info: dict, meta: dict, summary: dict,
             origin_url: str, declared: tuple[date | None, str], captured_by: str, original_filename: str,
             use_storage: bool, publish: bool = True) -> dict:
    kind = parsed.kind
    source_key = SOURCE_KEYS[kind]
    sha = info["sha256"]
    out: dict[str, Any] = {"source_key": source_key}

    with conn.cursor() as cur:
        cur.execute("select id from public.data_sources where source_key = %s", (source_key,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"data_sources no tiene {source_key}: ¿se aplicó la migración 1?")
        source_id = row[0]

        cur.execute("select id, n, status from public.source_snapshots where source_id = %s and sha256 = %s", (source_id, sha))
        existing = cur.fetchone()
        if existing and existing[2] in ("loaded", "superseded"):
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'manual', 'ok_same_content', %s, %s, 'el archivo ya estaba cargado (mismo SHA-256)', %s)""",
                        (source_id, sha, parsed.period_end, captured_by))
            conn.commit()
            return {**out, "result": "already_loaded", "snapshot_id": str(existing[0])}

        year = (declared[0] or date.today()).year
        storage_path = f"{source_key}/{year}/{sha}.xlsx"
        if use_storage:
            upload_original(info["path"], storage_path)

        report = {k: summary[k] for k in ("quality", "aliases_used", "nuble_merges", "plan", "values_to_stage", "values_provisional",
                                          "cells_examined", "national_totals", "cross_check")}
        report["controls"] = {"total": summary["controls"]["total"], "ok": summary["controls"]["ok"]}
        report["rejections"] = summary["rejections"]["by_reason"]
        report["workbook"] = meta
        report["tool"] = {"name": "etl/permisos_minvu.py", "format": 1}

        if existing:        # reintento de un snapshot que quedó a medias: se limpia lo suyo y se reprocesa
            snap_id, snap_n = existing[0], existing[1]
            cur.execute("delete from public.permit_stage where snapshot_n = %s", (snap_n,))
            cur.execute("delete from public.permit_rejected_rows where snapshot_id = %s", (snap_id,))
            cur.execute("delete from public.snapshot_control_totals where snapshot_id = %s", (snap_id,))
            cur.execute("update public.source_snapshots set status = 'received', validation_report = %s, layout = %s, rejected_count = %s, row_count_raw = %s where id = %s",
                        (json.dumps(report), json.dumps(parsed.layout), len(parsed.rejections), parsed.cells_examined, snap_id))
        else:
            cur.execute("""insert into public.source_snapshots
                (source_id, captured_by, capture_method, origin_url, original_filename, storage_path, sha256, size_bytes,
                 declared_date, declared_date_note, period_start, period_end, load_from, scope, granularity,
                 row_count_raw, rejected_count, status, validation_report, layout)
                values (%s,%s,'manual_download',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'full',%s,%s,%s,'received',%s,%s)
                returning id, n""",
                (source_id, captured_by, origin_url, original_filename, storage_path, sha, info["size_bytes"],
                 declared[0], declared[1], parsed.period_start, parsed.period_end, plan.load_from, plan.granularity,
                 parsed.cells_examined, len(parsed.rejections), json.dumps(report), json.dumps(parsed.layout)))
            snap_id, snap_n = cur.fetchone()

        series = _series_ids(cur, source_id, plan)
        wanted = {sheet for sheet in parsed.sheets}
        missing = wanted - set(series)
        if missing:
            raise SystemExit(f"permit_series no tiene las hojas {sorted(missing)} para {source_key}/{plan.granularity}")

        for rj in parsed.rejections:
            cur.execute("insert into public.permit_rejected_rows (snapshot_id, row_ref, reason_code, detail, raw) values (%s,%s,%s,%s,%s)",
                        (snap_id, json.dumps({"sheet": rj.sheet, "row": rj.row, "col": rj.col}), rj.code, rj.detail, json.dumps(rj.raw, default=str)))

        stored_cols = {(c.period, c.granularity) for c in plan.columns}
        for ct in parsed.controls:
            if (ct.period, ct.granularity) in stored_cols:
                cur.execute("""insert into public.snapshot_control_totals (snapshot_id, series_id, period, scope, declared_total, computed_total, reference)
                               values (%s,%s,%s,'national',%s,%s,%s)""",
                            (snap_id, series[ct.sheet], ct.period, ct.declared, ct.computed,
                             f"fila 'Total País' de la hoja {ct.sheet} del archivo {original_filename}"))

        with cur.copy("copy public.permit_stage (snapshot_n, series_id, comuna_cut, period, value, is_provisional) from stdin") as cp:
            for sheet, cut, period, value, prov in stage_rows(parsed, plan):
                cp.write_row((snap_n, series[sheet], cut, period, value, prov))

        cur.execute("update public.source_snapshots set status = 'validated' where id = %s", (snap_id,))
    conn.commit()
    out.update(snapshot_id=str(snap_id), snapshot_n=snap_n, staged=summary["values_to_stage"])
    if not publish:
        return {**out, "result": "staged"}

    try:
        with conn.cursor() as cur:
            cur.execute("select public.publish_permit_snapshot(%s)", (snap_id,))
            out["publish"] = cur.fetchone()[0]
            cur.execute("select public.purge_superseded_permit_rows(%s)", (source_id,))
            out["purge"] = cur.fetchone()[0]
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'manual', 'ok_new_data', %s, %s, 'snapshot publicado', %s)""",
                        (source_id, sha, parsed.period_end, captured_by))
        conn.commit()
    except Exception as e:      # la base rechazó la publicación: queda registrado, nada pasa a vigente
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute("delete from public.permit_stage where snapshot_n = %s", (snap_n,))
            cur.execute("""update public.source_snapshots set status = 'rejected',
                             validation_report = validation_report || jsonb_build_object('publish_error', %s::text) where id = %s""",
                        (str(e), snap_id))
        conn.commit()
        raise
    return {**out, "result": "published"}
