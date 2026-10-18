"""Orquestación del ETL CASEN regional: lectura de la base → estimación con error muestral → contraste con el tabulado oficial → reporte → (carga). CLI: etl/salud_casen.py."""
from __future__ import annotations

import getpass
import hashlib
import json
import socket
import sys
from datetime import date
from email.utils import parsedate_to_datetime
from pathlib import Path

from . import casen as cs

EXIT_OK, EXIT_STRUCTURE, EXIT_SOURCE, EXIT_DB, EXIT_COMPARE = 0, 2, 3, 4, 5


def _captured_by(args) -> str:
    return args.captured_by or f"etl:{getpass.getuser()}@{socket.gethostname()}"


def sha_file(path: Path) -> tuple[str, int]:
    h, n = hashlib.sha256(), 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            n += len(chunk)
    return h.hexdigest(), n


def download(url: str, dest: Path) -> str | None:
    """Descarga en streaming (la base pesa ≈ 750 MB). Devuelve el Last-Modified si lo hay."""
    import requests
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        return r.headers.get("last-modified")


def fmt(x, d=2) -> str:
    return "—" if x is None else f"{x:.{d}f}"


def render(s: dict, dry_run: bool) -> str:
    L = ["=" * 78, "CASEN 2024 — sistema previsional de salud por REGIÓN (ESTIMADA, con error muestral) — " + ("DRY-RUN (no se escribe NADA)" if dry_run else "CARGA"), "=" * 78,
         f"Base ............... {s['file_name']}  ({s['size']:,} bytes)".replace(",", "."), f"SHA-256 ............ {s['sha256']}", f"Origen ............. {s['origin']}",
         f"PERÍODO ............ {s['period']}  (año de la encuesta; fechas exactas de terreno [NO COMPROBADO])",
         f"PUBLICACIÓN ........ {s['declared_date'] or 'no declarada'}  ({s['declared_date_note']})",
         "Licencia ........... NO DECLARADA en lo leído (por confirmar) → client_ready = false",
         f"Tabulado oficial ... {s['tabulado']['name']}  sha256 {s['tabulado']['sha256']}", "",
         "NIVEL: Estimada (siempre RANGO con IC 95 %) · sello Estimado · SOLO regional (D6)",
         f"  personas {s['persons']:,} · regiones {s['regions']} · estimaciones {s['estimates']} (16 regiones × 6 sistemas) · publicables {s['publishable']} · NO publicables {s['not_publishable']}".replace(",", "."),
         "  no publicable = menos de 60 casos muestrales o «no fiable» según las notas oficiales:"]
    for r in s["not_publishable_list"][:12]:
        L.append(f"      · región {r['region']} {r['sistema']}: {r['n']} casos — {r['reason']}")
    L += ["", "CUADRES Y CONTRASTE CON EL TABULADO OFICIAL (Salud_Casen_2024.xlsx, hoja 3)",
          f"  {'✔' if s['totals_ok'] else '✘'} personas y población expandida por región = filas «Total» del tabulado (Σ personas {s['persons']:,})".replace(",", "."),
          f"  {'✔' if s['compare']['ok'] else '✘'} estimación propia vs oficial: diferencia máxima {s['compare']['max_diff_pct_pp']:.2e} pp · error estándar {s['compare']['max_diff_se_pp']:.2e} pp · casos {s['compare']['max_diff_n']}",
          f"  df mínimo {s['df_min']} · estratos con un solo conglomerado {s['lonely']}"]
    L += ["", "EJEMPLOS (Isapre, IC 95 %)"]
    for r in s["examples"]:
        L.append(f"  región {r['region']}: {fmt(r['pct'])} % (entre {fmt(r['lo'])} y {fmt(r['hi'])} %), error estándar {fmt(r['se'], 3)} pp, {r['n']} casos")
    L += ["", "VEREDICTO: " + ("LISTO para cargar" if s["ready"] else "NO SE CARGA — " + "; ".join(s["errors"]))]
    return "\n".join(L)


