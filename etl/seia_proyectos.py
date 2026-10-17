#!/usr/bin/env python3
"""Carga de los proyectos del SEIA (capas EIA y DIA del servicio ArcGIS del SEA) a Supabase.

El servicio es público y de solo lectura; esto es lo único que escribe en la base. Una corrida = una FOTO COMPLETA de cada capa.

  1) Ensayo: no escribe NADA en la base ni en Storage. Pagina el servicio, valida y verifica el cuadre con el conteo
     que el propio servicio informa (antes y después de paginar). Imprime conteos, rechazos, comunas sin resolver y avisos:

       python etl/seia_proyectos.py --dry-run

  2) Carga real:

       export SUPABASE_DB_URL=postgresql://...            # conexión directa a Postgres
       export SUPABASE_URL=https://xxxx.supabase.co       # solo para subir el original a Storage
       export SUPABASE_SERVICE_ROLE_KEY=...
       python etl/seia_proyectos.py

Opciones útiles:
  --layer eia|dia|all      qué capa (por defecto, las dos)
  --save-dir DIR           guarda el archivo ORIGINAL (.seia.gz) en DIR; sirve también en --dry-run (escritura local, explícita)
  --from-archive FILE      reproduce una captura guardada, SIN red (una sola capa; el archivo dice cuál es)
  --db                     en --dry-run, lee comunas y alias de la base (solo lectura) en vez del CSV del repo
  --no-storage             no sube el original a Storage (solo desarrollo local)
  --stage-only             carga y valida pero NO publica (la publicación la hace seia_publish_snapshot)
  --json                   el reporte en JSON
  --base-url URL           raíz del MapServer (por defecto la del SEA; también SEIA_BASE)
  --record-origin-base URL raíz https:// que se REGISTRA como origen (solo pruebas con un servidor local: la base exige https)

Códigos de salida: 0 ok · 2 argumentos o estructura · 3 no cuadra con el conteo del servicio (o el servicio cambió mientras
se paginaba) · 4 error de red, base de datos o Storage · 5 hay expedientes rechazados (se cargó/ensayó igual si cuadra).
Ver etl/seia/README.md y docs/permisos-edificacion/DISENO.md («Parte 4 – SEIA»).
"""
import sys

sys.dont_write_bytecode = True          # el dry-run no debe dejar ni __pycache__

import argparse
import getpass
import json
import os
import socket
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from permisos import seed as seedmod                       # noqa: E402  (comunas del repo, para el ensayo sin base)
from seia import arcgis, archive                           # noqa: E402
from seia.normalize import Resolver, parse_pages           # noqa: E402
from seia.report import DEFAULT_MAX_REJECT_RATIO, render_text, summarize  # noqa: E402

EXIT_ARGS, EXIT_CUADRE, EXIT_IO, EXIT_REJECTED = 2, 3, 4, 5


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Carga los proyectos del SEIA a Supabase. Ver docstring del archivo.")
    ap.add_argument("--layer", choices=["eia", "dia", "all"], default="all")
    ap.add_argument("--dry-run", action="store_true", help="solo imprime el reporte; no escribe en la base ni en Storage")
    ap.add_argument("--save-dir", help="carpeta donde guardar el archivo original (.seia.gz)")
    ap.add_argument("--from-archive", help="reproduce un archivo .seia.gz guardado (sin red)")
    ap.add_argument("--base-url", help="raíz del MapServer (por defecto la del SEA)")
    ap.add_argument("--record-origin-base", help="raíz https:// a registrar como origen (solo pruebas con un servidor local)")
    ap.add_argument("--pause", type=float, default=0.3, help="segundos entre peticiones (cortesía con el servicio)")
    ap.add_argument("--page-size", type=int, default=arcgis.PAGE_SIZE)
    ap.add_argument("--captured-by", help="quién carga (por defecto usuario@equipo)")
    ap.add_argument("--db", action="store_true", help="en --dry-run, leer comunas/alias de la base (solo lectura)")
    ap.add_argument("--no-storage", action="store_true")
    ap.add_argument("--stage-only", action="store_true")
    ap.add_argument("--json", action="store_true")
    return ap


