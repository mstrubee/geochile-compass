"""Reportes en texto de los ensayos y cargas de la Parte 4."""
from __future__ import annotations


def n(x) -> str:
    return f"{x:,}".replace(",", ".") if isinstance(x, int) else str(x)


def _hdr(title: str, dry_run: bool) -> list[str]:
    return ["=" * 78, f"{title} — " + ("DRY-RUN (no se escribe NADA: ni base de datos, ni Storage, ni disco)" if dry_run else "CARGA"), "=" * 78]


def common_block(s: dict) -> list[str]:
    L = [f"Capa ................ {s['layer_url']}",
         f"Consultada (UTC) ... {s['started_utc']}  →  {s['finished_utc']}",
         f"Conteo del servidor  antes {n(s['count_before'])} · después {n(s['count_after'])} · descargados {n(s['downloaded'])}  "
         + ("✔ coinciden" if s["consistent"] else "✘ NO COINCIDEN"),
         f"Páginas / peticiones  {s['pages']} / {s['requests']}",
         f"editingInfo ........ {s['declared_date'] or 'la capa NO declara fecha de última edición'}  ({s['declared_date_note']})",
         f"Hash GeoJSON norm. . {s['sha256']}  ({n(s['normalized_bytes'])} bytes; gz {n(s['gz_bytes'])})",
         f"Campos esperados ... " + ("todos presentes" if not s["missing_fields"] else f"✘ FALTAN: {', '.join(s['missing_fields'])}"),
         f"Licencia ........... por confirmar (el servicio no la declara; ver HALLAZGOS_SONDEO.md)"]
    return L


def rejections_block(s: dict, max_ratio: float) -> list[str]:
    r = s["rejections"]
    L = ["", "RECHAZOS", f"  filas rechazadas: {n(r['total'])}" + (f"   por motivo: {r['by_reason']}" if r["total"] else "   (ninguna)")
         + f"   ({100 * r['total'] / max(s['count_before'], 1):.3f} % del servidor; máximo {100 * max_ratio:.1f} %)"]
    for x in r["first"]:
        L.append(f"      · OBJECTID {x['oid']}: {x['code']} — {x['detail']}")
    return L


def render_pe(s: dict, dry_run: bool, max_ratio: float) -> str:
    st = s["stats"]
    L = _hdr("INE · permisos de edificación georreferenciados (PE_NACIONAL)", dry_run) + common_block(s)
    L += ["", "QUÉ SE CARGARÍA", f"  registros ......... {n(st['accepted'])}   años {min(st['by_year'], default='-')}–{max(st['by_year'], default='-')}   comunas distintas {st['comunas_distinct']} de 346",
          f"  destino (USO) ..... {st['by_uso']}", f"  PRECISION_ ........ {st['by_precision']}   (BAJA y 'sin dato' se excluyen por defecto de los análisis por punto)",
          f"  glosas distintas .. {st['glosas_distinct']}"]
    L += ["", "POR AÑO (registros · unidades · comunas con datos · precisión)  — un registro NO es un permiso: sume unidades"]
    for y in st["by_year"]:
        pr = st["precision_by_year"][y]
        L.append(f"  {y}: {n(st['by_year'][y]):>7} reg · {n(st['units_by_year'][y]):>8} unid · {st['comunas_by_year'][y]:>3} comunas · ALTA {pr.get('ALTA', 0)} MOD {pr.get('MODERADA', 0)} BAJA {pr.get('BAJA', 0)} s/dato {pr.get('sin dato', 0)}")
    L += rejections_block(s, max_ratio)
    g = s.get("geocheck")
    if g:
        L += ["", "VALIDACIÓN GEOGRÁFICA (aproximada en el ensayo; la autoritativa es la de la base al publicar)",
              f"  dentro de su comuna: {n(g.get('inside', 0))} · near_border (≈{s['near_border_m']:.0f} m): {n(g.get('near_border_approx', 0))} · "
              f"outside_declared: {n(g.get('outside_declared', 0))} · comuna sin polígono: {n(g.get('comuna_without_polygon', 0))}"]
        for e in g.get("examples_outside", []):
            L.append(f"      · comuna {e['cut']} punto ({e['lon']:.5f}, {e['lat']:.5f}) a ≈{e['dist_m_aprox']} m")
    elif s.get("geocheck_skipped"):
        L += ["", f"VALIDACIÓN GEOGRÁFICA: omitida ({s['geocheck_skipped']})"]
    if st["name_mismatch"]:
        L += ["", "GLOSA_COMUNA ≠ nombre de la comuna del CUT (top 10; diagnóstico):"] + [f"  · {m['cut']}: capa «{m['capa']}» vs comunas «{m['comunas']}» ({m['n']})" for m in st["name_mismatch"]]
    cmp_ = s.get("minvu_compare")
    if cmp_:
        L += ["", "CUADRE EXTERNO CON MINVU (DIAGNÓSTICO, no es un error; solo comunas cubiertas por el INE ese año)",
              "  año  | comunas | INE habit. | INE hab+mixto | MINVU mismas comunas | razón | MINVU nacional | INE/nacional"]
        for c in cmp_:
            L.append(f"  {c['year']} | {c['comunas_covered']:>7} | {n(c['ine_housing_only']):>10} | {n(c['ine_housing_plus_mixed']):>13} | {n(c['minvu_same_comunas']):>20} | {c['ratio']} | {n(c['minvu_national']):>14} | {c['ine_over_national']}")
        L.append("  Diferencias esperables: cobertura parcial de comunas (cambia por año), MIXTO mezcla vivienda con otros usos, MINVU 2025 es preliminar y difiere del INE (nota del archivo), y cambió la agrupación de registros entre 2019 y 2020.")
    elif s.get("minvu_compare_skipped"):
        L += ["", f"CUADRE EXTERNO CON MINVU: omitido ({s['minvu_compare_skipped']})"]
    L += ["", "VEREDICTO: " + ("LISTO PARA CARGAR" if s["ready"] else "DETENIDO — " + "; ".join(s["errors"]))]
    return "\n".join(L)


