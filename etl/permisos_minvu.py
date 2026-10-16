#!/usr/bin/env python3
"""Carga de MINVU CEDOC (permisos de edificación: viviendas y superficie por comuna) a Supabase.

COMANDO ÚNICO. Corre en TU máquina (catalogo.minvu.cl corta TLS desde nubes: el archivo se descarga a mano):

  1) Ensayo: no escribe NADA (ni base, ni Storage, ni disco). Imprime conteos, rechazos y el cuadre
     con el total nacional publicado por el propio archivo:

       python etl/permisos_minvu.py --file ./PE_Viviendas_..._anio_y_comuna_2002_a_jul_2026.xlsx --dry-run

  2) Carga real (la misma línea, sin --dry-run, más la URL EXACTA de descarga):

       export SUPABASE_DB_URL=postgresql://...            # conexión directa a Postgres
       export SUPABASE_URL=https://xxxx.supabase.co       # solo para subir el original a Storage
       export SUPABASE_SERVICE_ROLE_KEY=...
       python etl/permisos_minvu.py --file ./...anio_y_comuna....xlsx --origin-url https://catalogo.minvu.cl/...

Tipo de archivo (anual / mensual) se detecta solo por su estructura. Opciones útiles:
  --compare-with OTRO.xlsx   cruza anual vs mensual (el anual de cada año debe ser la suma de sus meses)
  --json                     el reporte en JSON
  --stage-only               carga y valida pero NO publica (la publicación la hace publish_permit_snapshot)
  --no-storage               no sube el original a Storage (solo desarrollo local)

Códigos de salida: 0 ok · 2 error de estructura/nombres · 3 el cuadre con el total nacional falla ·
4 error de base de datos/Storage · 5 hay celdas rechazadas.
Ver etl/permisos/README.md y docs/permisos-edificacion/DISENO.md.
"""
import sys

sys.dont_write_bytecode = True          # el dry-run no debe dejar ni __pycache__

import argparse
import getpass
import json
import os
import socket
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from permisos import seed as seedmod                       # noqa: E402
from permisos.parse_minvu import Resolver, cross_check, parse, plan_load  # noqa: E402
from permisos.report import file_info, render_text, summarize  # noqa: E402
from permisos.xlsx_reader import LayoutError, read_workbook  # noqa: E402

