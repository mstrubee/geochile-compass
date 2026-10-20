"""Orquestación del ETL de capacidad hospitalaria: lectura → cuadres → reporte (con los controles Tisné y Buin) → (carga). CLI: etl/salud_capacidad.py."""
from __future__ import annotations

import getpass
import hashlib
import json
import socket
import sys
import tempfile
import zipfile
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote

from . import capacidad as cap

EXIT_OK, EXIT_STRUCTURE, EXIT_SOURCE, EXIT_DB = 0, 2, 3, 4
TIMEOUT = 300
LANDING_REM20 = "https://datos.gob.cl/dataset/indicadores-hospitalarios-rem20"
LANDING_DOTACION = "https://deis.minsal.cl/"
CONTROL_CODES = (("112101", "Hospital Dr. Luis Tisné B. (Santiago, Peñalolén)"), ("113150", "Hospital San Luis (Buin)"))

# Lo verificado el 2026-10-20 sobre los archivos reales (docs/salud/HALLAZGOS_CAPACIDAD.md §2.1). Solo aplican si el sha256 coincide.
VERIFIED = {
    "rem20": {"sha256": "5085664576302b361f9207ce13b96acacd4a29da16477ebf2cccbce487571559",
              "rows_raw": 168474, "establecimientos": 208, "period": "2014-01 a 2026-08",
              "controls": {"112101": {"2025": (87230, 102835, 12, 84.83), "2026-08": (7791, 8897, 1, 87.57)}, "113150": {"2025": (27370, 35836, 12, 76.38), "2026-08": (2383, 3059, 1, 77.9)}}},
    "dotacion": {"sha256": "ef5ca45f30c1e3937621e489826766cb9844c5bca0253a375be4851f28ba078f", "codes": 196, "total_pais_2025": 26738,
                 "controls": {"112101": {2023: 303, 2024: 296, 2025: 280}, "113150": {2023: 100, 2024: 100, 2025: 100}}},
}


def _captured_by(args) -> str:
    return args.captured_by or f"etl:{getpass.getuser()}@{socket.gethostname()}"


def n(x) -> str:
    return f"{x:,}".replace(",", ".")


def _get(url: str, **kw):
    import requests
    r = requests.get(url, timeout=TIMEOUT, **kw)
    r.raise_for_status()
    return r


def resolve_rem20(package_url: str = cap.CKAN_PACKAGE_URL) -> dict:
    """URL VIGENTE del recurso Indicadores_REM20.csv según CKAN (la URL lleva la fecha de publicación y cambia). Exige licencia CC0 y que el recurso exista una sola vez."""
    pkg = _get(package_url).json()
    if not pkg.get("success"):
        raise RuntimeError("CKAN respondió success=false")
    res = pkg["result"]
    cands = [x for x in res.get("resources", []) if (x.get("name") or "").strip().lower() == cap.REM20_RESOURCE_NAME.lower() and (x.get("format") or "").lower() == "csv" and x.get("url")]
    if len(cands) != 1:
        raise RuntimeError(f"se esperaba exactamente un recurso «{cap.REM20_RESOURCE_NAME}» y CKAN trae {len(cands)}")
    if res.get("license_id") != cap.REM20_LICENSE_ID:
        raise RuntimeError(f"la licencia del paquete cambió: {res.get('license_id')!r} (se esperaba {cap.REM20_LICENSE_ID!r}); revisar antes de cargar")
    x = cands[0]
    return {"url": x["url"], "last_modified": x.get("last_modified"), "size": x.get("size"), "license_id": res.get("license_id"), "license_title": res.get("license_title"), "resource_id": x.get("id")}


def _date_from_iso(s: str | None) -> date | None:
    try:
        return datetime.fromisoformat(s).date() if s else None
    except ValueError:
        return None


