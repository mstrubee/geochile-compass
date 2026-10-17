"""Orquestación de los ETL de la Parte 4: descarga → transformación → reporte → (carga). Compartida por proyectos_ine.py y proyectos_seia.py."""
from __future__ import annotations

import getpass
import json
import os
import socket
import sys
from datetime import date, datetime, timezone

from permisos import seed as seedmod  # noqa: E402

from . import arcgis, db as dbmod, geocheck, ine, minvu_ref, report, seia
from .common import GEOJSON_PATH, read_comunas_csv, load_json, ROOT

INE_BASE = "https://services5.arcgis.com/hUyD8u3TeZLKPe4T/arcgis/rest/services/CRF_PE_v2/FeatureServer"
SEIA_BASE = "https://arcgisv11.sea.gob.cl/server/rest/services/WEBServices/ProyectosSEIA/MapServer"
ALIASES_SEIA = ROOT / "etl" / "proyectos" / "aliases_seia.json"
RULES_SEIA = ROOT / "etl" / "proyectos" / "seia_typology_rules.json"

EXPECTED = {
    "pe": {"OBJECTID", "COD_COMUNA", "AÑO", "CANTIDAD_UNIDAD", "NUM_PISOS", "GLOSA_DESTINO", "USO_DESTINO", "SUPERFICIE", "PRECISION_"},
    "crf": {"OBJECTID", "CUT", "AÑO_EMISION", "N_VIVIENDA"},
    "seia": {"OBJECTID", "ID_EXPEDIENTE", "NOMBRE_PROYECTO", "FORMA_PRESENTACION", "LETRA_TIPOLOGIA", "NOMBRE_TIPOLOGIA", "REGION", "COMUNAS",
             "ESTADO_EVALUACION", "FECHA_PRESENTACION", "FECHA_CALIFICACION", "INVERSION_US", "X", "Y", "NUEVO_X", "NUEVO_Y", "MODIFICADO",
             "TITULAR", "URL_EXPEDIENTE"},
}
SOURCE_KEYS = {"pe": "ine_pe_nacional", "crf": "ine_crf_nacional", 1: "seia_proyectos_eia", 2: "seia_proyectos_dia"}
DEFAULT_MAX_REJECT = 0.005
EXIT_OK, EXIT_STRUCTURE, EXIT_COUNTS, EXIT_DB, EXIT_REJECTED = 0, 2, 3, 4, 5


def _captured_by(args) -> str:
    return args.captured_by or f"etl:{getpass.getuser()}@{socket.gethostname()}"


def _reference(args):
    """(conn, comunas, aliases_db, settings, rules). Sin --db ni carga, lee los archivos del repo."""
    use_db = (not args.dry_run) or args.db
    if not use_db:
        return None, read_comunas_csv(), None, {}, None
    conn = dbmod.connect()
    if args.dry_run:
        conn.execute("set transaction read only")
    comunas, aliases, settings, rules = dbmod.load_reference(conn)
    return conn, comunas, aliases, settings, rules


def _base_summary(url: str, dl: arcgis.Download, normalized: bytes, gz: bytes, sha: str, expected: set[str]) -> dict:
    fields = {f["name"] for f in dl.meta.get("fields", [])}
    ei = (dl.meta.get("editingInfo") or {}).get("lastEditDate")
    return {
        "layer_url": url, "started_utc": dl.started_utc, "finished_utc": dl.finished_utc,
        "count_before": dl.count_before, "count_after": dl.count_after, "downloaded": len(dl.features), "consistent": dl.consistent,
        "pages": dl.pages, "requests": dl.requests, "sha256": sha, "normalized_bytes": len(normalized), "gz_bytes": len(gz),
        "declared_date": arcgis.epoch_ms_to_date_utc(ei) if ei else None,
        "declared_date_note": "editingInfo.lastEditDate de la capa" if ei else "el servicio no declara editingInfo",
        "missing_fields": sorted(expected - fields), "errors": [],
    }


def _rej_block(rejections) -> dict:
    from collections import Counter
    return {"total": len(rejections), "by_reason": dict(Counter(r.code for r in rejections)),
            "first": [{"oid": r.oid, "code": r.code, "detail": r.detail} for r in rejections[:10]]}


def _verdict(s: dict, rejected: int, max_reject: float) -> int:
    s["errors"] = []
    if s["missing_fields"]:
        s["errors"].append("la capa no trae los campos esperados")
    if not s["consistent"]:
        s["errors"].append("el conteo del servidor cambió durante la descarga o no coincide con lo descargado")
    if s["count_before"] == 0:
        s["errors"].append("la capa viene vacía")
    if rejected / max(s["count_before"], 1) > max_reject:
        s["errors"].append(f"rechazos sobre el máximo ({100 * max_reject:.1f} %)")
    s["ready"] = not s["errors"]
    if s["missing_fields"] or s["count_before"] == 0:
        return EXIT_STRUCTURE
    if not s["consistent"]:
        return EXIT_COUNTS
    if rejected / max(s["count_before"], 1) > max_reject:
        return EXIT_REJECTED
    return EXIT_OK


