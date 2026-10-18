"""Orquestación del ETL de la cartera Isapre: lectura → cruce → cuadres → supresión (réplica) → reporte → (carga). CLI: etl/salud_isapre.py."""
from __future__ import annotations

import calendar
import getpass
import json
import socket
import sys
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path

from proyectos.common import ROOT, load_json, read_comunas_csv

from . import isapre as isa

ALIASES_PATH = Path(__file__).resolve().parent / "aliases_isapre.json"
EXIT_OK, EXIT_STRUCTURE, EXIT_SOURCE, EXIT_DB, EXIT_REJECTED = 0, 2, 3, 4, 5
DEFAULT_MAX_REJECT = 0.005
TIMEOUT = 300


def _captured_by(args) -> str:
    return args.captured_by or f"etl:{getpass.getuser()}@{socket.gethostname()}"


def fetch_source(args) -> tuple[bytes, str, str, tuple[date | None, str], str]:
    """(bytes, nombre de archivo, URL de origen, (fecha de PUBLICACIÓN declarada, nota), método de captura)."""
    if args.file:
        p = Path(args.file)
        d = date.fromisoformat(args.declared_date) if args.declared_date else None
        return p.read_bytes(), p.name, args.origin_url or isa.DATA_URL_2025, (d, "indicada por el operador (--declared-date)" if d else "no declarada"), "manual_download"
    import requests
    url = args.url or isa.DATA_URL_2025
    r = requests.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    lm = r.headers.get("last-modified")
    d = parsedate_to_datetime(lm).date() if lm else None
    return r.content, url.rsplit("/", 1)[-1].split("?")[0], url, (d, "cabecera HTTP Last-Modified del archivo" if d else "no declarada"), "automatic_download"


def render(s: dict, dry_run: bool, max_ratio: float) -> str:
    c, sup = s["cartera"], s["suppression"]
    L = ["=" * 78, "Cartera de beneficiarios Isapre por comuna (Superintendencia de Salud) — " + ("DRY-RUN (no se escribe NADA: ni base de datos, ni Storage, ni disco)" if dry_run else "CARGA"), "=" * 78,
         f"Archivo ............ {s['file_name']}  ({isa_n(s['bytes'])} bytes)",
         f"SHA-256 ............ {s['sha256']}",
         f"Origen ............. {s['origin']}",
         f"PERÍODO ............ {c['period']}  (cartera vigente al período)",
         f"PUBLICACIÓN ........ {s['declared_date'] or 'no declarada'}  ({s['declared_date_note']})   ·   extracción de datos (en el archivo): {c['extraction_date'] or 'no declarada'}",
         "Licencia ........... NO DECLARADA en el archivo (por confirmar) → client_ready = false",
         "Advertencia oficial  información provisional, sujeta a modificación; semántica de la comuna (domicilio/contrato) NO declarada [NO COMPROBADO]",
         "", "CUADRE DE UNIDADES",
         f"  unidades del archivo {c['unit_rows']} = cargadas {c['units']} (comunas {c['comunas']}, «sin dato de comuna» {c['sin_dato_comuna']}, «sin dato de región» {c['sin_dato_region']}) + rechazadas {c['rejected']}  "
         + ("✔ cuadra" if c["unit_rows"] == c["units"] + c["rejected"] else "✘ NO CUADRA"),
         f"  rechazo {100 * c['rejected'] / max(c['unit_rows'], 1):.3f} % (máximo {100 * max_ratio:.1f} %)"]
    for r in s["rejections"]["first"]:
        L.append(f"      · {r['code']} — {r['detail']}")
    L += ["", "CUADRES CON LOS TOTALES DEL ARCHIVO (datos completos, antes de suprimir)"]
    for k, (ok, d) in s["reconcile"].items():
        L.append(f"  {'✔' if ok else '✘'} {k} [{d}]")
    L += [f"  beneficiarios (cotizantes + cargas): {isa_n(c['benef_total'])}  = cotizantes {isa_n(c['cotizantes'])} + cargas {isa_n(c['cargas'])}"]
    L += ["", f"SUPRESIÓN (regla 5; umbral < {sup['threshold']}; DISENO §3.3; réplica Python de la base)",
          f"  grupos (unidad × sexo) {isa_n(sup['grupos'])} · celdas {isa_n(sup['celdas'])} · ceros publicados {isa_n(sup.get('ceros_publicados', 0))}",
          f"  suprimidas: primarias {isa_n(sup.get('suprimidas_primary', 0))} · complementarias {isa_n(sup.get('suprimidas_complementary', 0))}",
          f"  grupos con total «<5» {isa_n(sup.get('grupos_con_total_suprimido', 0))} · grupos con complementaria {isa_n(sup.get('grupos_con_complementaria', 0))} · cuadre por cotas fallido {sup.get('grupos_cuadre_fallido', 0)}",
          "  Declaración: la cartera completa por comuna, edad y sexo ya es pública en el XLSX; la supresión es una política de presentación, no una protección real."]
    L += ["", "VEREDICTO: " + ("LISTO para cargar" if s["ready"] else "NO SE CARGA — " + "; ".join(s["errors"]))]
    return "\n".join(L)


