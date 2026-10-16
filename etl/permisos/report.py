"""Reporte de una corrida (dry-run o carga real): conteos, rechazos y cuadre con el total nacional."""
from __future__ import annotations

import hashlib
import os
from collections import Counter
from datetime import date

from .parse_minvu import LoadPlan, Parsed, stage_rows


def file_info(path: str) -> dict:
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            size += len(chunk)
    return {"path": path, "name": os.path.basename(path), "sha256": h.hexdigest(), "size_bytes": size}


def summarize(p: Parsed, plan: LoadPlan, info: dict, meta: dict, declared: tuple[date | None, str],
              cross: dict | None = None) -> dict:
    stored = [(s, c, per, v, prov) for s, c, per, v, prov in stage_rows(p, plan)]
    stored_cols = {c.col for c in plan.columns}
    ctrl_all = p.controls
    ctrl_stored = [c for c in ctrl_all if any(x.col in stored_cols and x.period == c.period and x.granularity == c.granularity for x in p.cols)]
    by_reason = Counter(r.code for r in p.rejections)
    prov_n = sum(1 for *_, prov in stored if prov)
    nat = {}
    for c in ctrl_all:
        if c.sheet == "número_total" and c.granularity == "year" and c.period.year in (2017, 2018, 2025):
            nat[str(c.period.year)] = {"total_pais": c.declared, "suma_comunas": c.computed}
    months26 = [(c.period.month, c.declared, c.computed) for c in ctrl_all
                if c.sheet == "número_total" and c.granularity == "month" and c.period.year == 2026]
    return {
        "file": info,
        "workbook": meta,
        "declared_date": declared[0].isoformat() if declared[0] else None,
        "declared_date_note": declared[1],
        "kind": p.kind,
        "period_start": p.period_start.isoformat(),
        "period_end": p.period_end.isoformat(),
        "sheets": list(p.sheets),
        "comuna_rows": len(next(iter(p.sheets.values())).rows),
        "unique_cut": len(p.cut_rows),
        "aliases_used": p.aliases_used,
        "nuble_merges": len(p.merges),
        "quality": {"definitive_until": p.definitive_until, "provisional_note": p.provisional_note,
                    "header_marks": {str(k): v for k, v in p.header_marks.items()}, "notes": p.notes},
        "plan": {"granularity": plan.granularity, "load_from": plan.load_from.isoformat(),
                 "columns": len(plan.columns), "not_stored": plan.not_stored},
        "values_to_stage": len(stored),
        "values_provisional": prov_n,
        "cells_examined": p.cells_examined,
        "rejections": {"total": len(p.rejections), "by_reason": dict(by_reason),
                       "first": [{"sheet": r.sheet, "row": r.row, "col": r.col, "code": r.code, "detail": r.detail}
                                 for r in p.rejections[:10]]},
        "controls": {"total": len(ctrl_all), "ok": sum(c.ok for c in ctrl_all),
                     "stored_total": len(ctrl_stored), "stored_ok": sum(c.ok for c in ctrl_stored),
                     "failed": [{"sheet": c.sheet, "period": c.period.isoformat(), "declared": c.declared, "computed": c.computed}
                                for c in ctrl_all if not c.ok][:20]},
        "national_totals": nat,
        "national_2026_months": months26,
        "internal_mismatches": {"total": len(p.internal_mismatches), "first": p.internal_mismatches[:10]},
        "region_mismatches": {"total": len(p.region_mismatches), "first": p.region_mismatches[:10]},
        "cross_check": cross,
        "errors": p.errors,
        "ready": p.ok and not p.rejections,
    }


def _n(x) -> str:
    return f"{x:,}".replace(",", ".")


