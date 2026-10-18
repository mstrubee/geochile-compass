"""Orquestación del ETL de establecimientos: lectura → transformación → reporte → (carga). CLI: etl/salud_establecimientos.py."""
from __future__ import annotations

import getpass
import json
import socket
import sys
from collections import Counter
from datetime import date, datetime, timezone

from proyectos.common import read_comunas_csv

from . import establecimientos as est

EXIT_OK, EXIT_STRUCTURE, EXIT_SOURCE, EXIT_DB, EXIT_REJECTED = 0, 2, 3, 4, 5
DEFAULT_MAX_REJECT = 0.005
TIMEOUT = 120


def _captured_by(args) -> str:
    return args.captured_by or f"etl:{getpass.getuser()}@{socket.gethostname()}"


def _get(url: str):
    import requests
    r = requests.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    return r


def latest_from_ckan(package_url: str) -> tuple[str, str | None]:
    """(url del recurso CSV más reciente, last_modified). Elige entre los recursos CSV 'establecimientos_*' el de last_modified/created más nuevo."""
    pkg = _get(package_url).json()
    if not pkg.get("success"):
        raise RuntimeError("CKAN respondió success=false")
    cands = [r for r in pkg["result"].get("resources", []) if (r.get("format") or "").lower() == "csv" and r.get("url")
             and est.norm_key(r.get("name") or r["url"].rsplit("/", 1)[-1]).startswith("establecimientos")]
    if not cands:
        raise RuntimeError("el paquete no tiene recursos CSV 'establecimientos_*'")
    best = max(cands, key=lambda r: r.get("last_modified") or r.get("created") or "")
    return best["url"], best.get("last_modified") or best.get("created")


def fetch_source(args) -> tuple[bytes, str, str, tuple[date | None, str], str]:
    """(bytes, nombre de archivo, URL de origen, (fecha declarada, nota), método de captura)."""
    if args.file:
        from pathlib import Path
        p = Path(args.file)
        raw = p.read_bytes()
        d = est.date_from_filename(p.name)
        return raw, p.name, args.origin_url or est.DATA_URL, (d, "fecha del nombre del archivo" if d else "no declarada"), "manual_download"
    url, modified = args.url or est.DATA_URL, None
    if args.ckan_latest:
        url, modified = latest_from_ckan(args.ckan_url or est.CKAN_PACKAGE_URL)
    r = _get(url)
    name = url.rsplit("/", 1)[-1].split("?")[0]
    d = est.date_from_filename(name)
    note = "fecha del nombre del archivo" if d else "no declarada"
    if modified:
        note += f"; CKAN last_modified {modified}"
    lm = r.headers.get("last-modified")
    if lm:
        note += f"; HTTP Last-Modified {lm}"
    return r.content, name, url, (d, note), "automatic_download"


def run(args) -> int:
    conn = None
    try:
        try:
            raw, file_name, origin, declared, method = fetch_source(args)
        except Exception as e:
            print(f"\nERROR DE LA FUENTE ({type(e).__name__}): {e}\nNo se cargó nada.", file=sys.stderr)
            return EXIT_SOURCE
        sha = est.sha256_hex(raw)
        try:
            rows = est.parse_csv(raw)
        except (est.StructureError, UnicodeDecodeError) as e:
            print(f"\nESTRUCTURA INVÁLIDA: {e}\nNo se cargó nada.", file=sys.stderr)
            return EXIT_STRUCTURE

        use_db = (not args.dry_run) or args.db
        tipos = est.load_tipos()
        settings: dict = {}
        if use_db:
            from . import est_db
            conn = est_db.connect()
            if args.dry_run:
                conn.execute("set transaction read only")
            comunas, settings, db_tipos = est_db.load_reference(conn)
            tipos = db_tipos or tipos
        else:
            comunas = read_comunas_csv()
        valid = {c["cut"] for c in comunas}
        names = {c["cut"]: c["name"] for c in comunas}
        max_reject = settings.get("publish.max_reject_ratio", DEFAULT_MAX_REJECT)
        near_m = settings.get("health.near_border_m", est.DEFAULT_NEAR_M)
        coast_m = settings.get("health.coast_buffer_m", est.DEFAULT_COAST_M)

        res = est.transform(rows, valid, names)
        s: dict = {"file_name": file_name, "bytes": len(raw), "sha256": sha, "origin": origin, "declared_date": declared[0].isoformat() if declared[0] else None,
                   "declared_date_note": declared[1], "stats": res.stats, "classify": est.classify(res.rows, tipos),
                   "rejections": {"total": len(res.rejections), "by_reason": dict(Counter(r.code for r in res.rejections)),
                                  "first": [{"oid": r.oid, "code": r.code, "detail": r.detail} for r in res.rejections[:10]]}}
        if not args.no_geocheck:
            try:
                s["geocheck"] = est.geocheck(res.rows, est.load_polygons(), near_m, coast_m)
            except ImportError:
                s["geocheck_skipped"] = "falta shapely (pip install -r etl/requirements.txt)"
        else:
            s["geocheck_skipped"] = "--no-geocheck"

        errors = []
        if not rows:
            errors.append("el archivo viene vacío")
        if s["classify"]["tipos_sin_clasificar"]:
            errors.append("hay tipos de establecimiento que health_tipo_clasificacion no conoce")
        ratio = len(res.rejections) / max(len(rows), 1)
        if ratio > max_reject:
            errors.append(f"rechazos sobre el máximo ({100 * max_reject:.1f} %)")
        s["errors"], s["ready"] = errors, not errors
        print(json.dumps(s, ensure_ascii=False, indent=2, default=str) if args.json else est.render(s, args.dry_run, max_reject))
        if errors:
            return EXIT_REJECTED if ratio > max_reject else EXIT_STRUCTURE
        if args.dry_run:
            return EXIT_OK

        from . import est_db
        today = datetime.now(timezone.utc).date()
        result = est_db.run_load(
            conn=conn, origin_url=origin, file_name=file_name, sha=sha, raw=raw, rows=res.rows, rejections=res.rejections, declared=declared,
            period=(today, today), capture_method=method, use_storage=not args.no_storage, publish=not args.stage_only,
            report={"stats": res.stats, "classify": s["classify"], "rejections": s["rejections"], "geocheck_dryrun": s.get("geocheck")},
            layout={"delimiter": ";", "encoding": "utf-8", "columns": est.EXPECTED_COLUMNS, "header_line": 1},
            captured_by=_captured_by(args))
        print("\nRESULTADO: " + json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return EXIT_OK
    except SystemExit:
        raise
    except Exception as e:
        print(f"\nERROR ({type(e).__name__}): {e}\nNo quedó nada vigente: la publicación es todo-o-nada.", file=sys.stderr)
        return EXIT_DB
    finally:
        if conn is not None:
            conn.close()