def isa_n(x) -> str:
    return f"{x:,}".replace(",", ".") if isinstance(x, int) else str(x)


def run(args) -> int:
    conn = None
    try:
        try:
            raw, file_name, origin, declared, method = fetch_source(args)
        except Exception as e:
            print(f"\nERROR DE LA FUENTE ({type(e).__name__}): {e}\nNo se cargó nada.", file=sys.stderr)
            return EXIT_SOURCE
        import hashlib
        import tempfile
        sha = hashlib.sha256(raw).hexdigest()
        use_db = (not args.dry_run) or args.db
        settings: dict = {}
        if use_db:
            from . import isapre_db
            conn = isapre_db.connect()
            if args.dry_run:
                conn.execute("set transaction read only")
            comunas, settings = isapre_db.load_reference(conn)
        else:
            comunas = read_comunas_csv()
            for c in comunas:
                c.setdefault("region_cut", c.get("region_cut") or c["cut"][:2])
        aliases = load_json(ALIASES_PATH)
        thr = int(settings.get("salud.suppress_below", isa.THRESHOLD))
        max_reject = settings.get("publish.max_reject_ratio", DEFAULT_MAX_REJECT)
        with tempfile.NamedTemporaryFile(suffix=".xlsx") as tmp:
            tmp.write(raw)
            tmp.flush()
            try:
                cart = isa.read_workbook(tmp.name, comunas, [a for a in aliases if not a.get("_nota")])
                recon = isa.reconcile(cart, tmp.name)
            except (isa.StructureError, KeyError, ValueError) as e:
                print(f"\nESTRUCTURA INVÁLIDA: {e}\nNo se cargó nada.", file=sys.stderr)
                return EXIT_STRUCTURE
        groups = isa.suppress_all(cart)
        ssum = isa.summarize(groups)
        ssum["threshold"] = thr
        last = calendar.monthrange(cart.period_year, cart.period_month)[1]
        period = (date(cart.period_year, cart.period_month, 1), date(cart.period_year, cart.period_month, last))
        by_kind = {k: sum(1 for u in cart.units.values() if u.kind == k) for k in ("comuna", "sin_dato_comuna", "sin_dato_region")}
        benef = {rol: sum(sum(v) for (u, r, s), v in cart.counts.items() if r == rol) for rol in isa.ROLES}
        s: dict = {
            "file_name": file_name, "bytes": len(raw), "sha256": sha, "origin": origin, "declared_date": declared[0].isoformat() if declared[0] else None,
            "declared_date_note": declared[1],
            "cartera": {"period": f"{period[0]:%Y-%m} ({period[0].isoformat()} a {period[1].isoformat()})", "extraction_date": cart.extraction_date.isoformat() if cart.extraction_date else None,
                        "unit_rows": cart.unit_rows, "units": len(cart.units), "rejected": len(cart.rejections), "comunas": by_kind["comuna"],
                        "sin_dato_comuna": by_kind["sin_dato_comuna"], "sin_dato_region": by_kind["sin_dato_region"],
                        "benef_total": sum(benef.values()), "cotizantes": benef["cotizante"], "cargas": benef["carga"]},
            "reconcile": {k: [ok, d] for k, (ok, d) in recon.items()}, "suppression": ssum,
            "rejections": {"total": len(cart.rejections), "by_reason": {"cut_unknown": len(cart.rejections)} if cart.rejections else {},
                           "first": [{"code": r.code, "detail": r.detail} for r in cart.rejections[:10]]}}
        errors = []
        if not all(ok for ok, _ in recon.values()):
            errors.append("algún cuadre con los totales del archivo falla")
        if ssum.get("grupos_cuadre_fallido", 0):
            errors.append("falla el cuadre por cotas de la supresión")
        if cart.rejections and len(cart.rejections) / max(cart.unit_rows, 1) > max_reject:
            errors.append(f"rechazos sobre el máximo ({100 * max_reject:.1f} %)")
        s["errors"], s["ready"] = errors, not errors
        print(json.dumps(s, ensure_ascii=False, indent=2, default=str) if args.json else render(s, args.dry_run, max_reject))
        if errors:
            return EXIT_REJECTED if cart.rejections and "rechazos" in " ".join(errors) else EXIT_STRUCTURE
        if args.dry_run:
            return EXIT_OK

        from . import isapre_db
        report = {"file": {"extraction_date": s["cartera"]["extraction_date"], "period": s["cartera"]["period"], "sheets": list(isa.SHEETS.values())},
                  "pais_totals": cart.pais_totals, "region_totals": {f"{reg}:{rol}": n for (reg, rol), n in cart.region_totals.items()},
                  "reconcile": s["reconcile"], "suppression_dryrun": ssum, "rejections": s["rejections"]}
        result = isapre_db.run_load(
            conn=conn, origin_url=origin, file_name=file_name, sha=sha, raw=raw, cart=cart, declared=declared, period=period, report=report,
            layout={"sheets": list(isa.SHEETS.values()) + list(isa.SHEET_TOTAL.values()), "header_row": 7, "tramos": isa.TRAMOS, "unit_columns": ["N°", "Región", "Provincia", "Comuna"]},
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
