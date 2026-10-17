"""Transformación y validación de los proyectos del SEIA (ProyectosSEIA, capas 1 = EIA y 2 = DIA).

Hallazgos reales del sondeo (docs/proyectos-parte4/HALLAZGOS_SONDEO.md) que esta transformación respeta:
  * ID_EXPEDIENTE es double y llega a 2.147.998.999: se convierte a entero SIN pérdida (si no es entero, se rechaza);
  * la geometría del servicio coincide con NUEVO_X/NUEVO_Y; X/Y crudos vienen redondeados: se guardan aparte;
  * COMUNAS es el NOMBRE: se cruza a CUT por nombre normalizado + alias explícitos, sin coincidencia aproximada;
    si no cruza, el proyecto se CARGA igual con comuna_cuts vacío (geo_status = comuna_unmatched), no se descarta;
  * las fechas son epoch a medianoche UTC; se convierten en UTC;
  * el MISMO código de tipología tiene nombres distintos según el reglamento: se filtra por LETRA (tabla de reglas editable).
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from .arcgis import epoch_ms_to_date_utc
from .common import Rejection, finite, in_chile_bbox, point_lonlat
from permisos.norm import norm  # noqa: E402

_SPLIT = re.compile(r"\s*(?:;|/|\||,|\sy\s|\se\s)\s*", re.IGNORECASE)


@dataclass
class SeiaResult:
    rows: list[tuple] = field(default_factory=list)
    rejections: list[Rejection] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


class ComunaResolver:
    """Nombre -> CUT por nombre normalizado único o alias explícito. Sin coincidencia aproximada."""

    def __init__(self, comunas: list[dict], aliases: list[dict] | None = None):
        self.by_name: dict[str, list[str]] = {}
        for c in comunas:
            self.by_name.setdefault(norm(c["name"]), []).append(c["cut"])
        self.alias = {norm(a["name"]): a["cut"] for a in (aliases or [])}

    def one(self, name: str) -> str | None:
        n = norm(name)
        if n in self.alias:
            return self.alias[n]
        cuts = self.by_name.get(n)
        return cuts[0] if cuts and len(cuts) == 1 else None

    def many(self, declared: str | None) -> tuple[list[str], list[str]]:
        """Devuelve (cuts, nombres_sin_cruzar). Primero el texto completo; si no cruza, se separa por ; / , ' y '."""
        if not declared or not declared.strip():
            return [], []
        whole = self.one(declared)
        if whole:
            return [whole], []
        parts = [p for p in _SPLIT.split(declared) if p.strip()]
        if len(parts) <= 1:
            return [], [declared.strip()]
        cuts, unknown = [], []
        for p in parts:
            c = self.one(p)
            (cuts if c else unknown).append(c or p.strip())
        # si UNA parte no cruza, no se adivina: el proyecto queda comuna_unmatched completo
        return ([], unknown) if unknown else (sorted(set(cuts)), [])


def _bigint(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, float):
        return int(v) if v.is_integer() else None
    return v if isinstance(v, int) else None


def transform_seia(features: list[dict], layer: int, rules: dict[str, dict], resolver: ComunaResolver) -> SeiaResult:
    form_expected = {1: "EIA", 2: "DIA"}[layer]
    res = SeiaResult()
    seen_exp: set[int] = set()
    excluded_by_letter = Counter()
    included_names = Counter()
    unknown_included_names = Counter()
    status = Counter()
    unmatched = Counter()
    geom_vs_new_mismatch = 0
    new_null = 0
    new_null_geom_is_raw = 0
    raw_whole_degrees = 0
    no_geom = 0
    multi = 0

    def rej(oid, code, detail, p):
        res.rejections.append(Rejection(f"seia_{layer}", oid, code, detail, dict(p or {})))

    for f in features:
        p = f.get("properties") or {}
        oid = _bigint(p.get("OBJECTID"))
        letter = (p.get("LETRA_TIPOLOGIA") or "").strip()
        rule = rules.get(letter)
        if not rule or not rule.get("include"):
            excluded_by_letter[letter or "(sin letra)"] += 1
            continue
        exp = _bigint(p.get("ID_EXPEDIENTE"))
        if oid is None or exp is None:
            rej(oid, "value_invalid", f"OBJECTID o ID_EXPEDIENTE inválido: {p.get('OBJECTID')!r} / {p.get('ID_EXPEDIENTE')!r}", p); continue
        if exp in seen_exp:
            rej(oid, "duplicate_key", f"ID_EXPEDIENTE {exp} repetido", p); continue
        seen_exp.add(exp)
        name = (p.get("NOMBRE_PROYECTO") or "").strip()
        st = (p.get("ESTADO_EVALUACION") or "").strip()
        form = (p.get("FORMA_PRESENTACION") or "").strip().upper()
        if not name or not st:
            rej(oid, "value_invalid", "falta NOMBRE_PROYECTO o ESTADO_EVALUACION", p); continue
        if form != form_expected:
            rej(oid, "value_invalid", f"FORMA_PRESENTACION {p.get('FORMA_PRESENTACION')!r} no coincide con la capa ({form_expected})", p); continue
        inv = p.get("INVERSION_US")
        if inv is not None and (not finite(inv) or inv < 0):
            rej(oid, "value_invalid", f"INVERSION_US inválida: {inv!r}", p); continue
        ll = point_lonlat(f.get("geometry"))
        if ll is not None and not in_chile_bbox(*ll):
            rej(oid, "coordinates_out_of_range", f"coordenadas fuera de Chile: {ll}", p); continue
        if ll is None:
            no_geom += 1
        else:
            nx, ny = p.get("NUEVO_X"), p.get("NUEVO_Y")
            if finite(nx) and finite(ny):
                if abs(nx - ll[0]) > 1e-5 or abs(ny - ll[1]) > 1e-5:
                    geom_vs_new_mismatch += 1
            else:
                new_null += 1
                if finite(p.get("X")) and finite(p.get("Y")) and abs(p["X"] - ll[0]) < 1e-5 and abs(p["Y"] - ll[1]) < 1e-5:
                    new_null_geom_is_raw += 1
        x, y = p.get("X"), p.get("Y")
        if finite(x) and finite(y) and float(x).is_integer() and float(y).is_integer():
            raw_whole_degrees += 1
        cuts, unknown = resolver.many(p.get("COMUNAS"))
        for u in unknown:
            unmatched[u] += 1
        if len(cuts) > 1:
            multi += 1
        tname = (p.get("NOMBRE_TIPOLOGIA") or "").strip()
        included_names[(letter, tname)] += 1
        status[st] += 1
        res.rows.append((layer, exp, oid, name, form, letter, tname, p.get("REGION"), p.get("COMUNAS"), cuts,
                         (p.get("TITULAR") or None), st,
                         epoch_ms_to_date_utc(p.get("FECHA_PRESENTACION")), epoch_ms_to_date_utc(p.get("FECHA_CALIFICACION")),
                         float(inv) if inv is not None else None, p.get("URL_EXPEDIENTE"),
                         float(x) if finite(x) else None, float(y) if finite(y) else None,
                         _bigint(p.get("MODIFICADO")), ll[0] if ll else None, ll[1] if ll else None))
    excluded_total = sum(excluded_by_letter.values())
    res.stats = {
        "layer": layer, "form": form_expected, "accepted": len(res.rows), "rejected": len(res.rejections),
        "typology_excluded_count": excluded_total,
        "typology_excluded_by_letter": dict(excluded_by_letter.most_common()),
        "included_typology_names": [{"letter": k[0], "name": k[1][:90], "n": n} for k, n in included_names.most_common()],
        "status": dict(status.most_common()),
        "comuna_unmatched_names": dict(unmatched.most_common(25)), "comuna_unmatched_projects": sum(1 for r in res.rows if not r[9]),
        "projects_with_several_comunas": multi, "without_geometry": no_geom,
        "geometry_differs_from_NUEVO_XY": geom_vs_new_mismatch,
        "NUEVO_XY_null": new_null, "geometry_is_raw_XY_when_NUEVO_null": new_null_geom_is_raw,
        "raw_XY_whole_degrees": raw_whole_degrees,
    }
    return res