def render_text(s: dict, *, dry_run: bool) -> str:
    f = s["file"]
    L = []
    add = L.append
    add("=" * 78)
    add("MINVU CEDOC · permisos de edificación — " + ("DRY-RUN (no se escribe NADA: ni base de datos, ni Storage, ni disco)" if dry_run else "CARGA"))
    add("=" * 78)
    add(f"Archivo ............ {f['name']}")
    add(f"SHA-256 ............ {f['sha256']}   ({_n(f['size_bytes'])} bytes)")
    add(f"Fecha declarada .... {s['declared_date'] or 'no declarada'}  ({s['declared_date_note']})")
    add(f"Tipo / período ..... {'ANUAL' if s['kind'] == 'annual' else 'MENSUAL'} · {s['period_start']} → {s['period_end']}")
    add(f"Hojas .............. {len(s['sheets'])}: {', '.join(s['sheets'])}")
    add("")
    add("CRUCE DE COMUNAS (nombre → CUT, sin coincidencia aproximada)")
    add(f"  filas de comuna .. {s['comuna_rows']}  →  {s['unique_cut']} CUT únicos   ({s['nuble_merges']} de Ñuble fusionadas por período)")
    add(f"  alias explícitos . {len(s['aliases_used'])}" + "".join(f"\n      · {a['name']!r} ({a['region_label']}) → {a['cut']}" for a in s["aliases_used"]))
    add("")
    q = s["quality"]
    add("CALIDAD (según el texto de las notas del propio archivo)")
    add(f"  definitivo hasta . {q['definitive_until']}   · provisional desde {q['definitive_until'] + 1}")
    add(f"  marcas de cabecera {q['header_marks']}")
    if q["provisional_note"]:
        add(f"  nota ............. {q['provisional_note'][:110]}…")
    add("")
    pl = s["plan"]
    add("QUÉ SE CARGARÍA")
    add(f"  granularidad ..... {pl['granularity']}  ·  desde {pl['load_from']}  ·  {pl['columns']} columnas × 346 comunas × 6 hojas")
    add(f"  valores .......... {_n(s['values_to_stage'])}   (de ellos provisionales: {_n(s['values_provisional'])})")
    if pl["not_stored"]:
        add(f"  NO se guardan .... {len(pl['not_stored'])} columnas mensuales ({pl['not_stored'][0][:7]}…{pl['not_stored'][-1][:7]}): el archivo mensual es su fuente; aquí solo sirven de control cruzado")
    add("")
    r = s["rejections"]
    add("RECHAZOS")
    add(f"  filas/celdas rechazadas: {r['total']}" + (f"   por motivo: {r['by_reason']}" if r["total"] else "   (ninguna)"))
    for x in r["first"]:
        add(f"      · {x['sheet']} fila {x['row']} col {x['col']}: {x['code']} — {x['detail']}")
    add("")
    c = s["controls"]
    add("CUADRE CON EL TOTAL NACIONAL PUBLICADO (suma de comunas = fila 'Total País')")
    add(f"  todas las columnas  {_n(c['ok'])}/{_n(c['total'])} OK    ·    las que se cargarían  {_n(c['stored_ok'])}/{_n(c['stored_total'])} OK")
    for y, v in sorted(s["national_totals"].items()):
        add(f"      número_total {y}: Total País {_n(v['total_pais'])} · suma de comunas {_n(v['suma_comunas'])} {'✔' if v['total_pais'] == v['suma_comunas'] else '✘'}")
    if s["national_2026_months"]:
        m = s["national_2026_months"]
        add("      número_total 2026 (ene–jul): " + ", ".join(_n(x[1]) for x in m) + f"  (suma {_n(sum(x[1] for x in m))})")
    for x in c["failed"]:
        add(f"      ✘ {x['sheet']} {x['period']}: Total País {_n(x['declared'])} ≠ suma {_n(x['computed'])}")
    add("")
    i = s["internal_mismatches"]
    add(f"COHERENCIA total = casas + departamentos, por comuna y período: {i['total']} incoherencias")
    g = s["region_mismatches"]
    add(f"SUBTOTALES REGIONALES vs suma de sus comunas (informativo): {g['total']} diferencias")
    xc = s["cross_check"]
    if xc:
        add(f"CRUCE ANUAL ↔ MENSUAL: {_n(xc['compared_year_cells'])} celdas anuales = Σ meses, {_n(xc['compared_month_cells'])} celdas de mes iguales → "
            + ("OK" if xc["ok"] else f"{len(xc['mismatches'])} DESAJUSTES"))
        for x in xc["mismatches"][:5]:
            add(f"      ✘ {x}")
    add("")
    if s["errors"]:
        add("ERRORES BLOQUEANTES")
        for e in s["errors"]:
            add(f"  ✘ {e}")
        add("")
    add("VEREDICTO: " + ("LISTO PARA CARGAR" if s["ready"] else "DETENIDO — hay que resolver lo anterior antes de cargar"))
    return "\n".join(L)