def fetch_rem20(args) -> tuple[bytes, str, str, tuple[date | None, str], str, dict]:
    """(bytes, nombre, URL efectiva, (fecha declarada, nota), método, info CKAN)."""
    if args.rem20_file:
        p = Path(args.rem20_file)
        d = date.fromisoformat(args.rem20_declared_date) if args.rem20_declared_date else None
        return p.read_bytes(), p.name, args.rem20_origin_url or LANDING_REM20, (d, "indicada por el operador (--rem20-declared-date)" if d else "no declarada"), "manual_download", {}
    info = resolve_rem20(args.ckan_url or cap.CKAN_PACKAGE_URL) if not args.rem20_url else {"url": args.rem20_url}
    r = _get(info["url"])
    d = _date_from_iso(info.get("last_modified"))
    note = f"last_modified del recurso en CKAN ({info.get('last_modified')})" if d else "no declarada"
    return r.content, info["url"].rsplit("/", 1)[-1].split("?")[0], r.url, (d, note), "automatic_download", info


def dotacion_url(year: int) -> str:
    return f"{cap.DOTACION_BASE_URL}/{quote(cap.DOTACION_NAME.format(year=year))}"


def fetch_dotacion(args) -> tuple[bytes, str, str, tuple[date | None, str], str, dict]:
    if args.dotacion_file:
        p = Path(args.dotacion_file)
        d = date.fromisoformat(args.dotacion_declared_date) if args.dotacion_declared_date else None
        return p.read_bytes(), p.name, args.dotacion_origin_url or dotacion_url(2025), (d, "indicada por el operador (--dotacion-declared-date)" if d else "no declarada"), "manual_download", {}
    import requests
    years = [args.dotacion_year] if args.dotacion_year else list(range(date.today().year + 1, 2024, -1))      # el archivo más nuevo lleva el último año en el nombre
    for y in years:
        url = dotacion_url(y)
        h = requests.head(url, timeout=60, allow_redirects=True)
        if h.status_code == 200 and "spreadsheet" in (h.headers.get("content-type") or ""):
            r = _get(url)
            lm = r.headers.get("last-modified")
            d = parsedate_to_datetime(lm).date() if lm else None
            return r.content, cap.DOTACION_NAME.format(year=y), r.url, (d, "cabecera HTTP Last-Modified del archivo" if d else "no declarada"), "automatic_download", {"year_in_name": y}
    raise RuntimeError(f"no se encontró el archivo de dotación para los años {years}")


def controls_rem20(d: cap.Rem20) -> dict:
    """Los controles del runbook: ocupación del último año completo y del último mes publicado de los dos hospitales de control."""
    ly = d.last_period.year if d.last_period.month == 12 else d.last_period.year - 1
    out = {}
    for code, _nm in CONTROL_CODES:
        out[code] = {str(ly): cap.occupancy(d, code, date(ly, 1, 1), date(ly, 12, 1)), d.last_period.strftime("%Y-%m"): cap.occupancy(d, code, d.last_period, d.last_period)}
    return out


def controls_dotacion(d: cap.Dotacion) -> dict:
    return {code: {y: cap.beds(d, code, y) for y in d.years[-3:]} for code, _nm in CONTROL_CODES}