def render_crf(s: dict, dry_run: bool, max_ratio: float) -> str:
    st = s["stats"]
    L = _hdr("INE · certificados de recepción final (CRF_NACIONAL) — obra TERMINADA, no un permiso", dry_run) + common_block(s)
    L += ["", "QUÉ SE CARGARÍA", f"  polígonos ......... {n(st['accepted'])}   años {min(st['by_year'], default='-')}–{max(st['by_year'], default='-')}   comunas distintas {st['comunas_distinct']} de 346",
          f"  CUT normalizados .. {n(st['cut_zero_padded'])} venían de 4 dígitos (sin el cero inicial) y se completaron a 5"]
    L += ["", "POR AÑO (polígonos · viviendas del certificado · comunas)"]
    for y in st["by_year"]:
        L.append(f"  {y}: {n(st['by_year'][y]):>6} pol · {n(st['dwellings_by_year'][y]):>8} viv · {st['comunas_by_year'][y]:>3} comunas")
    L += rejections_block(s, max_ratio)
    gq = s.get("geometry_quality")
    if gq:
        L += ["", "CALIDAD DE LAS GEOMETRÍAS", f"  inválidas (ST_IsValid falso): {gq['invalid']} de {gq['checked']}  ({100 * gq['invalid'] / max(gq['checked'], 1):.2f} %; máximo configurado 2 %) · vértices: mediana {gq['vertices_median']}, máx {gq['vertices_max']}"]
        for e in gq.get("examples", []):
            L.append(f"      · OBJECTID {e['oid']}: {e['reason']}")
    elif s.get("geometry_quality_skipped"):
        L += ["", f"CALIDAD DE LAS GEOMETRÍAS: omitida ({s['geometry_quality_skipped']})"]
    if st["name_mismatch"]:
        L += ["", "NOM_COMUNA ≠ nombre de la comuna del CUT (top 10; diagnóstico):"] + [f"  · {m['cut']}: capa «{m['capa']}» vs comunas «{m['comunas']}» ({m['n']})" for m in st["name_mismatch"]]
    L += ["", "VEREDICTO: " + ("LISTO PARA CARGAR" if s["ready"] else "DETENIDO — " + "; ".join(s["errors"]))]
    return "\n".join(L)


def render_seia(s: dict, dry_run: bool, max_ratio: float) -> str:
    st = s["stats"]
    L = _hdr(f"SEA · proyectos del SEIA — capa {st['layer']} ({st['form']}), tipologías inmobiliarias y urbanas", dry_run) + common_block(s)
    L += ["", "FILTRO POR TIPOLOGÍA (por LETRA; reglas en seia_typology_rules)",
          f"  cargados .......... {n(st['accepted'])}    excluidos por tipología: {n(st['typology_excluded_count'])}  (la suma con los rechazos debe dar el conteo del servidor)",
          "  tipologías incluidas (letra · nombre · n):"]
    L += [f"      {x['letter']:<4} {x['n']:>5}  {x['name']}" for x in st["included_typology_names"]]
    L += ["  excluidas por letra (top 15): " + ", ".join(f"{k}={v}" for k, v in list(st["typology_excluded_by_letter"].items())[:15])]
    L += ["", f"ESTADO DE EVALUACIÓN: {st['status']}"]
    L += rejections_block(s, max_ratio)
    L += ["", "COMUNAS (nombre → CUT, sin coincidencia aproximada)",
          f"  proyectos con comuna sin cruzar (quedan comuna_unmatched): {st['comuna_unmatched_projects']}   con varias comunas: {st['projects_with_several_comunas']}"]
    if st["comuna_unmatched_names"]:
        L.append("  nombres sin cruzar (agregue un alias en etl/proyectos/aliases_seia.json): " + ", ".join(f"«{k}»×{v}" for k, v in st["comuna_unmatched_names"].items()))
    L += ["", "GEOMETRÍA", f"  sin punto: {st['without_geometry']} · el punto del servicio ≠ (NUEVO_X, NUEVO_Y): {st['geometry_differs_from_NUEVO_XY']} · NUEVO_X/Y nulos: {st['NUEVO_XY_null']} (punto = X/Y crudo en {st['geometry_is_raw_XY_when_NUEVO_null']}) · "
          f"X/Y crudos redondeados a grados enteros: {st['raw_XY_whole_degrees']}"]
    g = s.get("geocheck")
    if g:
        L += ["  validación contra la comuna declarada (aproximada en el ensayo): "
              f"dentro {n(g.get('inside', 0))} · near_border≈ {n(g.get('near_border_approx', 0))} · outside_declared {n(g.get('outside_declared', 0))} · sin polígono {n(g.get('comuna_without_polygon', 0))}"]
        for e in g.get("examples_outside", []):
            L.append(f"      · comuna {e['cut']} punto ({e['lon']:.5f}, {e['lat']:.5f}) a ≈{e['dist_m_aprox']} m")
    elif s.get("geocheck_skipped"):
        L.append(f"  validación geográfica: omitida ({s['geocheck_skipped']})")
    L += ["", "Recordatorio: el SEIA cubre SOLO lo que ingresa al sistema; FECHA_CALIFICACION no es permiso ni inicio de obras; INVERSION_US es declarada; la tipología inmobiliaria incluye proyectos no residenciales."]
    L += ["", "VEREDICTO: " + ("LISTO PARA CARGAR" if s["ready"] else "DETENIDO — " + "; ".join(s["errors"]))]
    return "\n".join(L)
