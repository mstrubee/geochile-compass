"""Carga a Postgres/Supabase de la capacidad hospitalaria (SUPABASE_DB_URL). Mismo contrato que censo/poblacion_db.py: el archivo ORIGINAL va a Storage con su hash,
las filas pasan por la zona de paso y SOLO publish_health_rem20_snapshot() / publish_health_dotacion_snapshot() (que re-validan los cuadres en la base) las vuelven vigentes."""
from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path
from urllib.parse import quote

from proyectos.db import connect  # noqa: F401  (reexportado)

from . import capacidad as cap

OUT_DIR = Path(os.environ.get("SALUD_OUT_DIR") or Path(__file__).resolve().parents[1] / "output" / "salud")
REM_STAGE_COLS = "snapshot_n, code, period, area, dias_cama_ocupados, dias_cama_disponibles, dias_estada, egresos, egresos_fallecidos, traslados, filas"
DOT_STAGE_COLS = "snapshot_n, code, year, area, beds"
MIME = {"csv": "text/csv", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


def current_establishment_codes(conn) -> set[str]:
    """Códigos de la captura VIGENTE de establecimientos (solo lectura): contra ellos se empalma toda la capacidad."""
    with conn.cursor() as cur:
        cur.execute("select e.code from public._health_current_snapshot() cs join public.health_establishments e on e.snapshot_n = cs.snapshot_n")
        return {r[0] for r in cur.fetchall()}


def save_local_copy(raw: bytes, source_key: str, sha: str, ext: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / f"{source_key}_{sha[:12]}.{ext}"
    p.write_bytes(raw)
    return p


def _upload(raw: bytes, storage_path: str, mime: str) -> None:
    import requests
    base, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir el original a Storage (o use --no-storage).")
    url = f"{base.rstrip('/')}/storage/v1/object/source-snapshots/{quote(storage_path)}"
    r = requests.post(url, data=raw, timeout=600, headers={"Authorization": f"Bearer {key}", "apikey": key, "x-upsert": "false", "Content-Type": mime})
    if r.status_code not in (200, 201) and not (r.status_code in (400, 409) and "exists" in r.text.lower()):
        raise RuntimeError(f"Storage rechazó la subida ({r.status_code}): {r.text[:200]}")


def rem20_stage_rows(d: cap.Rem20) -> list[tuple]:
    return [(code, period, area, *v) for (code, period, area), v in sorted(d.rows.items())]


def dotacion_stage_rows(d: cap.Dotacion) -> list[tuple]:
    return [(code, year, area, n) for (code, year, area), n in sorted(d.rows.items())]


def _load(*, conn, source_key: str, ext: str, stage_table: str, stage_cols: str, stage_rows: list[tuple], publish_fn: str, origin_url: str, file_name: str, sha: str, raw: bytes,
          declared: tuple[date | None, str], period: tuple[date, date], granularity: str, row_count_raw: int, report: dict, layout: dict, captured_by: str, capture_method: str,
          use_storage: bool, publish: bool) -> dict:
    out: dict = {"source_key": source_key}
    out["local_copy"] = str(save_local_copy(raw, source_key, sha, ext))
    with conn.cursor() as cur:
        cur.execute("select id from public.data_sources where source_key = %s", (source_key,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"data_sources no tiene {source_key}: ¿se aplicó 20261108000000_health_capacity?")
        source_id = row[0]
        cur.execute("select id, n, status from public.source_snapshots where source_id = %s and sha256 = %s", (source_id, sha))
        existing = cur.fetchone()
        if existing and existing[2] in ("loaded", "superseded"):
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_same_content', %s, %s, 'el archivo no cambió (mismo SHA-256)', %s)""", (source_id, sha, period[1], captured_by))
            conn.commit()
            return {**out, "result": "already_loaded", "snapshot_id": str(existing[0])}

        storage_path = f"{source_key}/{period[1].year}/{sha}.{ext}"
        note = None
        if use_storage:
            _upload(raw, storage_path, MIME[ext])
        else:
            note = "ORIGINAL NO SUBIDO a Storage (--no-storage): storage_path es la ruta prevista; subir la copia local y borrar esta nota."
        rep, lay = json.dumps(report, default=str), json.dumps(layout, default=str)
        if existing:
            snap_id, snap_n = existing[0], existing[1]
            cur.execute(f"delete from {stage_table} where snapshot_n = %s", (snap_n,))
            cur.execute("""update public.source_snapshots set status = 'received', validation_report = %s, layout = %s, rejected_count = 0, row_count_raw = %s, note = %s,
                                  declared_date = %s, declared_date_note = %s, origin_url = %s where id = %s""", (rep, lay, row_count_raw, note, declared[0], declared[1], origin_url, snap_id))
        else:
            cur.execute("""insert into public.source_snapshots
                (source_id, captured_by, capture_method, origin_url, original_filename, storage_path, sha256, size_bytes,
                 declared_date, declared_date_note, period_start, period_end, scope, granularity,
                 row_count_raw, rejected_count, status, validation_report, layout, note)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'full',%s,%s,0,'received',%s,%s,%s) returning id, n""",
                (source_id, captured_by, capture_method, origin_url, file_name, storage_path, sha, len(raw), declared[0], declared[1], period[0], period[1],
                 granularity, row_count_raw, rep, lay, note))
            snap_id, snap_n = cur.fetchone()
        with cur.copy(f"copy {stage_table} ({stage_cols}) from stdin") as cp:
            for r in stage_rows:
                cp.write_row((snap_n, *r))
        cur.execute("update public.source_snapshots set status = 'validated' where id = %s", (snap_id,))
    conn.commit()
    out.update(snapshot_id=str(snap_id), snapshot_n=snap_n, staged_rows=len(stage_rows))
    if not publish:
        return {**out, "result": "staged"}
    try:
        with conn.cursor() as cur:
            cur.execute(f"select public.{publish_fn}(%s)", (snap_id,))
            out["publish"] = cur.fetchone()[0]
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_new_data', %s, %s, 'snapshot publicado', %s)""", (source_id, sha, period[1], captured_by))
        conn.commit()
    except Exception as e:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(f"delete from {stage_table} where snapshot_n = %s", (snap_n,))
            cur.execute("""update public.source_snapshots set status = 'rejected',
                             validation_report = validation_report || jsonb_build_object('publish_error', %s::text) where id = %s""", (str(e), snap_id))
        conn.commit()
        raise
    return {**out, "result": "published"}


def run_load_rem20(*, conn, d: cap.Rem20, **kw) -> dict:
    return _load(conn=conn, source_key=cap.REM20_SOURCE_KEY, ext="csv", stage_table="public.health_rem20_month_stage", stage_cols=REM_STAGE_COLS, stage_rows=rem20_stage_rows(d),
                 publish_fn="publish_health_rem20_snapshot", period=(d.first_period, d.period_end), granularity="month", row_count_raw=d.rows_raw, **kw)


def run_load_dotacion(*, conn, d: cap.Dotacion, **kw) -> dict:
    return _load(conn=conn, source_key=cap.DOTACION_SOURCE_KEY, ext="xlsx", stage_table="public.health_beds_dotacion_stage", stage_cols=DOT_STAGE_COLS, stage_rows=dotacion_stage_rows(d),
                 publish_fn="publish_health_dotacion_snapshot", period=cap.dotacion_period(d), granularity="year", row_count_raw=len(d.rows), **kw)