def render_rem20(s: dict, dry_run: bool) -> list[str]:
    L = ["", "=" * 78, "REM 20 (DEIS) — ocupación hospitalaria por establecimiento, área funcional y mes — " + ("DRY-RUN (no se escribe NADA)" if dry_run else "CARGA"), "=" * 78,
         f"Archivo ............ {s['file_name']}  ({n(s['bytes'])} bytes)",
         f"SHA-256 ............ {s['sha256']}" + ("   ✔ coincide con el verificado el 2026-10-20" if s["verified_match"] else "   (distinto del verificado el 2026-10-20: contraste con el runbook)"),
         f"URL efectiva ....... {s['origin']}",
         f"Fecha declarada .... {s['declared_date'] or 'no declarada'}  ({s['declared_date_note']})",
         f"Licencia ........... {s['license'] or 'no comprobada en esta corrida (archivo local)'}",
         f"PERÍODO ............ {s['period']}  (mensual; último año completo {s['last_full_year']})",
         f"FILAS .............. {n(s['rows_raw'])} del archivo → {n(s['rows_stage'])} claves ({s['dup_keys']} duplicadas sumadas) · {s['establecimientos']} establecimientos", "", "CUADRES"]
    for k, (ok, dt) in s["reconcile"].items():
        L.append(f"  {'✔' if ok else '✘'} {k}" + (f"  [{dt}]" if dt else ""))
    if s["non_pertenece"]:
        L.append("  códigos con TIPO_PERTENENCIA ≠ 1: " + "; ".join(f"{c} {nm} ({a}-{b})" for c, (nm, a, b) in s["non_pertenece"].items()))
    L += ["", "CONTROLES (índice = Σ ocupados / Σ disponibles × 100, todas las áreas):"]
    for code, nm in CONTROL_CODES:
        for per, (o, dsp, mes, idx) in s["controls"][code].items():
            L.append(f"  {code} {nm} · {per}: {n(o)} ocupados / {n(dsp)} disponibles · {mes} mes(es) · índice {('%.2f' % idx).replace('.', ',') if idx is not None else 'sin dato'} %")
    return L


def render_dotacion(s: dict, dry_run: bool) -> list[str]:
    L = ["", "=" * 78, "Dotación de camas (DEIS/DIGERA) por establecimiento, año y área funcional — " + ("DRY-RUN (no se escribe NADA)" if dry_run else "CARGA"), "=" * 78,
         f"Archivo ............ {s['file_name']}  ({n(s['bytes'])} bytes)",
         f"SHA-256 ............ {s['sha256']}" + ("   ✔ coincide con el verificado el 2026-10-20" if s["verified_match"] else "   (distinto del verificado el 2026-10-20: contraste con el runbook)"),
         f"URL efectiva ....... {s['origin']}",
         f"Fecha de modificación {s['declared_date'] or 'no declarada'}  ({s['declared_date_note']})",
         "Licencia ........... [NO COMPROBADO]: el archivo no declara licencia; la consulta al DEIS la envía el dueño del proyecto (client_ready = false)",
         f"AÑOS ............... {s['period']}",
         f"FILAS .............. {n(s['rows'])} cifras · {s['establecimientos']} establecimientos · {s['blocks']} bloques «Total» ({', '.join(s['multi_block']) or 'ninguno'} en dos bloques)", "", "CUADRES"]
    for k, (ok, dt) in s["reconcile"].items():
        L.append(f"  {'✔' if ok else '✘'} {k}" + (f"  [{dt}]" if dt else ""))
    L.append(f"  informativo: «Total País» {s['years'][-1]} = {n(s['total_pais_last'])}; {s['text_cells']} celdas de texto (sin dato): {s['text_cells_detail']}; {s['total_vs_areas']} total(es) publicado(s) ≠ Σ de sus áreas (se guardan tal cual)")
    L += ["", "CONTROLES (camas de dotación, fila «Total» publicada):"]
    for code, nm in CONTROL_CODES:
        L.append(f"  {code} {nm}: " + " · ".join(f"{y}: {s['controls'][code][y] if s['controls'][code][y] is not None else 'sin dato'}" for y in s["controls"][code]))
    return L


