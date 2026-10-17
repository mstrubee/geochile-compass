#!/usr/bin/env python3
"""Sondeo de SOLO LECTURA de los servicios ArcGIS de la Parte 4 (INE permisos/CRF y SEIA).

No escribe en ninguna base: solo hace GET a los servicios y guarda lo recibido en una carpeta local
(etl/output/proyectos_probe/<fecha>/). Sirve para:
  * re-comprobar las fuentes ANTES de automatizar (campos reales, conteos, límites);
  * medir cobertura y calidad con datos reales (años, comunas, PRECISION_, tipologías);
  * obtener recortes REALES para los fixtures de tests;
  * encontrar la licencia/términos que publican el servicio y su ítem de ArcGIS.

Uso:  python etl/proyectos_probe.py [--out DIR] [--zip] [--pause 0.3]
Después envía la carpeta (o el .zip) para analizarla. Contiene datos públicos y ninguna credencial.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.dont_write_bytecode = True

# las variables de entorno existen solo para probar el script contra un servidor local (tests)
INE = os.environ.get("PROBE_INE_BASE", "https://services5.arcgis.com/hUyD8u3TeZLKPe4T/arcgis/rest/services/CRF_PE_v2/FeatureServer")
SEIA = os.environ.get("PROBE_SEIA_BASE", "https://arcgisv11.sea.gob.cl/server/rest/services/WEBServices/ProyectosSEIA/MapServer")
PORTAL = os.environ.get("PROBE_PORTAL_BASE", "https://www.arcgis.com/sharing/rest")
UA = "geochile-compass-probe/1 (solo lectura; contacto: equipo GeoChile)"

# capa -> (servicio, id, rol)
LAYERS = {
    "ine_pe": (INE, 1, "PE_NACIONAL: permisos georreferenciados (puntos)"),
    "ine_crf": (INE, 2, "CRF_NACIONAL: certificados de recepción final (polígonos)"),
    "ine_crf_indiv": (INE, 0, "CRF individuales 2017-2018"),
    "seia_eia": (SEIA, 1, "SEIA EIA"),
    "seia_dia": (SEIA, 2, "SEIA DIA"),
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).upper().strip()


class Client:
    def __init__(self, pause: float, timeout: int = 90, retries: int = 3):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.pause, self.timeout, self.retries = pause, timeout, retries
        self.log: list[dict] = []

    def get(self, url: str, params: dict | None = None, *, raw: bool = False):
        last = None
        for attempt in range(1, self.retries + 1):
            t0 = time.time()
            try:
                r = self.s.get(url, params=params, timeout=self.timeout)
                self.log.append({"url": r.url[:300], "status": r.status_code, "bytes": len(r.content),
                                 "secs": round(time.time() - t0, 2), "attempt": attempt})
                time.sleep(self.pause)
                if r.status_code != 200:
                    last = f"HTTP {r.status_code}"
                    continue
                if raw:
                    return r.content
                data = r.json()
                if isinstance(data, dict) and "error" in data:     # ArcGIS responde 200 con {"error": …}
                    last = f"arcgis error: {json.dumps(data['error'], ensure_ascii=False)[:300]}"
                    if data["error"].get("code") in (400, 403, 404, 499):
                        break
                    continue
                return data
            except Exception as e:                                  # red, JSON inválido…
                last = f"{type(e).__name__}: {e}"
                self.log.append({"url": url[:300], "error": last, "attempt": attempt})
                time.sleep(min(2 ** attempt, 10))
        raise RuntimeError(last or "sin respuesta")


def field_lookup(meta: dict) -> dict[str, str]:
    """nombre normalizado (sin tildes, mayúsculas) -> nombre real del campo."""
    return {norm(f["name"]): f["name"] for f in meta.get("fields", [])}


def stats(c: Client, layer_url: str, group: list[str], measures: list[tuple[str, str, str]], where: str = "1=1") -> list[dict]:
    """Estadísticas agrupadas, paginadas. measures = [(tipo, campo, alias)]."""
    out, offset = [], 0
    out_stats = json.dumps([{"statisticType": t, "onStatisticField": f, "outStatisticFieldName": a} for t, f, a in measures])
    while True:
        d = c.get(f"{layer_url}/query", {
            "where": where, "groupByFieldsForStatistics": ",".join(group), "outStatistics": out_stats,
            "orderByFields": ",".join(group), "resultOffset": offset, "resultRecordCount": 1000, "f": "json"})
        rows = [f["attributes"] for f in d.get("features", [])]
        out += rows
        if not d.get("exceededTransferLimit") or not rows:
            return out
        offset += len(rows)


def sample(c: Client, layer_url: str, where: str, n: int, order: str) -> dict:
    return c.get(f"{layer_url}/query", {"where": where, "outFields": "*", "outSR": 4326, "orderByFields": order,
                                         "resultRecordCount": n, "returnGeometry": "true", "f": "geojson"})


def guarded(result: dict, key: str, fn):
    """Corre fn(); si falla, guarda el motivo en vez de abortar todo el sondeo."""
    try:
        result[key] = fn()
    except Exception as e:
        result.setdefault("_errores", {})[key] = str(e)


def probe_layer(c: Client, name: str, base: str, lid: int, role: str, out: Path) -> dict:
    url = f"{base}/{lid}"
    res: dict = {"capa": name, "rol": role, "url": url, "consultado_utc": datetime.now(timezone.utc).isoformat()}
    guarded(res, "meta", lambda: c.get(url, {"f": "json"}))
    meta = res.get("meta", {})
    fl = field_lookup(meta)
    res["campos"] = [{"name": f["name"], "type": f.get("type"), "alias": f.get("alias"), "length": f.get("length"),
                      "domain": (f.get("domain") or {}).get("name")} for f in meta.get("fields", [])]
    res["limites"] = {k: meta.get(k) for k in ("maxRecordCount", "supportsPagination", "supportedQueryFormats",
                                                "geometryType", "editingInfo", "copyrightText", "description",
                                                "currentVersion", "hasZ", "hasM")}
    guarded(res, "extent", lambda: meta.get("extent"))
    guarded(res, "conteo_servidor", lambda: c.get(f"{url}/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"})["count"])
    guarded(res, "oid_min_max", lambda: [f["attributes"] for f in c.get(f"{url}/query", {
        "where": "1=1", "outStatistics": json.dumps([
            {"statisticType": "min", "onStatisticField": "OBJECTID", "outStatisticFieldName": "min_oid"},
            {"statisticType": "max", "onStatisticField": "OBJECTID", "outStatisticFieldName": "max_oid"}]), "f": "json"})["features"]][0])
    # paginación: dos páginas contiguas ordenadas por OBJECTID, para comprobar que no se pisan
    def pages():
        a = sample(c, url, "1=1", 5, "OBJECTID")
        b = c.get(f"{url}/query", {"where": "1=1", "outFields": "OBJECTID", "orderByFields": "OBJECTID", "resultOffset": 5,
                                   "resultRecordCount": 5, "returnGeometry": "false", "f": "json"})
        ids_a = [f["properties"].get("OBJECTID") for f in a.get("features", [])]
        ids_b = [f["attributes"].get("OBJECTID") for f in b.get("features", [])]
        return {"pagina1": ids_a, "pagina2": ids_b, "sin_solape": not set(ids_a) & set(ids_b)}
    guarded(res, "paginacion", pages)
    guarded(res, "_muestra_generica", lambda: _save(out, f"sample_{name}.geojson", sample(c, url, "1=1", 200, "OBJECTID")))
    return res


def _save(out: Path, fname: str, obj) -> str:
    (out / fname).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    return fname


def probe_ine_pe(c: Client, res: dict, out: Path) -> None:
    url, fl = res["url"], field_lookup(res.get("meta", {}))
    need = {k: fl.get(k) for k in ("ANO", "COD_COMUNA", "PRECISION_", "USO_DESTINO", "CANTIDAD_UNIDAD", "SUPERFICIE", "GLOSA_DESTINO", "NUM_PISOS")}
    res["campos_esperados"] = need
    y, cm, pr, uso, uni, sup = (need[k] for k in ("ANO", "COD_COMUNA", "PRECISION_", "USO_DESTINO", "CANTIDAD_UNIDAD", "SUPERFICIE"))
    if not y:
        res.setdefault("_errores", {})["campos"] = "no encuentro el campo AÑO"; return
    m = [("count", "OBJECTID", "n")] + ([("sum", uni, "unidades")] if uni else []) + ([("sum", sup, "superficie")] if sup else [])
    guarded(res, "por_anio", lambda: stats(c, url, [y], m))
    if pr:
        guarded(res, "por_anio_precision", lambda: stats(c, url, [y, pr], [("count", "OBJECTID", "n")]))
    if uso:
        guarded(res, "por_anio_uso", lambda: stats(c, url, [y, uso], [("count", "OBJECTID", "n")] + ([("sum", uni, "unidades")] if uni else [])))
    if cm:
        guarded(res, "por_anio_comuna", lambda: stats(c, url, [y, cm], m))
    if need["GLOSA_DESTINO"]:
        guarded(res, "glosas_destino", lambda: stats(c, url, [need["GLOSA_DESTINO"], uso] if uso else [need["GLOSA_DESTINO"]], [("count", "OBJECTID", "n")]))
    # recortes reales para fixtures: años distintos (antes/después de la caída), y precisiones débiles
    for yr in (2012, 2019, 2021, 2024):
        guarded(res, f"_muestra_{yr}", lambda yr=yr: _save(out, f"sample_ine_pe_{yr}.geojson", sample(c, url, f"{y}={yr}", 100, "OBJECTID")))
    if pr:
        guarded(res, "_muestra_precision_baja", lambda: _save(out, "sample_ine_pe_precision_baja.geojson", sample(c, url, f"{pr}='BAJA'", 50, "OBJECTID")))
        guarded(res, "_muestra_precision_nula", lambda: _save(out, "sample_ine_pe_precision_nula.geojson", sample(c, url, f"{pr} IS NULL", 50, "OBJECTID")))
    # bordes: puntos sin geometría
    guarded(res, "sin_geometria_muestra", lambda: c.get(f"{url}/query", {"where": "1=1", "returnGeometry": "false", "outFields": "OBJECTID",
                                                                             "returnIdsOnly": "true", "resultRecordCount": 1, "f": "json"}).get("objectIds", [])[:1])


def probe_ine_crf(c: Client, res: dict, out: Path) -> None:
    url, fl = res["url"], field_lookup(res.get("meta", {}))
    y, viv, cut = fl.get("ANO_EMISION"), fl.get("N_VIVIENDA"), fl.get("CUT")
    res["campos_esperados"] = {"ANO_EMISION": y, "N_VIVIENDA": viv, "CUT": cut}
    if not y:
        res.setdefault("_errores", {})["campos"] = "no encuentro AÑO_EMISION"; return
    m = [("count", "OBJECTID", "n")] + ([("sum", viv, "viviendas")] if viv else [])
    guarded(res, "por_anio", lambda: stats(c, url, [y], m))
    if cut:
        guarded(res, "por_anio_cut", lambda: stats(c, url, [y, cut], m))
    guarded(res, "_muestra_2015", lambda: _save(out, "sample_ine_crf_2015.geojson", sample(c, url, f"{y}=2015", 60, "OBJECTID")))
    guarded(res, "_muestra_2024", lambda: _save(out, "sample_ine_crf_2024.geojson", sample(c, url, f"{y}=2024", 60, "OBJECTID")))
    # tamaño de las geometrías (vértices) para decidir simplificación
    def vertices():
        g = sample(c, url, "1=1", 200, "OBJECTID")
        def count(geom):
            if not geom: return 0
            t, co = geom["type"], geom["coordinates"]
            if t == "Polygon": return sum(len(r) for r in co)
            if t == "MultiPolygon": return sum(len(r) for p in co for r in p)
            return 0
        v = sorted(count(f.get("geometry")) for f in g.get("features", []))
        return {"n": len(v), "min": v[0] if v else None, "mediana": v[len(v) // 2] if v else None, "max": v[-1] if v else None}
    guarded(res, "vertices_muestra", vertices)


def probe_ine_crf_indiv(c: Client, res: dict, out: Path) -> None:
    fl = field_lookup(res.get("meta", {}))
    y = next((v for k, v in fl.items() if k in ("ANO", "ANO_EMISION", "AÑO")), None)
    if y:
        guarded(res, "por_anio", lambda: stats(c, res["url"], [y], [("count", "OBJECTID", "n")]))


def probe_seia(c: Client, res: dict, out: Path) -> None:
    url, fl = res["url"], field_lookup(res.get("meta", {}))
    names = {k: fl.get(k) for k in ("LETRA_TIPOLOGIA", "NOMBRE_TIPOLOGIA", "REGION", "COMUNAS", "ESTADO_EVALUACION", "INVERSION_US",
                                     "FECHA_PRESENTACION", "FECHA_CALIFICACION", "FORMA_PRESENTACION", "ID_EXPEDIENTE")}
    res["campos_esperados"] = names
    lt, nt = names["LETRA_TIPOLOGIA"], names["NOMBRE_TIPOLOGIA"]
    g = [f for f in (lt, nt) if f]
    if g:
        guarded(res, "tipologias", lambda: stats(c, url, g, [("count", "OBJECTID", "n")]))
    if names["ESTADO_EVALUACION"]:
        guarded(res, "estados", lambda: stats(c, url, [names["ESTADO_EVALUACION"]], [("count", "OBJECTID", "n")]))
    if names["COMUNAS"]:
        guarded(res, "valores_comunas_multiples", lambda: [f["attributes"] for f in c.get(f"{url}/query", {
            "where": f"{names['COMUNAS']} LIKE '%,%'", "outFields": names["COMUNAS"], "returnGeometry": "false",
            "resultRecordCount": 15, "f": "json"})["features"]])
    if nt:
        guarded(res, "_muestra_inmobiliarios", lambda: _save(out, f"sample_{res['capa']}_inmobiliarios.geojson",
                                                              sample(c, url, f"UPPER({nt}) LIKE '%INMOBILIARI%'", 100, "OBJECTID")))


def probe_license(c: Client, out: Path) -> dict:
    """Busca términos/licencia: ítem de ArcGIS Online del servicio del INE (y metadatos del servicio)."""
    res: dict = {}
    guarded(res, "ine_servicio", lambda: c.get(INE, {"f": "json"}))
    item = (res.get("ine_servicio") or {}).get("serviceItemId")
    if item:
        guarded(res, "ine_item", lambda: c.get(f"{PORTAL}/content/items/{item}", {"f": "json"}))
        guarded(res, "ine_item_metadata_xml", lambda: _save(out, "ine_item_metadata.xml", c.get(
            f"{PORTAL}/content/items/{item}/info/metadata/metadata.xml", raw=True).decode("utf-8", "replace")))
        it = res.get("ine_item") or {}
        res["ine_item_resumen"] = {k: it.get(k) for k in ("title", "owner", "orgId", "snippet", "licenseInfo", "accessInformation",
                                                           "access", "tags", "modified", "url", "documentation")}
    guarded(res, "sea_servicio", lambda: c.get(SEIA, {"f": "json"}))
    res["sea_resumen"] = {k: (res.get("sea_servicio") or {}).get(k) for k in ("copyrightText", "serviceDescription", "description", "currentVersion")}
    return res


def render_summary(r: dict) -> str:
    L = [f"# Sondeo Parte 4 — {r['inicio_utc']}", "", f"Capas sondeadas: {', '.join(r['capas'])}", ""]
    for name, lay in r["capas"].items():
        L += [f"## {name} — {lay['rol']}", f"URL: {lay['url']}", f"Conteo del servidor: **{lay.get('conteo_servidor')}**",
              f"Límites: {json.dumps(lay.get('limites'), ensure_ascii=False)}",
              f"Campos: {', '.join(f['name'] + ':' + str(f['type']) for f in lay.get('campos', []))}",
              f"OBJECTID min/max: {lay.get('oid_min_max')} · paginación sin solape: {(lay.get('paginacion') or {}).get('sin_solape')}"]
        if lay.get("_errores"):
            L.append(f"**Errores:** {json.dumps(lay['_errores'], ensure_ascii=False)}")
        py = lay.get("por_anio")
        if py:
            ks = list(py[0].keys())
            L += ["", "| " + " | ".join(ks) + " |", "|" + "---|" * len(ks)] + ["| " + " | ".join(str(x.get(k)) for k in ks) + " |" for x in py]
        pc = lay.get("por_anio_comuna")
        if pc:
            ycol = next(k for k in pc[0] if norm(k) in ("ANO", "AÑO"))
            ccol = next(k for k in pc[0] if norm(k) == "COD_COMUNA")
            by: dict = {}
            for x in pc:
                by.setdefault(x[ycol], set()).add(x[ccol])
            L += ["", "Comunas distintas con registros por año: " + ", ".join(f"{a}: {len(s)}" for a, s in sorted(by.items()))]
            ys = sorted(by)
            early = set().union(*[by[a] for a in ys if a <= 2019]) if any(a <= 2019 for a in ys) else set()
            late = set().union(*[by[a] for a in ys if a >= 2020]) if any(a >= 2020 for a in ys) else set()
            L.append(f"Comunas con datos en ≤2019 pero NINGUNO en ≥2020: {len(early - late)} · solo en ≥2020: {len(late - early)}")
        L.append("")
    L += ["## Licencia / términos", "```json", json.dumps(r.get("licencia", {}).get("ine_item_resumen"), ensure_ascii=False, indent=1),
          json.dumps(r.get("licencia", {}).get("sea_resumen"), ensure_ascii=False, indent=1), "```"]
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None, help="carpeta de salida (por defecto etl/output/proyectos_probe/<fecha>)")
    ap.add_argument("--zip", action="store_true", help="además deja un .zip para enviar")
    ap.add_argument("--pause", type=float, default=0.3, help="segundos entre consultas (cortesía con el servidor)")
    ap.add_argument("--only", nargs="*", choices=list(LAYERS), help="sondear solo estas capas")
    a = ap.parse_args(argv)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) if a.out else Path(__file__).resolve().parent / "output" / "proyectos_probe" / stamp
    out.mkdir(parents=True, exist_ok=True)
    c = Client(a.pause)
    report: dict = {"inicio_utc": stamp, "capas": {}}
    for name, (base, lid, role) in LAYERS.items():
        if a.only and name not in a.only:
            continue
        print(f"→ {name}: {base}/{lid}", flush=True)
        lay = probe_layer(c, name, base, lid, role, out)
        {"ine_pe": probe_ine_pe, "ine_crf": probe_ine_crf, "ine_crf_indiv": probe_ine_crf_indiv,
         "seia_eia": probe_seia, "seia_dia": probe_seia}[name](c, lay, out)
        report["capas"][name] = lay
        print(f"   conteo={lay.get('conteo_servidor')}  errores={list((lay.get('_errores') or {}).keys())}", flush=True)
    report["licencia"] = probe_license(c, out)
    report["peticiones"] = c.log
    (out / "probe.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "resumen.md").write_text(render_summary(report), encoding="utf-8")
    print(f"\nListo. Carpeta: {out}")
    if a.zip:
        zp = out.with_suffix(".zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(out.iterdir()):
                z.write(f, f.name)
        print(f"Zip: {zp}")
    n_err = sum(len(l.get("_errores", {})) for l in report["capas"].values())
    print(f"Errores parciales: {n_err} (ver resumen.md)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
