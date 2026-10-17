"""Acceso a Supabase/Postgres para los ETL de la Parte 4 (SUPABASE_DB_URL). Mismo contrato que etl/permisos/db.py:
el archivo/JSON ORIGINAL va a Storage con su hash, las filas pasan por la zona de paso y SOLO publish_*_snapshot() las
convierte en vigentes (re-valida en la base)."""
from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path
from urllib.parse import quote

OUT_DIR = Path(os.environ.get("PROYECTOS_OUT_DIR") or Path(__file__).resolve().parents[1] / "output" / "proyectos")

STAGE = {
    "ine_pe": ("public.ine_pe_stage",
               "snapshot_n, src_oid, comuna_cut, year, units, floors, uso, geo_precision, glosa, area_m2, lon, lat",
               "publish_ine_pe_snapshot"),
    "ine_crf": ("public.ine_crf_stage", "snapshot_n, src_oid, comuna_cut, year, dwellings, geojson", "publish_ine_crf_snapshot"),
    "seia": ("public.seia_stage",
             "snapshot_n, service_layer, expediente_id, src_oid, name, form, typology_letter, typology_name, region_declared, "
             "comunas_declared, comuna_cuts, titular, status_declared, submitted_at, qualified_at, investment_usd, expediente_url, "
             "x_raw, y_raw, modificado, lon, lat", "publish_seia_snapshot"),
}


def connect(url: str | None = None):
    import psycopg
    url = url or os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise SystemExit("Falta SUPABASE_DB_URL (conexión directa a Postgres del proyecto Supabase).")
    return psycopg.connect(url)


def load_reference(conn, seia_source_keys=("seia_proyectos_eia", "seia_proyectos_dia")):
    with conn.cursor() as cur:
        cur.execute("select cut, name, region_cut from public.comunas order by cut")
        comunas = [{"cut": r[0], "name": r[1], "region_cut": r[2]} for r in cur.fetchall()]
        cur.execute("""select a.raw_name_norm, a.cut, d.source_key from public.comuna_name_aliases a
                         join public.data_sources d on d.id = a.source_id where d.source_key = any(%s)""", (list(seia_source_keys),))
        aliases = [{"name": r[0], "cut": r[1], "source_key": r[2]} for r in cur.fetchall()]
        cur.execute("select key, value from public.pipeline_settings")
        settings = {k: float(v) for k, v in cur.fetchall()}
        rules = {}
        try:
            cur.execute("select letter, include, category from public.seia_typology_rules")
            rules = {r[0]: {"include": r[1], "category": r[2]} for r in cur.fetchall()}
        except Exception:
            conn.rollback()                        # la migración de SEIA aún no está aplicada
    return comunas, aliases, settings, rules


def upsert_aliases(conn, source_keys, aliases: list[dict]) -> int:
    from permisos.norm import norm
    n = 0
    with conn.cursor() as cur:
        for a in aliases:
            for sk in source_keys:
                cur.execute("""insert into public.comuna_name_aliases (source_id, raw_region_norm, raw_name_norm, cut, reason, created_by)
                               select id, %s, %s, %s, %s, 'etl/proyectos' from public.data_sources where source_key = %s
                               on conflict (source_id, raw_region_norm, raw_name_norm) do update set cut = excluded.cut, reason = excluded.reason""",
                            (norm(a.get("region_label", "")), norm(a["name"]), a["cut"], a.get("reason", "alias explícito"), sk))
                n += cur.rowcount
    return n


def upload_original(gz: bytes, storage_path: str) -> None:
    import requests
    base, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir el original a Storage (o use --no-storage).")
    url = f"{base.rstrip('/')}/storage/v1/object/source-snapshots/{quote(storage_path)}"
    r = requests.post(url, data=gz, timeout=600, headers={"Authorization": f"Bearer {key}", "apikey": key, "x-upsert": "false",
                                                           "Content-Type": "application/gzip"})
    if r.status_code not in (200, 201) and not (r.status_code in (400, 409) and "exists" in r.text.lower()):
        raise RuntimeError(f"Storage rechazó la subida ({r.status_code}): {r.text[:200]}")