DEFAULT_ANNUAL_FROM_YEAR = 2002
DEFAULT_MONTHLY_YEARS = 5


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Carga MINVU CEDOC (permisos de edificación) a Supabase. Ver docstring del archivo.")
    ap.add_argument("--file", required=True, help="XLSX descargado de MINVU CEDOC (anual o mensual)")
    ap.add_argument("--dry-run", action="store_true", help="solo imprime el reporte; no escribe nada")
    ap.add_argument("--origin-url", help="URL EXACTA de descarga (obligatoria sin --dry-run)")
    ap.add_argument("--declared-date", help="AAAA-MM-DD que declara el origen (por defecto, la propiedad 'modified' del XLSX)")
    ap.add_argument("--captured-by", help="quién descargó/cargó (por defecto usuario@equipo)")
    ap.add_argument("--original-filename", help="nombre original del archivo, si el actual fue renombrado")
    ap.add_argument("--compare-with", help="el OTRO archivo (mensual si --file es anual, o al revés) para el cruce")
    ap.add_argument("--annual-from-year", type=int, help=f"primer año a cargar del anual (por defecto la base: etl.annual_from_year, hoy {DEFAULT_ANNUAL_FROM_YEAR})")
    ap.add_argument("--monthly-years", type=int, help=f"años recientes a cargar del mensual (por defecto la base: etl.monthly_keep_years, hoy {DEFAULT_MONTHLY_YEARS})")
    ap.add_argument("--db", action="store_true", help="en --dry-run, leer comunas/alias de la base (solo lectura) en vez de los archivos del repo")
    ap.add_argument("--no-storage", action="store_true", help="no subir el original a Storage")
    ap.add_argument("--stage-only", action="store_true", help="no publicar: deja el snapshot validado")
    ap.add_argument("--json", action="store_true", help="reporte en JSON")
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if not os.path.isfile(args.file):
        print(f"No existe el archivo: {args.file}", file=sys.stderr)
        return 2
    if not args.dry_run and not args.origin_url:
        print("Falta --origin-url (la URL exacta de la que descargó el archivo): es parte de la trazabilidad.", file=sys.stderr)
        return 2
    if args.origin_url and not args.origin_url.startswith("https://"):
        print("--origin-url debe ser https://", file=sys.stderr)
        return 2

    use_db = (not args.dry_run) or args.db
    conn = None
    settings: dict = {}
    try:
        if use_db:
            from permisos import db
            conn = db.connect()
            if args.dry_run:
                conn.execute("set transaction read only")
            comunas, aliases_db, settings = db.load_reference(conn)
        else:
            comunas = [{"cut": r["commune_id"], "name": r["commune_name"], "region_cut": r["region_id"]} for r in seedmod.read_csv()]
            aliases_db = None

        info = file_info(args.file)
        sheets, meta = read_workbook(args.file)
        first = next(iter(sheets.values()))
        kind = "annual" if any(c.month is None for c in first.cols) else "monthly"
        source_key = "minvu_cedoc_permisos_anual" if kind == "annual" else "minvu_cedoc_permisos_mensual"
        aliases = seedmod.read_aliases() if aliases_db is None else [a for a in aliases_db if a["source_key"] == source_key]
        resolver = Resolver(comunas, aliases)
        parsed = parse(sheets, resolver)

        annual_from = args.annual_from_year or int(settings.get("etl.annual_from_year", DEFAULT_ANNUAL_FROM_YEAR))
        monthly_years = args.monthly_years or int(settings.get("etl.monthly_keep_years", DEFAULT_MONTHLY_YEARS))
        plan = plan_load(parsed, annual_from, monthly_years)

        cross = None
        if args.compare_with:
            other_sheets, _ = read_workbook(args.compare_with)
            other = parse(other_sheets, resolver)
            if other.kind == parsed.kind:
                print("--compare-with debe ser el archivo del OTRO tipo (anual vs mensual).", file=sys.stderr)
                return 2
            ann, mon = (parsed, other) if parsed.kind == "annual" else (other, parsed)
            cross = cross_check(ann, mon)

        if args.declared_date:
            declared = (date.fromisoformat(args.declared_date), "indicada por el operador (--declared-date)")
        elif meta.get("modified"):
            declared = (datetime.fromisoformat(meta["modified"]).date(), "propiedad 'modified' del XLSX")
        else:
            declared = (None, "el archivo no declara fecha")

        summary = summarize(parsed, plan, info, meta, declared, cross)
        if cross and not cross["ok"]:
            summary["ready"] = False
            summary["errors"].append("el cruce anual ↔ mensual tiene desajustes")
        if conn is not None:
            from permisos import db
            with conn.cursor() as cur:
                cur.execute("select s.status from public.source_snapshots s join public.data_sources d on d.id = s.source_id where d.source_key = %s and s.sha256 = %s",
                            (source_key, info["sha256"]))
                row = cur.fetchone()
            summary["db"] = {"snapshot_with_same_hash": row[0] if row else None}

        print(json.dumps(summary, ensure_ascii=False, indent=2, default=str) if args.json else render_text(summary, dry_run=args.dry_run))
        if args.dry_run and conn is not None:
            print(f"\n(Base consultada en SOLO LECTURA. ¿Ya cargado con este SHA-256? → {summary['db']['snapshot_with_same_hash'] or 'no'})")

        if parsed.errors:
            return 2
        if not all(c.ok for c in parsed.controls):
            return 3
        if parsed.rejections:
            return 5
        if not summary["ready"]:
            return 2
        if args.dry_run:
            return 0

        from permisos import db
        original = args.original_filename or os.path.basename(args.file)
        captured_by = args.captured_by or f"manual:{getpass.getuser()}@{socket.gethostname()}"
        result = db.run_load(conn=conn, parsed=parsed, plan=plan, info=info, meta=meta, summary=summary,
                             origin_url=args.origin_url, declared=declared, captured_by=captured_by,
                             original_filename=original, use_storage=not args.no_storage, publish=not args.stage_only)
        print("\nRESULTADO: " + json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0
    except LayoutError as e:
        print(f"\nESTRUCTURA NO RECONOCIDA ({e.code}): {e}\nNo se cargó nada.", file=sys.stderr)
        return 2
    except SystemExit:
        raise
    except Exception as e:      # base de datos / Storage
        print(f"\nERROR ({type(e).__name__}): {e}\nNo quedó nada vigente: la publicación es todo-o-nada.", file=sys.stderr)
        return 4
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    sys.exit(main())