def summarize_rem20(raw, file_name, origin, declared, info, ref_codes) -> tuple[cap.Rem20, dict]:
    d = cap.read_rem20(raw)
    sha = hashlib.sha256(raw).hexdigest()
    rec = cap.reconcile_rem20(d, ref_codes)
    ctl = controls_rem20(d)
    ver = VERIFIED["rem20"]
    match = sha == ver["sha256"]
    if match:                                                                    # el archivo es el verificado: las cifras de control deben coincidir con lo registrado
        rec["controles Tisné y Buin = lo verificado el 2026-10-20 (mismo SHA-256)"] = (all(tuple(ctl[c][p]) == tuple(v) for c, ps in ver["controls"].items() for p, v in ps.items()) and d.rows_raw == ver["rows_raw"], "")
    ly = d.last_period.year if d.last_period.month == 12 else d.last_period.year - 1
    s = {"file_name": file_name, "bytes": len(raw), "sha256": sha, "verified_match": match, "origin": origin, "declared_date": declared[0].isoformat() if declared[0] else None, "declared_date_note": declared[1],
         "license": (f"{info.get('license_title')} ({info.get('license_id')})" if info.get("license_id") else None), "period": f"{d.first_period:%Y-%m} a {d.last_period:%Y-%m}", "last_full_year": ly,
         "rows_raw": d.rows_raw, "rows_stage": len(d.rows), "dup_keys": len(d.dup_keys), "establecimientos": len(d.codes), "reconcile": {k: [ok, dt] for k, (ok, dt) in rec.items()},
         "non_pertenece": d.non_pertenece, "controls": ctl}
    s["errors"] = [k for k, (ok, _dt) in rec.items() if not ok]
    s["ready"] = not s["errors"]
    return d, s


def summarize_dotacion(path, raw, file_name, origin, declared, ref_codes) -> tuple[cap.Dotacion, dict]:
    d = cap.read_dotacion(path)
    sha = hashlib.sha256(raw).hexdigest()
    rec = cap.reconcile_dotacion(d, ref_codes)
    ver = VERIFIED["dotacion"]
    match = sha == ver["sha256"]
    ctl = controls_dotacion(d)
    if match:
        rec["controles Tisné y Buin = lo verificado el 2026-10-20 (mismo SHA-256)"] = (all(ctl[c][y] == v for c, ys in ver["controls"].items() for y, v in ys.items()) and len(d.codes) == ver["codes"] and d.total_pais[2025] == ver["total_pais_2025"], "")
    a, b = cap.dotacion_period(d)
    s = {"file_name": file_name, "bytes": len(raw), "sha256": sha, "verified_match": match, "origin": origin, "declared_date": declared[0].isoformat() if declared[0] else None, "declared_date_note": declared[1],
         "period": f"{a.year} a {b.year}", "rows": len(d.rows), "establecimientos": len(d.codes), "blocks": d.blocks, "multi_block": sorted(d.codes_multi_block), "years": d.years,
         "total_pais_last": d.total_pais[d.years[-1]], "text_cells": len(d.text_cells), "text_cells_detail": "; ".join(f"{c} {y}" for _r, y, _t, c in d.text_cells[:4]) or "ninguna",
         "total_vs_areas": len(d.total_vs_areas), "reconcile": {k: [ok, dt] for k, (ok, dt) in rec.items()}, "controls": ctl}
    s["errors"] = [k for k, (ok, _dt) in rec.items() if not ok]
    s["ready"] = not s["errors"]
    return d, s