def _epoch_ms_to_date(v) -> date | None:
    try:
        return datetime.fromtimestamp(float(v) / 1000.0, tz=timezone.utc).date()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def acquire(layer: str, args, client: arcgis.Client | None):
    """-> (pages crudas, conteo del servicio antes, después, meta del archivo, fecha declarada, URL de origen)."""
    if args.from_archive:
        meta, pages = archive.read_archive(Path(args.from_archive).read_bytes())
        if meta.get("layer") != layer:
            raise ValueError(f"el archivo es de la capa {meta.get('layer')!r}, no {layer!r}")
        d = _epoch_ms_to_date(meta.get("last_edit_date"))
        declared = (d, "editingInfo.lastEditDate del servicio (archivo guardado)") if d else (None, "el servicio no declara fecha")
        return pages, meta["service_count_before"], meta["service_count_after"], meta, declared, meta["origin_url"]
    assert client is not None
    before = client.count(layer)
    md = client.metadata(layer)
    pages = client.fetch_pages(layer, before)
    after = client.count(layer)
    last_edit = (md.get("editingInfo") or {}).get("lastEditDate")
    origin = (f"{args.record_origin_base.rstrip('/')}/{arcgis.LAYERS[layer][0]}" if args.record_origin_base
              else client.layer_url(layer))
    meta = {"layer": layer, "origin_url": origin, "service_count_before": before, "service_count_after": after,
            "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "last_edit_date": last_edit,
            "page_size": client.page_size, "requests": client.requests_made}
    d = _epoch_ms_to_date(last_edit)
    declared = (d, "editingInfo.lastEditDate del servicio") if d else (None, "el servicio no declara fecha")
    return pages, before, after, meta, declared, origin


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.from_archive and args.layer == "all":
        print("--from-archive reproduce UNA capa: indique --layer eia o --layer dia.", file=sys.stderr)
        return EXIT_ARGS
    if args.from_archive and not os.path.isfile(args.from_archive):
        print(f"No existe el archivo: {args.from_archive}", file=sys.stderr)
        return EXIT_ARGS
    layers = list(arcgis.LAYERS) if args.layer == "all" else [args.layer]

    use_db = (not args.dry_run) or args.db
    conn = None
    worst = 0
    reports = []
    try:
        if use_db:
            from seia import db
            conn = db.connect()
            if args.dry_run:
                conn.execute("set transaction read only")
        client = None if args.from_archive else arcgis.Client(args.base_url, pause=args.pause, page_size=args.page_size)
        captured_by = args.captured_by or f"etl:{getpass.getuser()}@{socket.gethostname()}"

        for layer in layers:
            source_key = arcgis.LAYERS[layer][1]
            if conn is not None:
                from seia import db
                comunas, aliases, settings = db.load_reference(conn, source_key)
            else:
                comunas = [{"cut": r["commune_id"], "name": r["commune_name"], "region_cut": r["region_id"]} for r in seedmod.read_csv()]
                aliases, settings = [], {}
            try:
                pages, before, after, meta, declared, origin = acquire(layer, args, client)
            except arcgis.ArcGisError as e:
                print(f"\n[{layer.upper()}] NO SE PUDO CAPTURAR: {e}", file=sys.stderr)
                if conn is not None and not args.dry_run:
                    db.record_check(conn, source_key, "unreachable", checked_by=captured_by, detail=str(e)[:500])
                worst = max(worst, EXIT_IO)
                continue
            except ValueError as e:                 # archivo guardado ilegible o de otra capa
                print(f"\n[{layer.upper()}] ARCHIVO NO UTILIZABLE: {e}", file=sys.stderr)
                worst = max(worst, EXIT_ARGS)
                continue

            sha = archive.content_sha256(pages)
            parsed = parse_pages(pages, Resolver(comunas, aliases))
            summary = summarize(parsed, layer=layer, source_key=source_key, origin_url=origin, service_count=before,
                                service_count_after=after, content_sha=sha, pages=len(pages), declared=(str(declared[0]) if declared[0] else None, declared[1]),
                                max_reject_ratio=settings.get("publish.max_reject_ratio", DEFAULT_MAX_REJECT_RATIO),
                                from_archive=bool(args.from_archive))
            reports.append(summary)
            blob = archive.build_archive(meta, pages)
            if args.save_dir:
                out_dir = Path(args.save_dir)
                out_dir.mkdir(parents=True, exist_ok=True)
                target = out_dir / f"{source_key}_{sha[:12]}.seia.gz"
                target.write_bytes(blob)
                summary["saved_to"] = str(target)
            if not args.json:
                print(render_text(summary, dry_run=args.dry_run) + (f"\narchivo original guardado en {summary['saved_to']}" if "saved_to" in summary else "") + "\n")

            if not summary["cuadre"]["ok"]:                 # no es la foto completa del servicio: no se carga
                worst = max(worst, EXIT_CUADRE)
                continue
            if not summary["ready"] or parsed.rejections:   # sobre el umbral de rechazo (no se carga) o rechazos tolerados (se carga)
                worst = max(worst, EXIT_REJECTED)
            if not summary["ready"] or args.dry_run:
                continue

            result = db.run_load(conn=conn, source_key=source_key, parsed=parsed, summary=summary, archive=blob, content_sha=sha,
                                 meta=meta, captured_at=datetime.fromisoformat(meta["captured_at"]), declared=declared,
                                 captured_by=captured_by, use_storage=not args.no_storage, publish=not args.stage_only)
            summary["result"] = result
            if not args.json:
                print("RESULTADO: " + json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n")

        if args.json:
            print(json.dumps(reports, ensure_ascii=False, indent=2, default=str))
        return worst
    except SystemExit:
        raise
    except Exception as e:      # base de datos / Storage
        print(f"\nERROR ({type(e).__name__}): {e}\nNo cambió la foto vigente: la publicación es todo-o-nada.", file=sys.stderr)
        return EXIT_IO
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    sys.exit(main())