def run(args) -> int:
    conn = None
    try:
        tmp_dir = Path(args.work_dir or "/tmp") / "salud_casen_work"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        lm = None
        sav_url = args.sav_url or cs.DATA_URL
        try:
            if args.sav:
                sav = Path(args.sav)
            else:
                sav = tmp_dir / "casen_2024.sav"
                lm = download(sav_url, sav)
            if args.tabulado:
                tb = Path(args.tabulado)
            else:
                tb = tmp_dir / "Salud_Casen_2024.xlsx"
                download(args.tabulado_url or cs.TABULADO_URL, tb)
            for f in (sav, tb):
                if not Path(f).is_file():
                    raise FileNotFoundError(f"no existe el archivo {f}")
        except Exception as e:
            print(f"\nERROR DE LA FUENTE ({type(e).__name__}): {e}\nNo se cargó nada.", file=sys.stderr)
            return EXIT_SOURCE
        sha, size = sha_file(sav)
        tb_raw = tb.read_bytes()
        tb_sha = hashlib.sha256(tb_raw).hexdigest()
        try:
            df = cs.read_sav(sav)
            off = cs.read_official(tb)
        except (cs.StructureError, KeyError, ValueError, OSError) as e:
            print(f"\nESTRUCTURA INVÁLIDA: {e}\nNo se cargó nada.", file=sys.stderr)
            return EXIT_STRUCTURE
        ests = cs.finalize(cs.estimate(df), off)
        cmp_ = cs.compare(ests, off)
        rt = cs.region_totals(df)
        totals_ok = all(off.n_total.get(r) == v["n"] and off.pop_total.get(r) is not None and abs(off.pop_total[r] - v["pop"]) < 0.5 for r, v in rt.items()) and set(rt) == set(cs.REGIONS)
        declared_date = None
        note = "no declarada"
        if args.declared_date:
            declared_date, note = date.fromisoformat(args.declared_date), "indicada por el operador (--declared-date)"
        elif lm:
            declared_date, note = parsedate_to_datetime(lm).date(), "cabecera HTTP Last-Modified de la base"
        period = (date(2024, 1, 1), date(2024, 12, 31))
        s = {"file_name": sav.name, "size": size, "sha256": sha, "origin": sav_url if not args.sav else (args.origin_url or cs.DATA_URL), "period": "2024",
             "declared_date": declared_date.isoformat() if declared_date else None, "declared_date_note": note,
             "tabulado": {"name": tb.name, "sha256": tb_sha}, "persons": len(df), "regions": len(rt), "estimates": len(ests),
             "publishable": sum(e.publishable for e in ests), "not_publishable": sum(not e.publishable for e in ests),
             "not_publishable_list": [{"region": e.region_cut, "sistema": e.sistema, "n": e.n_sample, "reason": e.reason} for e in ests if not e.publishable],
             "totals_ok": totals_ok, "compare": cmp_, "df_min": min(e.df for e in ests), "lonely": sum(e.lonely_strata for e in ests),
             "examples": [{"region": e.region_cut, "pct": e.pct, "lo": e.ci_lo, "hi": e.ci_hi, "se": e.se, "n": e.n_sample} for e in ests if e.sistema == "isapre" and e.region_cut in ("01", "13", "15")]}
        errors = []
        if not cmp_["ok"]:
            errors.append("la estimación propia no coincide con el tabulado oficial")
        if not totals_ok:
            errors.append("personas o población expandida por región no cuadran con el tabulado")
        if s["lonely"] > 0:
            errors.append(f"hay estratos con un solo conglomerado ({s['lonely']} casos): su varianza no se puede estimar y el error muestral quedaría subestimado")
        s["errors"], s["ready"] = errors, not errors
        print(json.dumps(s, ensure_ascii=False, indent=2, default=str) if args.json else render(s, args.dry_run))
        if errors:
            return EXIT_COMPARE
        if args.dry_run:
            return EXIT_OK
        from . import casen_db
        conn = casen_db.connect()
        report = {"official_totals": {r: {"n": off.n_total[r], "pop": off.pop_total[r]} for r in rt}, "compare": cmp_, "summary": {k: s[k] for k in ("persons", "publishable", "not_publishable", "df_min", "lonely")},
                  "unreliable_notes": off.notes, "method": "linealización de Taylor, 1 nivel de conglomerados (varstrat, varunit), factor regional expr, IC 95 % con t de Student (df = conglomerados − estratos)"}
        result = casen_db.run_load(conn=conn, origin_url=s["origin"], file_name=sav.name, sha=sha, size=size, tabulado=(tb_raw, tb_sha, tb.name), ests=ests, persons=len(df),
                                   declared=(declared_date, note), period=period, report=report,
                                   layout={"variables": ["region", "expr", "varstrat", "varunit", "s13"], "tabulado_sheet": "3", "unit": "región"}, captured_by=_captured_by(args),
                                   capture_method="manual_download" if args.sav else "automatic_download", use_storage=not args.no_storage, publish=not args.stage_only)
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