def save_local_copy(gz: bytes, source_key: str, sha: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / f"{source_key}_{sha[:12]}.geojson.gz"
    p.write_bytes(gz)
    return p


def run_load(*, conn, kind: str, source_key: str, layer_url: str, sha: str, gz: bytes, count_before: int, count_after: int,
             rows: list[tuple], rejections, declared: tuple[date | None, str], period: tuple[date, date], granularity: str,
             report: dict, layout: dict, captured_by: str, use_storage: bool, publish: bool = True) -> dict:
    stage_table, stage_cols, publish_fn = STAGE[kind]
    out: dict = {"source_key": source_key}
    local = save_local_copy(gz, source_key, sha)               # SIEMPRE queda una copia local del "original" normalizado
    out["local_copy"] = str(local)
    with conn.cursor() as cur:
        cur.execute("select id from public.data_sources where source_key = %s", (source_key,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"data_sources no tiene {source_key}: ¿se aplicó la migración de la Parte 4?")
        source_id = row[0]
        cur.execute("select id, n, status from public.source_snapshots where source_id = %s and sha256 = %s", (source_id, sha))
        existing = cur.fetchone()
        if existing and existing[2] in ("loaded", "superseded"):
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_same_content', %s, %s, 'la capa no cambió (mismo hash del GeoJSON normalizado)', %s)""",
                        (source_id, sha, period[1], captured_by))
            conn.commit()
            return {**out, "result": "already_loaded", "snapshot_id": str(existing[0])}

        storage_path = f"{source_key}/{(declared[0] or date.today()).year}/{sha}.geojson.gz"
        note = None
        if use_storage:
            upload_original(gz, storage_path)
        else:
            note = "ORIGINAL NO SUBIDO a Storage (--no-storage): storage_path es la ruta prevista; subir la copia local y borrar esta nota."
        full_report = {**report, "server_count_before": count_before, "server_count_after": count_after,
                       "tool": {"name": "etl/proyectos", "format": 1}}
        if existing:
            snap_id, snap_n = existing[0], existing[1]
            cur.execute(f"delete from {stage_table} where snapshot_n = %s", (snap_n,))
            cur.execute("delete from public.geo_rejected_rows where snapshot_id = %s", (snap_id,))
            cur.execute("""update public.source_snapshots set status = 'received', validation_report = %s, layout = %s,
                             rejected_count = %s, row_count_raw = %s, note = %s where id = %s""",
                        (json.dumps(full_report, default=str), json.dumps(layout, default=str), len(rejections), count_before, note, snap_id))
        else:
            cur.execute("""insert into public.source_snapshots
                (source_id, captured_by, capture_method, origin_url, original_filename, storage_path, sha256, size_bytes,
                 declared_date, declared_date_note, period_start, period_end, scope, granularity,
                 row_count_raw, rejected_count, status, validation_report, layout, note)
                values (%s,%s,'api',%s,%s,%s,%s,%s,%s,%s,%s,%s,'full',%s,%s,%s,'received',%s,%s,%s) returning id, n""",
                (source_id, captured_by, layer_url, local.name, storage_path, sha, len(gz), declared[0], declared[1], period[0], period[1],
                 granularity, count_before, len(rejections), json.dumps(full_report, default=str), json.dumps(layout, default=str), note))
            snap_id, snap_n = cur.fetchone()
        for rj in rejections:
            cur.execute("insert into public.geo_rejected_rows (snapshot_id, row_ref, reason_code, detail, raw) values (%s,%s,%s,%s,%s)",
                        (snap_id, json.dumps({"layer": rj.layer, "objectid": rj.oid}), rj.code, rj.detail, json.dumps(rj.raw, default=str)))
        with cur.copy(f"copy {stage_table} ({stage_cols}) from stdin") as cp:
            for r in rows:
                cp.write_row((snap_n, *r))
        cur.execute("update public.source_snapshots set status = 'validated' where id = %s", (snap_id,))
    conn.commit()
    out.update(snapshot_id=str(snap_id), snapshot_n=snap_n, staged=len(rows))
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
                             validation_report = validation_report || jsonb_build_object('publish_error', %s::text) where id = %s""",
                        (str(e), snap_id))
        conn.commit()
        raise
    return {**out, "result": "published"}