def _emit(s: dict, text: str, as_json: bool) -> None:
    print(json.dumps(s, ensure_ascii=False, indent=2, default=str) if as_json else text)


def _declared(s: dict):
    return (date.fromisoformat(s["declared_date"]) if s["declared_date"] else None, s["declared_date_note"])


def _progress(label: str):
    def p(done, total):
        if done % 20000 < 2000 or done >= total:
            print(f"  … {label}: {done:,}/{total:,}".replace(",", "."), file=sys.stderr, flush=True)
    return p


# ---------------------------------------------------------------------------------------------- INE
def run_ine(args) -> int:
    layers = ["pe", "crf"] if args.layer == "all" else [args.layer]
    conn = None
    worst = EXIT_OK
    try:
        conn, comunas, _aliases, settings, _rules = _reference(args)
        valid = {c["cut"] for c in comunas}
        names = {c["cut"]: c["name"] for c in comunas}
        max_reject = settings.get("publish.max_reject_ratio", DEFAULT_MAX_REJECT)
        near_m = settings.get("ine_points.near_border_m", 500.0)
        client = arcgis.Client(pause=args.pause)
        polys = None
        for layer in layers:
            url = f"{args.base_url or INE_BASE}/{1 if layer == 'pe' else 2}"
            print(f"\n→ {url}", file=sys.stderr, flush=True)
            dl = arcgis.fetch_all(client, url, page_size=args.page_size, progress=_progress(layer.upper()))
            normalized = arcgis.normalized_geojson_bytes(dl.features)
            gz, sha = arcgis.gzip_deterministic(normalized), arcgis.sha256_hex(normalized)
            s = _base_summary(url, dl, normalized, gz, sha, EXPECTED[layer])
            s["near_border_m"] = near_m
            res = ine.transform_pe(dl.features, valid, names) if layer == "pe" else ine.transform_crf(dl.features, valid, names)
            s["stats"], s["rejections"] = res.stats, _rej_block(res.rejections)
            if layer == "pe":
                if not args.no_geocheck:
                    try:
                        polys = polys or geocheck.load_comuna_polygons()
                        s["geocheck"] = geocheck.check_points([(r[1], r[9], r[10]) for r in res.rows], polys, near_m)
                    except ImportError:
                        s["geocheck_skipped"] = "falta shapely (pip install -r etl/requirements.txt)"
                else:
                    s["geocheck_skipped"] = "--no-geocheck"
                try:
                    if args.minvu_file:
                        ref = minvu_ref.from_xlsx(args.minvu_file, comunas)
                    elif conn is not None:
                        ref = minvu_ref.from_db(conn)
                    else:
                        ref = None
                    if ref:
                        s["minvu_compare"] = minvu_ref.compare(res.rows, ref)
                    else:
                        s["minvu_compare_skipped"] = "sin --minvu-file ni --db (o MINVU aún no está cargado en la base)"
                except Exception as e:                 # el cuadre externo es DIAGNÓSTICO: nunca detiene la carga
                    s["minvu_compare_skipped"] = f"no se pudo calcular: {type(e).__name__}: {e}"
            else:
                try:
                    from shapely.geometry import shape
                    inval, verts, ex = 0, [], []
                    for oid, _cut, _y, _d, gj in res.rows:
                        g = shape(json.loads(gj))
                        verts.append(sum(len(p.exterior.coords) for p in (g.geoms if g.geom_type == "MultiPolygon" else [g])))
                        if not g.is_valid:
                            inval += 1
                            if len(ex) < 5:
                                from shapely.validation import explain_validity
                                ex.append({"oid": oid, "reason": explain_validity(g)})
                    verts.sort()
                    s["geometry_quality"] = {"checked": len(res.rows), "invalid": inval, "vertices_median": verts[len(verts) // 2] if verts else 0,
                                             "vertices_max": verts[-1] if verts else 0, "examples": ex}
                except ImportError:
                    s["geometry_quality_skipped"] = "falta shapely (pip install -r etl/requirements.txt)"
            code = _verdict(s, len(res.rejections), max_reject)
            _emit(s, (report.render_pe if layer == "pe" else report.render_crf)(s, args.dry_run, max_reject), args.json)
            worst = max(worst, code)
            if code != EXIT_OK or args.dry_run:
                continue
            years = sorted(res.stats["by_year"])
            result = dbmod.run_load(
                conn=conn, kind="ine_pe" if layer == "pe" else "ine_crf", source_key=SOURCE_KEYS[layer], layer_url=url, sha=sha, gz=gz,
                count_before=dl.count_before, count_after=dl.count_after, rows=res.rows, rejections=res.rejections, declared=_declared(s),
                period=(date(years[0], 1, 1), date(years[-1], 12, 31)), granularity="year",
                report={"stats": res.stats, "rejections": s["rejections"], "editing_info": dl.meta.get("editingInfo"),
                        "geocheck": s.get("geocheck"), "minvu_compare": s.get("minvu_compare")},
                layout={"layer_url": url, "fields": [f["name"] for f in dl.meta.get("fields", [])], "page_size": args.page_size, "pages": dl.pages},
                captured_by=_captured_by(args), use_storage=not args.no_storage, publish=not args.stage_only)
            print("\nRESULTADO: " + json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return worst
    except arcgis.ArcGisError as e:
        print(f"\nERROR DE LA FUENTE: {e}\nNo se cargó nada.", file=sys.stderr)
        return EXIT_COUNTS
    except SystemExit:
        raise
    except Exception as e:
        print(f"\nERROR ({type(e).__name__}): {e}\nNo quedó nada vigente: la publicación es todo-o-nada.", file=sys.stderr)
        return EXIT_DB
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------------------------- SEIA
def run_seia(args) -> int:
    layers = [1, 2] if args.layer == "all" else [int(args.layer)]
    conn = None
    worst = EXIT_OK
    try:
        conn, comunas, aliases_db, settings, rules_db = _reference(args)
        aliases = load_json(ALIASES_SEIA)
        if aliases_db:
            aliases = aliases + [{"name": a["name"], "cut": a["cut"]} for a in aliases_db]
        rules = rules_db or {k: v for k, v in load_json(RULES_SEIA).items() if not k.startswith("_")}
        resolver = seia.ComunaResolver(comunas, aliases)
        max_reject = settings.get("publish.max_reject_ratio", DEFAULT_MAX_REJECT)
        near_m = settings.get("projects.near_border_m", 500.0)
        client = arcgis.Client(pause=args.pause)
        polys = None
        for layer in layers:
            url = f"{args.base_url or SEIA_BASE}/{layer}"
            print(f"\n→ {url}", file=sys.stderr, flush=True)
            dl = arcgis.fetch_all(client, url, page_size=args.page_size, progress=_progress(f"SEIA {layer}"))
            normalized = arcgis.normalized_geojson_bytes(dl.features)
            gz, sha = arcgis.gzip_deterministic(normalized), arcgis.sha256_hex(normalized)
            s = _base_summary(url, dl, normalized, gz, sha, EXPECTED["seia"])
            res = seia.transform_seia(dl.features, layer, rules, resolver)
            s["stats"], s["rejections"] = res.stats, _rej_block(res.rejections)
            s["near_border_m"] = near_m
            if not args.no_geocheck:
                try:
                    polys = polys or geocheck.load_comuna_polygons()
                    pts = [(r[9][0], r[19], r[20]) for r in res.rows if r[9] and r[19] is not None]
                    s["geocheck"] = geocheck.check_points(pts, polys, near_m)
                except ImportError:
                    s["geocheck_skipped"] = "falta shapely (pip install -r etl/requirements.txt)"
            else:
                s["geocheck_skipped"] = "--no-geocheck"
            code = _verdict(s, len(res.rejections), max_reject)
            _emit(s, report.render_seia(s, args.dry_run, max_reject), args.json)
            worst = max(worst, code)
            if code != EXIT_OK or args.dry_run:
                continue
            today = datetime.now(timezone.utc).date()
            if aliases:
                dbmod.upsert_aliases(conn, [SOURCE_KEYS[layer]], load_json(ALIASES_SEIA))
                conn.commit()
            result = dbmod.run_load(
                conn=conn, kind="seia", source_key=SOURCE_KEYS[layer], layer_url=url, sha=sha, gz=gz,
                count_before=dl.count_before, count_after=dl.count_after, rows=res.rows, rejections=res.rejections, declared=_declared(s),
                period=(today, today), granularity="snapshot",
                report={"stats": res.stats, "rejections": s["rejections"], "typology_excluded_count": res.stats["typology_excluded_count"],
                        "geocheck": s.get("geocheck")},
                layout={"layer_url": url, "fields": [f["name"] for f in dl.meta.get("fields", [])], "page_size": args.page_size, "pages": dl.pages,
                        "typology_rule": "por LETRA_TIPOLOGIA (public.seia_typology_rules)"},
                captured_by=_captured_by(args), use_storage=not args.no_storage, publish=not args.stage_only)
            print("\nRESULTADO: " + json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return worst
    except arcgis.ArcGisError as e:
        print(f"\nERROR DE LA FUENTE: {e}\nNo se cargó nada.", file=sys.stderr)
        return EXIT_COUNTS
    except SystemExit:
        raise
    except Exception as e:
        print(f"\nERROR ({type(e).__name__}): {e}\nNo quedó nada vigente: la publicación es todo-o-nada.", file=sys.stderr)
        return EXIT_DB
    finally:
        if conn is not None:
            conn.close()
