"""Transformación y validación de las capas del INE (CRF_PE_v2): PE_NACIONAL (permisos, puntos) y CRF_NACIONAL (recepciones, polígonos).

Cada función devuelve las filas listas para la zona de paso y las filas RECHAZADAS con su motivo; nada se corrige en silencio.
Los códigos de rechazo son los de geo_rejected_rows.reason_code.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .common import Rejection, cut_from_number, cut_from_text, finite, in_chile_bbox, point_lonlat
from permisos.norm import norm  # noqa: E402  (etl/ está en sys.path)

USO = {"HABITACIONAL": 1, "MIXTO": 2, "NO HABITACIONAL": 3}
PRECISION = {None: 0, "BAJA": 1, "MODERADA": 2, "ALTA": 3}
PRECISION_LABEL = {0: "sin dato", 1: "BAJA", 2: "MODERADA", 3: "ALTA"}
SMALLINT_MAX = 32767


@dataclass
class PeResult:
    rows: list[tuple] = field(default_factory=list)         # (src_oid, cut, year, units, floors, uso, precision, glosa, area, lon, lat)
    rejections: list[Rejection] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def _int(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, float):
        return int(v) if v.is_integer() else None
    return v if isinstance(v, int) else None


def transform_pe(features: list[dict], valid_cuts: set[str], names: dict[str, str] | None = None) -> PeResult:
    res = PeResult()
    seen: set[int] = set()
    by_year, by_uso, by_prec = Counter(), Counter(), Counter()
    comunas_by_year: dict[int, set[str]] = defaultdict(set)
    name_mismatch = Counter()
    glosas: set[str] = set()

    def rej(oid, code, detail, p):
        res.rejections.append(Rejection("ine_pe", oid, code, detail, {k: v for k, v in (p or {}).items()}))

    for f in features:
        p = f.get("properties") or {}
        oid = _int(p.get("OBJECTID"))
        if oid is None or oid in seen:
            rej(oid, "duplicate_key" if oid in seen else "value_invalid", "OBJECTID ausente o repetido", p)
            continue
        seen.add(oid)
        cut = cut_from_number(p.get("COD_COMUNA"))
        if cut is None:
            rej(oid, "cut_invalid", f"COD_COMUNA no es un entero de 4-5 dígitos: {p.get('COD_COMUNA')!r}", p); continue
        if cut not in valid_cuts:
            rej(oid, "cut_unknown", f"CUT {cut} (COD_COMUNA {p.get('COD_COMUNA')}) no existe en comunas", p); continue
        year = _int(p.get("AÑO"))
        if year is None or not (2000 <= year <= 2100):
            rej(oid, "year_invalid", f"AÑO fuera de rango: {p.get('AÑO')!r}", p); continue
        units = _int(p.get("CANTIDAD_UNIDAD"))
        if units is None or not (0 <= units <= SMALLINT_MAX):
            rej(oid, "value_invalid", f"CANTIDAD_UNIDAD inválida: {p.get('CANTIDAD_UNIDAD')!r}", p); continue
        floors = None
        if p.get("NUM_PISOS") is not None:
            floors = _int(p.get("NUM_PISOS"))
            if floors is None or not (0 <= floors <= SMALLINT_MAX):
                rej(oid, "value_invalid", f"NUM_PISOS inválido: {p.get('NUM_PISOS')!r}", p); continue
        uso_raw = (p.get("USO_DESTINO") or "").strip().upper()
        if uso_raw not in USO:
            rej(oid, "uso_unmapped", f"USO_DESTINO sin mapeo: {p.get('USO_DESTINO')!r}", p); continue
        prec_raw = p.get("PRECISION_")
        prec_raw = prec_raw.strip().upper() if isinstance(prec_raw, str) and prec_raw.strip() else None
        if prec_raw not in PRECISION:
            rej(oid, "value_invalid", f"PRECISION_ desconocida: {p.get('PRECISION_')!r}", p); continue
        glosa = p.get("GLOSA_DESTINO")
        if not isinstance(glosa, str) or not glosa.strip():
            rej(oid, "value_invalid", "GLOSA_DESTINO vacía", p); continue
        area = p.get("SUPERFICIE")
        if area is not None and (not finite(area) or area < 0):
            rej(oid, "value_invalid", f"SUPERFICIE inválida: {area!r}", p); continue
        ll = point_lonlat(f.get("geometry"))
        if ll is None:
            rej(oid, "geometry_missing", "el registro no trae un punto válido", p); continue
        if not in_chile_bbox(*ll):
            rej(oid, "coordinates_out_of_range", f"coordenadas fuera de Chile: {ll}", p); continue
        glosa = glosa.strip()
        res.rows.append((oid, cut, year, units, floors, USO[uso_raw], PRECISION[prec_raw], glosa, float(area) if area is not None else None, ll[0], ll[1]))
        by_year[year] += 1
        by_uso[uso_raw] += 1
        by_prec[PRECISION_LABEL[PRECISION[prec_raw]]] += 1
        comunas_by_year[year].add(cut)
        glosas.add(glosa)
        if names is not None and p.get("GLOSA_COMUNA") and norm(p["GLOSA_COMUNA"]) != norm(names.get(cut, "")):
            name_mismatch[(cut, p["GLOSA_COMUNA"], names.get(cut))] += 1

    units_by_year, units_by_year_uso = Counter(), defaultdict(Counter)
    prec_by_year = defaultdict(Counter)
    for r in res.rows:
        units_by_year[r[2]] += r[3]
        units_by_year_uso[r[2]][r[5]] += r[3]
        prec_by_year[r[2]][r[6]] += 1
    res.stats = {
        "accepted": len(res.rows), "rejected": len(res.rejections),
        "by_year": dict(sorted(by_year.items())), "units_by_year": dict(sorted(units_by_year.items())),
        "units_by_year_uso": {y: dict(c) for y, c in sorted(units_by_year_uso.items())},
        "by_uso": dict(by_uso), "by_precision": dict(by_prec),
        "precision_by_year": {y: {PRECISION_LABEL[k]: v for k, v in sorted(c.items())} for y, c in sorted(prec_by_year.items())},
        "comunas_by_year": {y: len(s) for y, s in sorted(comunas_by_year.items())},
        "comunas_distinct": len(set().union(*comunas_by_year.values())) if comunas_by_year else 0,
        "glosas_distinct": len(glosas),
        "name_mismatch": [{"cut": k[0], "capa": k[1], "comunas": k[2], "n": n} for k, n in name_mismatch.most_common(10)],
    }
    return res


@dataclass
class CrfResult:
    rows: list[tuple] = field(default_factory=list)          # (src_oid, cut, year, dwellings, geojson_text)
    rejections: list[Rejection] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def transform_crf(features: list[dict], valid_cuts: set[str], names: dict[str, str] | None = None) -> CrfResult:
    import json
    res = CrfResult()
    seen: set[int] = set()
    by_year, dw_by_year = Counter(), Counter()
    comunas_by_year: dict[int, set[str]] = defaultdict(set)
    cut_fixed = 0
    name_mismatch = Counter()

    def rej(oid, code, detail, p):
        res.rejections.append(Rejection("ine_crf", oid, code, detail, dict(p or {})))

    for f in features:
        p = f.get("properties") or {}
        oid = _int(p.get("OBJECTID"))
        if oid is None or oid in seen:
            rej(oid, "duplicate_key" if oid in seen else "value_invalid", "OBJECTID ausente o repetido", p); continue
        seen.add(oid)
        raw_cut = p.get("CUT")
        cut = cut_from_text(raw_cut)
        if cut is None:
            rej(oid, "cut_invalid", f"CUT no es texto de 4-5 dígitos: {raw_cut!r}", p); continue
        if cut not in valid_cuts:
            rej(oid, "cut_unknown", f"CUT {cut} (original {raw_cut!r}) no existe en comunas", p); continue
        if len(str(raw_cut).strip()) == 4:
            cut_fixed += 1
        year = _int(p.get("AÑO_EMISION"))
        if year is None or not (2000 <= year <= 2100):
            rej(oid, "year_invalid", f"AÑO_EMISION fuera de rango: {p.get('AÑO_EMISION')!r}", p); continue
        dw = _int(p.get("N_VIVIENDA"))
        if dw is None or dw < 0:
            rej(oid, "value_invalid", f"N_VIVIENDA inválida: {p.get('N_VIVIENDA')!r}", p); continue
        g = f.get("geometry")
        if not g or g.get("type") not in ("Polygon", "MultiPolygon") or not g.get("coordinates"):
            rej(oid, "geometry_missing", "el registro no trae un polígono", p); continue
        res.rows.append((oid, cut, year, dw, json.dumps(g, ensure_ascii=False, separators=(",", ":"))))
        by_year[year] += 1
        dw_by_year[year] += dw
        comunas_by_year[year].add(cut)
        if names is not None and p.get("NOM_COMUNA") and norm(p["NOM_COMUNA"]) != norm(names.get(cut, "")):
            name_mismatch[(cut, p["NOM_COMUNA"], names.get(cut))] += 1
    res.stats = {
        "accepted": len(res.rows), "rejected": len(res.rejections), "cut_zero_padded": cut_fixed,
        "by_year": dict(sorted(by_year.items())), "dwellings_by_year": dict(sorted(dw_by_year.items())),
        "comunas_by_year": {y: len(s) for y, s in sorted(comunas_by_year.items())},
        "comunas_distinct": len(set().union(*comunas_by_year.values())) if comunas_by_year else 0,
        "name_mismatch": [{"cut": k[0], "capa": k[1], "comunas": k[2], "n": n} for k, n in name_mismatch.most_common(10)],
    }
    return res
