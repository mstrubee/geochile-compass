"""Validación geográfica del ENSAYO (sin base de datos): punto dentro de la comuna que declara su registro.

Es un diagnóstico APROXIMADO para el --dry-run (shapely + public/comunas.geojson). La validación AUTORITATIVA es la de la
base (publish_*_snapshot, con geography y los umbrales de pipeline_settings). Aquí `near_border` usa una conversión
plana de grados a metros, y se rotula así en el reporte. Nunca se mueve ni corrige un punto.
"""
from __future__ import annotations

import math
from collections import Counter

from .common import GEOJSON_PATH, load_json


def load_comuna_polygons(path=GEOJSON_PATH):
    from shapely.geometry import shape
    from shapely import make_valid
    polys = {}
    for ft in load_json(path)["features"]:
        cut = str(ft["properties"].get("codigo_comuna") or ft["properties"].get("cod_comuna"))
        g = shape(ft["geometry"])
        polys[cut] = g if g.is_valid else make_valid(g)
    return polys


def check_points(points, polys, near_m: float = 500.0) -> dict:
    """points: iterable de (cut, lon, lat). Devuelve conteos por estado."""
    import numpy as np
    import shapely
    by_cut: dict[str, list] = {}
    for cut, lon, lat in points:
        by_cut.setdefault(cut, []).append((lon, lat))
    out = Counter()
    far_examples = []
    for cut, pts in by_cut.items():
        g = polys.get(cut)
        if g is None:
            out["comuna_without_polygon"] += len(pts)
            continue
        xs = np.array([p[0] for p in pts]); ys = np.array([p[1] for p in pts])
        inside = shapely.contains_xy(g, xs, ys)
        out["inside"] += int(inside.sum())
        for x, y in zip(xs[~inside], ys[~inside]):
            d_deg = g.distance(shapely.Point(float(x), float(y)))
            d_m = d_deg * 111_320.0 * max(math.cos(math.radians(float(y))), 0.2)
            if d_m <= near_m:
                out["near_border_approx"] += 1
            else:
                out["outside_declared"] += 1
                if len(far_examples) < 5:
                    far_examples.append({"cut": cut, "lon": float(x), "lat": float(y), "dist_m_aprox": round(d_m)})
    out["examples_outside"] = far_examples
    return dict(out)
