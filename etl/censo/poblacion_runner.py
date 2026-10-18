"""Orquestación del ETL de población censada 2024: lectura → cuadres → reporte → (carga). CLI: etl/censo_poblacion.py."""
from __future__ import annotations

import getpass
import hashlib
import json
import socket
import sys
import zipfile
from datetime import date
from email.utils import parsedate_to_datetime
from pathlib import Path

from proyectos.common import GEOJSON_PATH, read_comunas_csv

from . import poblacion as pob

EXIT_OK, EXIT_STRUCTURE, EXIT_SOURCE, EXIT_DB = 0, 2, 3, 4
TIMEOUT = 300
PERIOD = (date(2024, 1, 1), date(2024, 12, 31))          # año del censo; fechas exactas del levantamiento [NO COMPROBADO]
CUADRE_UI = {"ok": "✔", "fail": "✘"}


def _captured_by(args) -> str:
    return args.captured_by or f"etl:{getpass.getuser()}@{socket.gethostname()}"


def fetch_source(args) -> tuple[bytes, str, str, tuple[date | None, str], str]:
    """(bytes, nombre de archivo, URL de origen, (fecha de PUBLICACIÓN, nota), método de captura)."""
    if args.file:
        p = Path(args.file)
        d = date.fromisoformat(args.declared_date) if args.declared_date else None
        return p.read_bytes(), p.name, args.origin_url or pob.DATA_URL, (d, "indicada por el operador (--declared-date)" if d else "no declarada"), "manual_download"
    import requests
    url = args.url or pob.DATA_URL
    r = requests.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    lm = r.headers.get("last-modified")
    d = parsedate_to_datetime(lm).date() if lm else None
    return r.content, url.rsplit("/", 1)[-1].split("?")[0], url, (d, "cabecera HTTP Last-Modified del archivo" if d else "no declarada"), "automatic_download"


def n(x) -> str:
    return f"{x:,}".replace(",", ".")


def render(s: dict, dry_run: bool) -> str:
    c = s["censo"]
    L = ["=" * 78, "Censo 2024 (INE) — población censada por comuna, sexo y edad — " + ("DRY-RUN (no se escribe NADA: ni base de datos, ni Storage, ni disco)" if dry_run else "CARGA"), "=" * 78,
         f"Archivo ............ {s['file_name']}  ({n(s['bytes'])} bytes)",
         f"SHA-256 ............ {s['sha256']}" + ("   ✔ coincide con el verificado" if s["sha256_expected_match"] else "   (distinto del verificado el 2026-10-18)"),
         f"Origen ............. {s['origin']}",
         f"PERÍODO ............ {c['period']}  (año del censo; fechas exactas del levantamiento [NO COMPROBADO])",
         f"PUBLICACIÓN ........ {s['declared_date'] or 'no declarada'}  ({s['declared_date_note']})",
         f"Fecha de la copia .. {s['last_modified'] or 'no declarado'} ({s['last_modified_note']})",
         f"Actualización ...... {c['updated_note'] or 'no declarada'}",
         f"Licencia ........... {pob.LICENSE_LABEL} (declarada por el INE en {pob.TERMS_URL}; el XLSX no la repite)",
         f"Concepto ........... «Población censada» = {c['definition'] or 'sin definición leída'}  (NO es proyección)",
         "", "CUADRES"]
    for k, (ok, d) in s["reconcile"].items():
        L.append(f"  {CUADRE_UI['ok' if ok else 'fail']} {k}" + (f"  [{d}]" if d else ""))
    L += ["", f"CARGA: {c['comunas']} comunas · {c['edad_rows']} filas de edad ({c['comunas']} × {len(pob.GRUPOS)}) · total país {n(c['total_pais'])} (hombres {n(c['hombres'])}, mujeres {n(c['mujeres'])})",
          "  ejemplos: " + " · ".join(f"{e['name']} {n(e['total'])}" for e in s["examples"])]
    if s["name_differences"]:
        L.append(f"  nombres que difieren de public/codigos_territoriales.csv (informativo; la clave es el CUT): " + "; ".join(f"{a} «{b}» vs «{d}»" for a, b, d in s["name_differences"]))
    L += ["", "VEREDICTO: " + ("LISTO para cargar" if s["ready"] else "NO SE CARGA — " + "; ".join(s["errors"]))]
    return "\n".join(L)


