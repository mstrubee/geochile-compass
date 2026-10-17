"""Reporte de una captura del SEIA: conteos, cuadre con el servicio, rechazos, calidad de comunas y de campos.

`summarize` no escribe nada; el ensayo (--dry-run) imprime esto y termina.
"""
from __future__ import annotations

from collections import Counter

from .normalize import Parsed

DEFAULT_MAX_REJECT_RATIO = 0.005       # espejo de pipeline_settings 'publish.max_reject_ratio' (la base manda al publicar)


def summarize(parsed: Parsed, *, layer: str, source_key: str, origin_url: str, service_count: int,
              service_count_after: int | None, content_sha: str, pages: int, declared: tuple[str | None, str],
              max_reject_ratio: float = DEFAULT_MAX_REJECT_RATIO, from_archive: bool = False) -> dict:
    loaded, rejected = len(parsed.rows), len(parsed.rejections)
    cuadre_errors: list[str] = []          # el contenido NO es la foto completa del servicio -> código de salida 3
    after = service_count if service_count_after is None else service_count_after
    if after != service_count:
        cuadre_errors.append(f"el servicio cambió mientras se paginaba (conteo {service_count} → {after}); repetir la captura")
    if parsed.features_received != service_count:
        cuadre_errors.append(f"se recibieron {parsed.features_received} expedientes y el servicio informa {service_count}: paginación incompleta")
    if loaded + rejected != service_count and parsed.features_received == service_count:
        cuadre_errors.append(f"cargables {loaded} + rechazados {rejected} <> {service_count} que informa el servicio")
    other_errors: list[str] = []           # cuadra, pero no es publicable -> código de salida 5
    ratio = rejected / service_count if service_count else 0.0
    if ratio > max_reject_ratio:
        other_errors.append(f"tasa de rechazo {ratio:.4f} sobre el umbral {max_reject_ratio}")
    if loaded == 0:
        other_errors.append("no hay expedientes cargables")
    errors = cuadre_errors + other_errors

    typ = Counter((r.typology_letter, r.typology_name) for r in parsed.rows)
    years = [r.submitted_at.year for r in parsed.rows if r.submitted_at]
    return {
        "layer": layer, "source_key": source_key, "origin_url": origin_url, "from_archive": from_archive,
        "content_sha256": content_sha, "pages": pages,
        "declared_date": declared[0], "declared_date_note": declared[1],
        "cuadre": {"service_count": service_count, "service_count_after": after, "features_received": parsed.features_received,
                   "loaded": loaded, "rejected": rejected, "reject_ratio": round(ratio, 6),
                   "ok": not cuadre_errors},
        "rejections": dict(Counter(r.code for r in parsed.rejections)),
        "rejection_samples": [{"code": r.code, "objectid": r.objectid, "detail": r.detail} for r in parsed.rejections[:10]],
        "with_point": sum(1 for r in parsed.rows if r.lon is not None),
        "without_point": sum(1 for r in parsed.rows if r.lon is None),
        "comunas": {"rows": dict(parsed.comuna_rows), "top_unresolved": parsed.unresolved_tokens.most_common(20)},
        "warnings": dict(sorted(parsed.warnings.items())),
        "typologies": [{"letter": k[0], "name": k[1], "n": n} for k, n in sorted(typ.items(), key=lambda kv: (-kv[1], str(kv[0])))[:30]],
        "statuses": Counter(r.status_declared for r in parsed.rows).most_common(15),
        "years": {"min": min(years) if years else None, "max": max(years) if years else None},
        "with_investment": sum(1 for r in parsed.rows if r.investment_usd is not None),
        "ready": not errors, "errors": errors, "cuadre_errors": cuadre_errors,
    }


def render_text(s: dict, dry_run: bool) -> str:
    c = s["cuadre"]
    out = [f"=== SEIA · capa {s['layer'].upper()} ({s['source_key']}) ===",
           f"origen: {s['origin_url']}" + ("   [reproducido desde un archivo local]" if s["from_archive"] else ""),
           f"SHA-256 del contenido: {s['content_sha256']}  ·  {s['pages']} páginas",
           f"fecha declarada por el servicio: {s['declared_date'] or 'no declarada'} ({s['declared_date_note']})", "",
           "CUADRE CON EL SERVICIO",
           f"  conteo del servicio: {c['service_count']} (al terminar: {c['service_count_after']})",
           f"  recibidos: {c['features_received']}   cargables: {c['loaded']}   rechazados: {c['rejected']} (tasa {c['reject_ratio']})",
           f"  ⇒ {'OK' if c['ok'] else 'NO CUADRA'}"]
    if s["rejections"]:
        out += ["", "RECHAZOS: " + ", ".join(f"{k}={v}" for k, v in s["rejections"].items())]
        out += [f"  - {x['code']} objectid={x['objectid']}: {x['detail']}" for x in s["rejection_samples"]]
    cr = s["comunas"]["rows"]
    out += ["", "UBICACIÓN Y COMUNAS",
            f"  con punto: {s['with_point']}   sin punto: {s['without_point']}",
            "  COMUNAS → CUT: " + (", ".join(f"{k}={v}" for k, v in sorted(cr.items())) or "—")]
    if s["comunas"]["top_unresolved"]:
        out.append("  textos de comuna SIN resolver (agregar alias en comuna_name_aliases si son variantes de una comuna real):")
        out += [f"    {n:>5} × {t!r}" for t, n in s["comunas"]["top_unresolved"]]
    if s["warnings"]:
        out += ["", "AVISOS (formatos que el ETL tuvo que interpretar o no pudo leer):"] + [f"  {k}: {v}" for k, v in s["warnings"].items()]
    out += ["", f"TIPOLOGÍAS (top {len(s['typologies'])}): letra · nombre · n"]
    out += [f"  {t['letter']!s:<6} {t['name']!s:<60.60} {t['n']}" for t in s["typologies"]]
    out += ["", "ESTADOS DECLARADOS: " + "; ".join(f"{k}={v}" for k, v in s["statuses"]),
            f"AÑOS de presentación: {s['years']['min']}–{s['years']['max']}   con inversión declarada: {s['with_investment']}"]
    out += ["", ("ENSAYO: no se escribió nada (ni base, ni Storage)." if dry_run else "LISTO PARA CARGAR.") if s["ready"]
            else "NO SE CARGA: " + " | ".join(s["errors"])]
    return "\n".join(out)
