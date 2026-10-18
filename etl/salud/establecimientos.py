"""Registro de establecimientos de salud (DEIS/MINSAL): lectura, normalización explícita, validación y reporte. Sin base de datos aquí.

Diseño y decisiones: docs/salud/DISENO.md §2. La base RE-VALIDA todo al publicar (publish_health_establishments); este módulo
solo prepara filas limpias, rechaza con código lo que no se puede cargar y cuenta todo para que los cuadres se vean ANTES de escribir.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from proyectos.common import Rejection, in_chile_bbox

HERE = Path(__file__).resolve().parent
EQUIV_PATH = HERE / "equivalencias_establecimientos.json"
TIPOS_PATH = HERE / "tipos_clasificacion.json"

SOURCE_KEY = "deis_establecimientos"
LAYER = "establecimientos"
PACKAGE_ID = "3bf4cf7c-f638-4735-9a01-f65faae4beca"
DATA_URL = ("https://datos.gob.cl/dataset/3bf4cf7c-f638-4735-9a01-f65faae4beca/resource/2c44d782-3365-44e3-aefb-2c8b8363a1bc/"
            "download/establecimientos_20261014.csv")
CKAN_PACKAGE_URL = f"https://datos.gob.cl/api/3/action/package_show?id={PACKAGE_ID}"

EXPECTED_COLUMNS = [
    "EstablecimientoCodigoAntiguo", "EstablecimientoCodigo", "EstablecimientoCodigoMadreAntiguo", "EstablecimientoCodigoMadreNuevo",
    "RegionCodigo", "RegionGlosa", "SeremiSaludCodigo_ServicioDeSaludCodigo", "SeremiSaludGlosa_ServicioDeSaludGlosa",
    "TipoPertenenciaEstabGlosa", "TipoEstablecimientoGlosa", "AmbitoFuncionamiento", "EstablecimientoGlosa", "Certificacion",
    "DependenciaAdministrativa", "NivelAtencionEstabglosa", "ComunaCodigo", "ComunaGlosa", "TipoViaGlosa", "NombreVia", "Numero",
    "TelefonoMovil_TelefonoFijo", "FechaInicioFuncionamientoEstab", "TieneServicioUrgencia", "TipoUrgencia", "ClasificacionTipoSapu",
    "Latitud", "Longitud", "TipoSistemaSaludGlosa", "EstadoFuncionamiento", "NivelComplejidadEstabGlosa", "TipoAtencionEstabGlosa",
    "FechaIncorporacion", "FechaCierre"]

# Columnas de la zona de paso, en el orden de las tuplas que produce transform()
STAGE_COLUMNS = ("code, old_code, parent_code, name, region_cut, comuna_cut, comuna_glosa, tipo_glosa, ambito, dependencia_raw, dependencia_norm, "
                 "tipo_sistema_raw, snss, nivel_atencion_raw, complejidad_raw, complejidad, tipo_atencion_raw, tipo_atencion, estado, "
                 "fecha_inicio, fecha_cierre, tiene_urgencia, tipo_urgencia, address, coords_present, lon_raw, lat_raw")
C = {n: i for i, n in enumerate(c.strip() for c in STAGE_COLUMNS.split(","))}

DEFAULT_NEAR_M = 500.0
DEFAULT_COAST_M = 2000.0
CASOS_ESPECIALES = {"05201": "Isla de Pascua", "05104": "Juan Fernández", "12201": "Cabo de Hornos", "12202": "Antártica"}
GEO_LABELS = {0: "dentro", 1: "borde", 2: "costero", 3: "fuera_declarada", 4: "sin_coordenadas", 5: "comuna_sin_poligono", 6: "coordenada_invalida"}


def norm_key(s) -> str:
    """minúsculas, sin tildes, espacios colapsados («Atención  Abierta» → «atencion abierta»)."""
    t = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", t).strip().lower()


def tipo_norm(s) -> str:
    """Igual que la base: minúsculas con espacios colapsados, CONSERVA las tildes (lower(regexp_replace(btrim(x), '\\s+', ' ')))."""
    return re.sub(r"\s+", " ", str(s or "").strip()).lower()


def load_equivalences(path: Path = EQUIV_PATH) -> dict:
    return {k: v for k, v in json.loads(path.read_text(encoding="utf-8")).items() if not k.startswith("_")}


def load_tipos(path: Path = TIPOS_PATH) -> dict:
    return {k: v for k, v in json.loads(path.read_text(encoding="utf-8")).items() if not k.startswith("_")}


# ------------------------------------------------------------------------------------------------ lectura
class StructureError(Exception):
    pass


def parse_csv(raw: bytes) -> list[dict]:
    """CSV ';' en UTF-8 (con o sin BOM). Falla si faltan columnas esperadas; columnas extra se ignoran y se reportan aparte."""
    text = raw.decode("utf-8-sig")
    rd = csv.DictReader(io.StringIO(text, newline=""), delimiter=";")
    header = [h.strip() for h in (rd.fieldnames or [])]
    missing = [c for c in EXPECTED_COLUMNS if c not in header]
    if missing:
        raise StructureError("faltan columnas: " + ", ".join(missing))
    rd.fieldnames = header
    rows = []
    for r in rd:
        if None in r:                                       # más celdas que encabezados
            r.pop(None)
        rows.append({k: (v or "").strip() if isinstance(v, str) else "" for k, v in r.items()})
    return rows


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def date_from_filename(name: str) -> date | None:
    m = re.search(r"(\d{4})(\d{2})(\d{2})", name or "")
    try:
        return date(int(m[1]), int(m[2]), int(m[3])) if m else None
    except ValueError:
        return None


def parse_date(s: str) -> date | None:
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", s or "")
    if not m:
        return None
    try:
        return date(int(m[3]), int(m[2]), int(m[1]))
    except ValueError:
        return None


def parse_float(s: str) -> float | None:
    if not s:
        return None
    try:
        v = float(s.replace(",", "."))
    except ValueError:
        return None
    return v if math.isfinite(v) else None


# ------------------------------------------------------------------------------------------------ transformación
@dataclass
class Result:
    rows: list[tuple] = field(default_factory=list)
    rejections: list[Rejection] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def _lookup(table: dict, raw: str):
    k = norm_key(raw)
    return (True, table[k]) if k in table else (False, None)


def transform(rows: list[dict], valid_cuts: set[str], comuna_names: dict[str, str], equiv: dict | None = None) -> Result:
    eq = equiv or load_equivalences()
    res = Result()
    seen: set[str] = set()
    st: Counter = Counter()
    by: dict[str, Counter] = {k: Counter() for k in ("estado", "complejidad", "tipo_atencion", "dependencia", "tipo", "snss", "region")}
    name_mismatch: list[dict] = []

    def reject(i: int, r: dict, code: str, detail: str):
        res.rejections.append(Rejection(LAYER, i, code, detail, {k: r.get(k, "") for k in ("EstablecimientoCodigo", "EstablecimientoGlosa", "ComunaCodigo", "ComunaGlosa")}))

    for i, r in enumerate(rows, start=2):                     # fila 1 = encabezado → número de línea del archivo
        code = r["EstablecimientoCodigo"]
        if not re.fullmatch(r"[0-9]{6}", code):
            reject(i, r, "other", f"codigo_invalido: {code!r}")
            continue
        if code in seen:
            reject(i, r, "duplicate_key", f"EstablecimientoCodigo repetido: {code}")
            continue
        raw_cut = r["ComunaCodigo"]
        if not re.fullmatch(r"[0-9]{4,5}", raw_cut):
            reject(i, r, "cut_invalid", f"ComunaCodigo no es un CUT: {raw_cut!r}")
            continue
        cut = raw_cut.zfill(5)
        if cut not in valid_cuts:
            reject(i, r, "cut_unknown", f"CUT {cut} no existe en comunas")
            continue
        region = r["RegionCodigo"].zfill(2)
        if region != cut[:2]:
            reject(i, r, "other", f"region_no_coincide: RegionCodigo {region} vs CUT {cut}")
            continue
        if not r["EstablecimientoGlosa"] or not r["TipoEstablecimientoGlosa"]:
            reject(i, r, "other", "nombre_o_tipo_vacio")
            continue
        ok, estado = _lookup(eq["estado"], r["EstadoFuncionamiento"])
        if not ok:
            reject(i, r, "other", f"estado_desconocido: {r['EstadoFuncionamiento']!r}")
            continue
        ok, comp = _lookup(eq["complejidad"], r["NivelComplejidadEstabGlosa"])
        if not ok:
            reject(i, r, "other", f"complejidad_desconocida: {r['NivelComplejidadEstabGlosa']!r}")
            continue
        ok, ta = _lookup(eq["tipo_atencion"], r["TipoAtencionEstabGlosa"])
        if not ok:
            reject(i, r, "other", f"tipo_atencion_desconocido: {r['TipoAtencionEstabGlosa']!r}")
            continue
        ok, dep = _lookup(eq["dependencia"], r["DependenciaAdministrativa"])
        if not ok:
            reject(i, r, "other", f"dependencia_desconocida: {r['DependenciaAdministrativa']!r}")
            continue
        ok, snss = _lookup(eq["snss"], r["TipoPertenenciaEstabGlosa"])
        if not ok:
            reject(i, r, "other", f"pertenencia_desconocida: {r['TipoPertenenciaEstabGlosa']!r}")
            continue
        seen.add(code)
        if norm_key(r["TipoAtencionEstabGlosa"]) in eq.get("tipo_atencion_truncadas", []):
            st["tipo_atencion_truncada_equivalida"] += 1
        if norm_key(r["DependenciaAdministrativa"]) in eq.get("dependencia_truncadas", []):
            st["dependencia_con_errata_equivalida"] += 1

        urg = eq["si_no"].get(norm_key(r["TieneServicioUrgencia"]), None)
        f_ini, f_cie = parse_date(r["FechaInicioFuncionamientoEstab"]), parse_date(r["FechaCierre"])
        if r["FechaInicioFuncionamientoEstab"] and f_ini is None:
            st["fecha_inicio_invalida"] += 1
        if r["FechaCierre"] and f_cie is None:
            st["fecha_cierre_invalida"] += 1
        if estado == "cerrado" and f_cie is None and not r["FechaCierre"]:
            st["cerrado_sin_fecha_cierre"] += 1
        lat, lon = parse_float(r["Latitud"]), parse_float(r["Longitud"])
        present = bool(r["Latitud"] or r["Longitud"])
        if not present:
            st["sin_coordenadas"] += 1
        elif lat is None or lon is None:
            st["coordenada_ilegible"] += 1
        addr = " ".join(x for x in (r["TipoViaGlosa"], r["NombreVia"], r["Numero"]) if x and norm_key(x) != "no aplica") or None
        gl = r["ComunaGlosa"]
        if gl and norm_key(gl) != norm_key(comuna_names.get(cut, "")):
            st["glosa_comuna_distinta"] += 1
            if len(name_mismatch) < 10:
                name_mismatch.append({"codigo": code, "cut": cut, "glosa_archivo": gl, "nombre_comuna": comuna_names.get(cut)})
        res.rows.append((
            code, r["EstablecimientoCodigoAntiguo"] or None, r["EstablecimientoCodigoMadreNuevo"] or None, r["EstablecimientoGlosa"], region, cut, gl or None,
            r["TipoEstablecimientoGlosa"], r["AmbitoFuncionamiento"] or None, r["DependenciaAdministrativa"] or None, dep,
            r["TipoSistemaSaludGlosa"] or None, snss, r["NivelAtencionEstabglosa"] or None, r["NivelComplejidadEstabGlosa"] or None, comp,
            r["TipoAtencionEstabGlosa"] or None, ta, estado, f_ini, f_cie, urg, r["TipoUrgencia"] or None, addr, present,
            lon if present else None, lat if present else None))
        by["estado"][estado] += 1
        by["complejidad"][comp] += 1
        by["tipo_atencion"][ta] += 1
        by["dependencia"][dep] += 1
        by["tipo"][r["TipoEstablecimientoGlosa"]] += 1
        by["snss"][str(snss)] += 1
        by["region"][region] += 1
    res.stats = {"rows_file": len(rows), "accepted": len(res.rows), "rejected": len(res.rejections),
                 "by": {k: dict(v) for k, v in by.items()}, "counters": dict(st), "glosa_mismatch_examples": name_mismatch,
                 "comunas_with_establishments": len({x[C["comuna_cut"]] for x in res.rows}),
                 "comunas_without": sorted(valid_cuts - {x[C["comuna_cut"]] for x in res.rows})}
    return res


# ------------------------------------------------------------------------------------------------ clasificación (réplica del cálculo de la base, solo para el reporte)
def classify(rows: list[tuple], tipos: dict) -> dict:
    """Réplica de lo que publish_health_establishments() calcula. La base es la autoritativa; esto permite ver las cifras en el --dry-run."""
    out: Counter = Counter()
    unknown: Counter = Counter()
    for r in rows:
        t = tipos.get(tipo_norm(r[C["tipo_glosa"]]))
        if t is None:
            unknown[r[C["tipo_glosa"]]] += 1
            continue
        ta = r[C["tipo_atencion"]]
        if ta == "ambulatoria":
            clase, fuente = "ambulatorio", "oficial"
        elif ta == "hospitalaria":
            clase, fuente = "hospitalario", "oficial"
        elif t["clase"] in ("ambulatorio", "hospitalario"):
            clase, fuente = t["clase"], "tabla"
        else:
            clase, fuente = "sin_clasificar", "sin_clasificar"
        vig = r[C["estado"]] == "vigente"
        alta = r[C["complejidad"]] == "alta"
        ah, aa = alta and t["alta_hospital"], alta and t["alta_ampliada"]
        out[f"clase_fuente:{fuente}"] += 1
        out[f"clase_servicio:{clase}"] += 1
        if vig:
            out[f"vigente_clase_fuente:{fuente}"] += 1
            out[f"vigente_clase_servicio:{clase}"] += 1
            out["alta_hospital_vigentes"] += ah
            out["alta_ampliada_vigentes"] += aa
            out["alta_fuera_de_ambas_vigentes"] += alta and not aa
            if clase == "ambulatorio" and r[C["dependencia_norm"]] == "privado":
                out["ambulatorio_privado_vigentes"] += 1
        out["alta_hospital_todos"] += ah
        out["alta_ampliada_todos"] += aa
        out["alta_fuera_de_ambas_todos"] += alta and not aa
    return {"counts": dict(out), "tipos_sin_clasificar": dict(unknown)}


# ------------------------------------------------------------------------------------------------ geografía (aproximada en el dry-run)
def _haversine_m(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(a))


def geocheck(rows: list[tuple], polys: dict, near_m: float, coast_m: float) -> dict:
    """Misma lógica que la base (estados 0–6) pero con shapely y distancia haversine al punto más cercano: APROXIMADA. La autoritativa es la de la base.
    Devuelve conteos por estado (todas las filas), por casos especiales y la distribución de distancias de los puntos fuera de su comuna."""
    import shapely
    from shapely.ops import nearest_points
    from shapely.strtree import STRtree
    cuts = list(polys)
    tree = STRtree([polys[c] for c in cuts])
    status: Counter = Counter()
    special: dict[str, Counter] = {c: Counter() for c in CASOS_ESPECIALES}
    dists: list[float] = []
    examples: list[dict] = []
    for r in rows:
        cut, present, lon, lat = r[C["comuna_cut"]], r[C["coords_present"]], r[C["lon_raw"]], r[C["lat_raw"]]
        poly = polys.get(cut)
        if not present:
            s = 4
        elif lon is None or lat is None or not (-110 <= lon <= -50 and -90 <= lat <= -17) or not in_chile_bbox(lon, lat):
            s = 6
        elif poly is None:
            s = 5
        else:
            pt = shapely.Point(lon, lat)
            if poly.covers(pt):
                s = 0
            else:
                a, b = nearest_points(poly, pt)
                d = _haversine_m(a.x, a.y, b.x, b.y)
                dists.append(d)
                if d <= near_m:
                    s = 1
                else:
                    in_other = any(cuts[j] != cut and polys[cuts[j]].covers(pt) for j in tree.query(pt))
                    s = 2 if (not in_other and d <= coast_m) else 3
                    if s == 3 and len(examples) < 8:
                        examples.append({"codigo": r[C["code"]], "cut": cut, "dist_m_aprox": round(d), "en_otra_comuna": in_other})
        status[s] += 1
        if cut in special:
            special[cut][GEO_LABELS[s]] += 1
    dists.sort()
    q = lambda p: round(dists[min(int(p * len(dists)), len(dists) - 1)]) if dists else None  # noqa: E731
    return {"by_status": {GEO_LABELS[k]: v for k, v in sorted(status.items())}, "special_cases": {f"{c} {CASOS_ESPECIALES[c]}": dict(v) for c, v in special.items() if v},
            "outside_distance_m": {"n": len(dists), "p50": q(0.5), "p90": q(0.9), "p99": q(0.99), "max": round(dists[-1]) if dists else None},
            "examples_fuera_declarada": examples, "near_border_m": near_m, "coast_buffer_m": coast_m}


def load_polygons(path: Path | None = None) -> dict:
    from proyectos.geocheck import load_comuna_polygons
    return load_comuna_polygons(path) if path else load_comuna_polygons()


# ------------------------------------------------------------------------------------------------ reporte
def n(x) -> str:
    return f"{x:,}".replace(",", ".") if isinstance(x, int) else str(x)


def render(s: dict, dry_run: bool, max_ratio: float) -> str:
    st, cl = s["stats"], s["classify"]["counts"]
    L = ["=" * 78, "Establecimientos de salud (DEIS/MINSAL) — " + ("DRY-RUN (no se escribe NADA: ni base de datos, ni Storage, ni disco)" if dry_run else "CARGA"), "=" * 78,
         f"Archivo ............ {s['file_name']}  ({n(s['bytes'])} bytes)",
         f"SHA-256 ............ {s['sha256']}",
         f"Origen ............. {s['origin']}",
         f"Fecha declarada .... {s['declared_date'] or 'no declarada'}  ({s['declared_date_note']})",
         f"Licencia ........... CC0 (según datos.gob.cl)",
         "", "CUADRE DE FILAS",
         f"  filas del archivo {n(st['rows_file'])} = cargadas {n(st['accepted'])} + rechazadas {n(st['rejected'])}  "
         + ("✔ cuadra" if st["rows_file"] == st["accepted"] + st["rejected"] else "✘ NO CUADRA"),
         f"  rechazo {100 * st['rejected'] / max(st['rows_file'], 1):.3f} % (máximo {100 * max_ratio:.1f} %)"]
    if s["rejections"]["total"]:
        L.append(f"  por motivo: {s['rejections']['by_reason']}")
        for x in s["rejections"]["first"]:
            L.append(f"      · línea {x['oid']}: {x['code']} — {x['detail']}")
    b = st["by"]
    L += ["", "QUÉ SE CARGARÍA",
          f"  estado ........... {b['estado']}",
          f"  complejidad ...... {b['complejidad']}   (sin_dato ≠ no_aplica ≠ baja)",
          f"  tipo de atención . {b['tipo_atencion']}",
          f"  dependencia ...... {b['dependencia']}",
          f"  comunas con al menos un establecimiento: {st['comunas_with_establishments']} de 346; sin ninguno: {st['comunas_without'] or 'ninguna'}",
          f"  equivalencias aplicadas: {st['counters'] or 'ninguna'}"]
    L += ["", "CLASE AMBULATORIO/HOSPITALARIO (decisión de diseño: manda lo oficial; la tabla solo completa — advertencia regla 3)",
          f"  de todas las filas: oficial {n(cl.get('clase_fuente:oficial', 0))} · imputada por tabla {n(cl.get('clase_fuente:tabla', 0))} · sin clasificar {n(cl.get('clase_fuente:sin_clasificar', 0))}",
          f"  de las VIGENTES:    oficial {n(cl.get('vigente_clase_fuente:oficial', 0))} · imputada por tabla {n(cl.get('vigente_clase_fuente:tabla', 0))} · sin clasificar {n(cl.get('vigente_clase_fuente:sin_clasificar', 0))}"]
    if s["classify"]["tipos_sin_clasificar"]:
        L.append(f"  ✘ tipos que la tabla no conoce (la base rechazará la publicación): {s['classify']['tipos_sin_clasificar']}")
    L += ["", "ALTA COMPLEJIDAD (D1: dos definiciones, siempre etiquetadas)",
          f"  hospitales (alta + tipo Hospital) .............. todos los estados {cl.get('alta_hospital_todos', 0)} · vigentes {cl.get('alta_hospital_vigentes', 0)}",
          f"  ampliada (+ Clínicas y Centros de Especialidades) todos {cl.get('alta_ampliada_todos', 0)} · vigentes {cl.get('alta_ampliada_vigentes', 0)}",
          f"  alta complejidad fuera de ambas (tipo Otro/SAMU) .. todos {cl.get('alta_fuera_de_ambas_todos', 0)} · vigentes {cl.get('alta_fuera_de_ambas_vigentes', 0)}",
          f"  privados (D2: DependenciaAdministrativa = Privado) {b['dependencia'].get('privado', 0)}; ambulatorios privados vigentes {n(cl.get('ambulatorio_privado_vigentes', 0))}"]
    if st["glosa_mismatch_examples"] or st["counters"].get("glosa_comuna_distinta"):
        L += ["", f"NOMBRE DE COMUNA DISTINTO DEL CUT (se reporta, no se corrige): {st['counters'].get('glosa_comuna_distinta', 0)}"]
        for x in st["glosa_mismatch_examples"][:5]:
            L.append(f"      · {x}")
    g = s.get("geocheck")
    if g:
        L += ["", f"VALIDACIÓN GEOGRÁFICA (aproximada en el ensayo; la autoritativa es la de la base al publicar). Se marca, jamás se mueve.",
              f"  umbrales: borde ≤ {g['near_border_m']:.0f} m · costero ≤ {g['coast_buffer_m']:.0f} m (y fuera de toda comuna)",
              f"  por estado: {g['by_status']}",
              f"  distancia al polígono declarado de los puntos fuera de él: {g['outside_distance_m']}"]
        for k, v in g["special_cases"].items():
            L.append(f"  caso especial {k}: {v}")
        for x in g["examples_fuera_declarada"][:5]:
            L.append(f"      · fuera_declarada {x}")
    elif s.get("geocheck_skipped"):
        L += ["", f"VALIDACIÓN GEOGRÁFICA omitida: {s['geocheck_skipped']}"]
    L += ["", "VEREDICTO: " + ("LISTO para cargar" if s["ready"] else "NO SE CARGA — " + "; ".join(s["errors"]))]
    return "\n".join(L)