def run(args) -> int:
    conn = None
    try:
        try:
            raw, file_name, origin, declared, method = fetch_source(args)
        except Exception as e:
            print(f"\nERROR DE LA FUENTE ({type(e).__name__}): {e}\nNo se cargó nada.", file=sys.stderr)
            return EXIT_SOURCE
        sha = hashlib.sha256(raw).hexdigest()
        last_modified = declared
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".xlsx") as tmp:
            tmp.write(raw)
            tmp.flush()
            try:
                censo = pob.read_workbook(tmp.name)
            except (pob.StructureError, KeyError, ValueError, OSError, zipfile.BadZipFile) as e:
                print(f"\nESTRUCTURA INVÁLIDA: {e}\nNo se cargó nada.", file=sys.stderr)
                return EXIT_STRUCTURE
        ref = read_comunas_csv()
        ref_cuts, ref_names = {r["cut"] for r in ref}, {r["cut"]: r["name"] for r in ref}
        if args.dry_run and args.db:
            from . import poblacion_db
            conn = poblacion_db.connect()
            ref_cuts, ref_names = poblacion_db.load_reference(conn)
        geo_cuts = None
        if GEOJSON_PATH.exists():
            geo_cuts = {str(f["properties"].get("codigo_comuna") or f["properties"].get("cod_comuna")) for f in json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))["features"]}
        # FECHA DE PUBLICACIÓN = la que declara el propio archivo (hoja Nota); Last-Modified/--declared-date es solo la fecha de la copia y va en la nota
        if censo.published:
            declared = (censo.published, f"«Fecha de publicación» de la hoja Nota del archivo; tabla actualizada el 04-12-2025 [{censo.updated_note or 'sin nota 2'}]; Last-Modified/captura: {last_modified[0] or 'no declarada'} ({last_modified[1]})")
        rec = pob.reconcile(censo, ref_cuts, geo_cuts)
        examples = [{"name": censo.comunas[k].name, "total": censo.comunas[k].trio.total} for k in ("13101", "13201", "15102") if k in censo.comunas]
        s: dict = {
            "file_name": file_name, "bytes": len(raw), "sha256": sha, "sha256_expected_match": sha == EXPECTED_SHA256, "origin": origin,
            "declared_date": declared[0].isoformat() if declared[0] else None, "declared_date_note": declared[1],
            "last_modified": last_modified[0].isoformat() if last_modified[0] else None, "last_modified_note": last_modified[1],
            "censo": {"period": f"{PERIOD[0].isoformat()} a {PERIOD[1].isoformat()}", "published": censo.published.isoformat() if censo.published else None, "updated_note": censo.updated_note,
                      "definition": censo.definition, "comunas": len(censo.comunas), "edad_rows": len(censo.edades), "total_pais": censo.pais.total, "hombres": censo.pais.hombres, "mujeres": censo.pais.mujeres},
            "reconcile": {k: [ok, d] for k, (ok, d) in rec.items()}, "examples": examples, "name_differences": pob.name_differences(censo, ref_names)}
        s["errors"] = [k for k, (ok, _d) in rec.items() if not ok]
        s["ready"] = not s["errors"]
        print(json.dumps(s, ensure_ascii=False, indent=2, default=str) if args.json else render(s, args.dry_run))
        if s["errors"]:
            return EXIT_STRUCTURE
        if args.dry_run:
            return EXIT_OK

        from . import poblacion_db
        report = {"pais": {"total": censo.pais.total, "hombres": censo.pais.hombres, "mujeres": censo.pais.mujeres},
                  "regiones": {k: {"nombre": nm, "total": t.total, "hombres": t.hombres, "mujeres": t.mujeres} for k, (nm, t) in censo.regiones.items()},
                  "reconcile": s["reconcile"], "published_note": s["censo"]["published"], "updated_note": censo.updated_note, "definition": censo.definition,
                  "license": {"label": pob.LICENSE_LABEL, "url": pob.LICENSE_URL, "terms": pob.TERMS_URL}, "name_differences": s["name_differences"]}
        conn = poblacion_db.connect()
        result = poblacion_db.run_load(
            conn=conn, origin_url=origin, file_name=file_name, sha=sha, raw=raw, censo=censo, declared=declared, period=PERIOD, report=report,
            layout={"sheets": {"2": "comuna", "4": "comuna × grupo de edad", "1": "región (cuadre)", "Nota": "fecha de publicación y definiciones"}, "grupos": pob.GRUPOS},
            captured_by=_captured_by(args), capture_method=method, use_storage=not args.no_storage, publish=not args.stage_only)
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


EXPECTED_SHA256 = "1f3a9c97a1b3defa47a2fc3b8495688c4e08f164063cab704e7a18c41239e009"
