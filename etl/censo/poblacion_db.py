"""Carga a Postgres/Supabase de la población censada 2024 (SUPABASE_DB_URL). Mismo contrato que salud/isapre_db.py: el XLSX ORIGINAL va a Storage con su hash,
las filas pasan por la zona de paso y SOLO publish_poblacion_snapshot() (que re-valida los cuadres en la base) las vuelve vigentes."""
from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path
from urllib.parse import quote

from proyectos.db import connect  # noqa: F401  (reexportado)

from .poblacion import GRUPOS, SOURCE_KEY, Censo

OUT_DIR = Path(os.environ.get("CENSO_OUT_DIR") or Path(__file__).resolve().parents[1] / "output" / "censo")
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
STAGE_COLS = "snapshot_n, cut, comuna, region_cut, province_cut, total, hombres, mujeres"
STAGE_EDAD_COLS = "snapshot_n, cut, grupo_edad, total, hombres, mujeres"


def load_reference(conn) -> tuple[set[str], dict[str, str]]:
    with conn.cursor() as cur:
        cur.execute("select cut, name from public.comunas order by cut")
        rows = cur.fetchall()
    return {r[0] for r in rows}, {r[0]: r[1] for r in rows}


def stage_rows(c: Censo) -> tuple[list[tuple], list[tuple]]:
    comunas = [(x.cut, x.name, x.region_cut, x.province_cut, x.trio.total, x.trio.hombres, x.trio.mujeres) for x in sorted(c.comunas.values(), key=lambda y: y.cut)]
    edades = [(cut, g, t.total, t.hombres, t.mujeres) for (cut, g), t in sorted(c.edades.items(), key=lambda kv: (kv[0][0], GRUPOS.index(kv[0][1])))]
    return comunas, edades


def save_local_copy(raw: bytes, sha: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    p = OUT_DIR / f"{SOURCE_KEY}_{sha[:12]}.xlsx"
    p.write_bytes(raw)
    return p


def _upload(raw: bytes, storage_path: str) -> None:
    import requests
    base, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir el original a Storage (o use --no-storage).")
    url = f"{base.rstrip('/')}/storage/v1/object/source-snapshots/{quote(storage_path)}"
    r = requests.post(url, data=raw, timeout=600, headers={"Authorization": f"Bearer {key}", "apikey": key, "x-upsert": "false", "Content-Type": XLSX_MIME})
    if r.status_code not in (200, 201) and not (r.status_code in (400, 409) and "exists" in r.text.lower()):
        raise RuntimeError(f"Storage rechazó la subida ({r.status_code}): {r.text[:200]}")


def run_load(*, conn, origin_url: str, file_name: str, sha: str, raw: bytes, censo: Censo, declared: tuple[date | None, str], period: tuple[date, date],
             report: dict, layout: dict, captured_by: str, capture_method: str, use_storage: bool, publish: bool = True) -> dict:
    out: dict = {"source_key": SOURCE_KEY}
    local = save_local_copy(raw, sha)
    out["local_copy"] = str(local)
    with conn.cursor() as cur:
        cur.execute("select id from public.data_sources where source_key = %s", (SOURCE_KEY,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"data_sources no tiene {SOURCE_KEY}: ¿se aplicó 20261104000000_censo_poblacion?")
        source_id = row[0]
        cur.execute("select id, n, status from public.source_snapshots where source_id = %s and sha256 = %s", (source_id, sha))
        existing = cur.fetchone()
        if existing and existing[2] in ("loaded", "superseded"):
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_same_content', %s, %s, 'el archivo no cambió (mismo SHA-256)', %s)""", (source_id, sha, period[1], captured_by))
            conn.commit()
            return {**out, "result": "already_loaded", "snapshot_id": str(existing[0])}

        storage_path = f"{SOURCE_KEY}/{period[1].year}/{sha}.xlsx"
        note = None
        if use_storage:
            _upload(raw, storage_path)
        else:
            note = "ORIGINAL NO SUBIDO a Storage (--no-storage): storage_path es la ruta prevista; subir la copia local y borrar esta nota."
        rep = json.dumps(report, default=str)
        lay = json.dumps(layout, default=str)
        if existing:
            snap_id, snap_n = existing[0], existing[1]
            cur.execute("delete from public.poblacion_comunal_stage where snapshot_n = %s", (snap_n,))
            cur.execute("delete from public.poblacion_comunal_edad_stage where snapshot_n = %s", (snap_n,))
            cur.execute("""update public.source_snapshots set status = 'received', validation_report = %s, layout = %s, rejected_count = 0, row_count_raw = %s, note = %s,
                                  declared_date = %s, declared_date_note = %s where id = %s""", (rep, lay, len(censo.comunas), note, declared[0], declared[1], snap_id))
        else:
            cur.execute("""insert into public.source_snapshots
                (source_id, captured_by, capture_method, origin_url, original_filename, storage_path, sha256, size_bytes,
                 declared_date, declared_date_note, period_start, period_end, scope, granularity,
                 row_count_raw, rejected_count, status, validation_report, layout, note)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'full','snapshot',%s,0,'received',%s,%s,%s) returning id, n""",
                (source_id, captured_by, capture_method, origin_url, file_name, storage_path, sha, len(raw), declared[0], declared[1], period[0], period[1],
                 len(censo.comunas), rep, lay, note))
            snap_id, snap_n = cur.fetchone()
        comunas, edades = stage_rows(censo)
        with cur.copy(f"copy public.poblacion_comunal_stage ({STAGE_COLS}) from stdin") as cp:
            for r in comunas:
                cp.write_row((snap_n, *r))
        with cur.copy(f"copy public.poblacion_comunal_edad_stage ({STAGE_EDAD_COLS}) from stdin") as cp:
            for r in edades:
                cp.write_row((snap_n, *r))
        cur.execute("update public.source_snapshots set status = 'validated' where id = %s", (snap_id,))
    conn.commit()
    out.update(snapshot_id=str(snap_id), snapshot_n=snap_n, staged_comunas=len(comunas), staged_edad=len(edades))
    if not publish:
        return {**out, "result": "staged"}
    try:
        with conn.cursor() as cur:
            cur.execute("select public.publish_poblacion_snapshot(%s)", (snap_id,))
            out["publish"] = cur.fetchone()[0]
            cur.execute("""insert into public.source_checks (source_id, method, outcome, content_sha256, latest_period_seen, detail, checked_by)
                           values (%s, 'automatic', 'ok_new_data', %s, %s, 'snapshot publicado', %s)""", (source_id, sha, period[1], captured_by))
        conn.commit()
    except Exception as e:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute("delete from public.poblacion_comunal_stage where snapshot_n = %s", (snap_n,))
            cur.execute("delete from public.poblacion_comunal_edad_stage where snapshot_n = %s", (snap_n,))
            cur.execute("""update public.source_snapshots set status = 'rejected',
                             validation_report = validation_report || jsonb_build_object('publish_error', %s::text) where id = %s""", (str(e), snap_id))
        conn.commit()
        raise
    return {**out, "result": "published"}