def run(args) -> int:
    conn = None
    want = ("rem20", "dotacion") if args.source == "all" else (args.source,)
    results: dict = {}
    try:
        ref_codes = None
        if args.db or not args.dry_run:
            from . import capacidad_db
            conn = capacidad_db.connect()
            ref_codes = capacidad_db.current_establishment_codes(conn)
            if not ref_codes:
                print("\nERROR: no hay captura vigente de establecimientos en la base: cárguela primero (docs/salud/RUNBOOK_1A.md).", file=sys.stderr)
                return EXIT_DB
        prepared: dict = {}
        out_lines: list[str] = []
        for what in want:
            try:
                if what == "rem20":
                    raw, file_name, origin, declared, method, info = fetch_rem20(args)
                else:
                    raw, file_name, origin, declared, method, info = fetch_dotacion(args)
            except Exception as e:
                print(f"\nERROR DE LA FUENTE ({what}; {type(e).__name__}): {e}\nNo se cargó nada.", file=sys.stderr)
                return EXIT_SOURCE
            try:
                if what == "rem20":
                    d, s = summarize_rem20(raw, file_name, origin, declared, info, ref_codes)
                else:
                    with tempfile.NamedTemporaryFile(suffix=".xlsx") as tmp:
                        tmp.write(raw)
                        tmp.flush()
                        d, s = summarize_dotacion(tmp.name, raw, file_name, origin, declared, ref_codes)
            except (cap.StructureError, KeyError, ValueError, OSError, zipfile.BadZipFile, UnicodeDecodeError) as e:
                print(f"\nESTRUCTURA INVÁLIDA ({what}): {e}\nNo se cargó nada.", file=sys.stderr)
                return EXIT_STRUCTURE
            prepared[what] = (raw, file_name, origin, declared, method, info, d, s)
            results[what] = s
            out_lines += (render_rem20 if what == "rem20" else render_dotacion)(s, args.dry_run)
            if ref_codes is None:
                out_lines.append("  (empalme con los establecimientos: NO COMPROBADO en este ensayo; use --db para comprobarlo con la base, solo lectura)")
        ready = all(s["ready"] for s in results.values())
        out_lines += ["", "VEREDICTO: " + ("LISTO para cargar" if ready else "NO SE CARGA — " + "; ".join(f"{w}: {', '.join(s['errors'])}" for w, s in results.items() if s["errors"]))]
        print(json.dumps(results, ensure_ascii=False, indent=2, default=str) if args.json else "\n".join(out_lines))
        if not ready:
            return EXIT_STRUCTURE
        if args.dry_run:
            return EXIT_OK

        from . import capacidad_db
        for what in want:
            raw, file_name, origin, declared, method, info, d, s = prepared[what]
            common = dict(conn=conn, d=d, origin_url=origin, file_name=file_name, sha=s["sha256"], raw=raw, declared=declared, captured_by=_captured_by(args), capture_method=method,
                          use_storage=not args.no_storage, publish=not args.stage_only)
            if what == "rem20":
                report = {"rows_raw": d.rows_raw, "rows_stage": len(d.rows), "establecimientos": len(d.codes), "totales": d.totales, "periodo": s["period"],
                          "claves_duplicadas": [list(k) for k in d.dup_keys], "indice": {"chequeadas": d.index_checked, "desvio_maximo": d.index_max_diff, "disponibles_cero": d.disp_zero_rows},
                          "reconcile": s["reconcile"], "ckan": info, "no_perteneciente_al_snss": {c: list(v) for c, v in d.non_pertenece.items()}, "controles": s["controls"]}
                result = capacidad_db.run_load_rem20(layout={"columnas": cap.REM20_COLUMNS, "clave": "PERIODO, MES, CODIGO_ESTABLECIMIENTO, COD_AREA_FUNCIONAL"}, report=report, **common)
            else:
                report = {"rows_stage": len(d.rows), "establecimientos": len(d.codes), "total_pais": {str(y): v for y, v in d.total_pais.items()}, "years": d.years, "bloques": d.blocks,
                          "codigos_en_dos_bloques": sorted(d.codes_multi_block), "celdas_de_texto": [list(t) for t in d.text_cells], "total_vs_areas": [list(t) for t in d.total_vs_areas],
                          "notas": d.notes, "reconcile": s["reconcile"], "licencia": "[NO COMPROBADO] el archivo no declara licencia", "controles": {c: {str(y): v for y, v in ys.items()} for c, ys in s["controls"].items()}}
                result = capacidad_db.run_load_dotacion(layout={"hoja": "única (2010-<año>)", "codigo": "solo en la fila «Total» (área 100); las áreas lo heredan", "total_area": cap.TOTAL_AREA}, report=report, **common)
            print(f"\nRESULTADO ({what}): " + json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return EXIT_OK
    except SystemExit:
        raise
    except Exception as e:
        print(f"\nERROR ({type(e).__name__}): {e}\nNo quedó nada vigente de la carga que falló: la publicación es todo-o-nada por fuente.", file=sys.stderr)
        return EXIT_DB
    finally:
        if conn is not None:
            conn.close()
