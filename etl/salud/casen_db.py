"""Carga a Postgres/Supabase de las estimaciones CASEN regionales (SUPABASE_DB_URL). Solo AGREGADOS: no se guarda ninguna fila de persona. El .sav original
(≈ 750 MB) NO se sube a Storage (supera el límite de objeto): se registra su SHA-256 y su URL; el tabulado oficial (≈ 1,8 MB) sí se sube."""
from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path
from urllib.parse import quote

from proyectos.db import connect  # noqa: F401  (reexportado)

from .casen import SOURCE_KEY

STAGE_COLS = ("snapshot_n, region_cut, sistema, n_sample, pct, se, ci_lo, ci_hi, n_psu, n_strata, df, publishable, reason, official_pct, official_se, official_n, lonely_strata")


def stage_rows(ests) -> list[tuple]:
    out = []
    for e in sorted(ests, key=lambda x: (x.region_cut, x.sistema)):
        o = e.official or {}
        out.append((e.region_cut, e.sistema, e.n_sample, e.pct, e.se, e.ci_lo, e.ci_hi, e.n_psu, e.n_strata, e.df, e.publishable, e.reason, o.get("pct"), o.get("se"), o.get("n"), e.lonely_strata))
    return out


def _upload(raw: bytes, storage_path: str, mime: str) -> None:
    import requests
    base, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir el tabulado a Storage (o use --no-storage).")
    url = f"{base.rstrip('/')}/storage/v1/object/source-snapshots/{quote(storage_path)}"
    r = requests.post(url, data=raw, timeout=600, headers={"Authorization": f"Bearer {key}", "apikey": key, "x-upsert": "false", "Content-Type": mime})
    if r.status_code not in (200, 201) and not (r.status_code in (400, 409) and "exists" in r.text.lower()):
        raise RuntimeError(f"Storage rechazó la subida ({r.status_code}): {r.text[:200]}")


def run_load(*, conn, origin_url: str, file_name: str, sha: str, size: int, tabulado: tuple[bytes, str, str] | None, ests, persons: int, declared: tuple[date | None, str],
             period: tuple[date, date], report: dict, layout: dict, captured_by: str, capture_method: str, use_storage: bool, publish: bool = True) -> dict:
    out: dict = {"source_key": SOURCE_KEY}
    with conn.cursor() as cur:
        cur.execute("select id from public.data_sources where source_key = %s", (SOURCE_KEY,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"data_sources no tiene {SOURCE_KEY}: ¿se aplicó 20261103000100_casen_prevision?")
        source_id = row[0]
        cur.execute("select id, n, status from public.source_snapshots where source_id = %s and sha256 = %s", (source_id, sha))
        existing = cur.fetchone()
        if existing and existing[2] in ("loaded", "superseded"):
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_same_content', %s, %s, 'la base no cambió (mismo SHA-256)', %s)""", (source_id, sha, period[1], captured_by))
            conn.commit()
            return {**out, "result": "already_loaded", "snapshot_id": str(existing[0])}
        storage_path = f"{SOURCE_KEY}/{period[1].year}/{sha}.sav"
        note = "ORIGINAL (.sav ≈ 750 MB) NO SUBIDO a Storage por tamaño: se conservan su SHA-256 y su URL de origen; storage_path es la ruta prevista (vacía)."
        if tabulado is not None:
            tb_raw, tb_sha, tb_name = tabulado
            report = {**report, "tabulado": {"name": tb_name, "sha256": tb_sha, "bytes": len(tb_raw), "storage_path": f"{SOURCE_KEY}/{period[1].year}/{tb_sha}.xlsx"}}
            if use_storage:
                _upload(tb_raw, f"{SOURCE_KEY}/{period[1].year}/{tb_sha}.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            else:
                note += " Tabulado oficial NO subido (--no-storage)."
        rep, lay = json.dumps(report, default=str), json.dumps(layout, default=str)
        if existing:
            snap_id, snap_n = existing[0], existing[1]
            cur.execute("delete from public.casen_prevision_stage where snapshot_n = %s", (snap_n,))
            cur.execute("""update public.source_snapshots set status = 'received', validation_report = %s, layout = %s, rejected_count = 0, row_count_raw = %s, note = %s where id = %s""",
                        (rep, lay, persons, note, snap_id))
        else:
            cur.execute("""insert into public.source_snapshots
                (source_id, captured_by, capture_method, origin_url, original_filename, storage_path, sha256, size_bytes,
                 declared_date, declared_date_note, period_start, period_end, scope, granularity,
                 row_count_raw, rejected_count, status, validation_report, layout, note)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'full','snapshot',%s,0,'received',%s,%s,%s) returning id, n""",
                (source_id, captured_by, capture_method, origin_url, file_name, storage_path, sha, size, declared[0], declared[1], period[0], period[1], persons, rep, lay, note))
            snap_id, snap_n = cur.fetchone()
        rows = stage_rows(ests)
        with cur.copy(f"copy public.casen_prevision_stage ({STAGE_COLS}) from stdin") as cp:
            for r in rows:
                cp.write_row((snap_n, *r))
        cur.execute("update public.source_snapshots set status = 'validated' where id = %s", (snap_id,))
    conn.commit()
    out.update(snapshot_id=str(snap_id), snapshot_n=snap_n, staged=len(rows))
    if not publish:
        return {**out, "result": "staged"}
    try:
        with conn.cursor() as cur:
            cur.execute("select public.publish_casen_snapshot(%s)", (snap_id,))
            out["publish"] = cur.fetchone()[0]
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_new_data', %s, %s, 'snapshot publicado', %s)""", (source_id, sha, period[1], captured_by))
        conn.commit()
    except Exception as e:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute("delete from public.casen_prevision_stage where snapshot_n = %s", (snap_n,))
            cur.execute("""update public.source_snapshots set status = 'rejected', validation_report = validation_report || jsonb_build_object('publish_error', %s::text) where id = %s""", (str(e), snap_id))
        conn.commit()
        raise
    return {**out, "result": "published"}
