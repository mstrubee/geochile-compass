"""Piezas compartidas por los ETL del INE y del SEIA."""
from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "public" / "codigos_territoriales.csv"
GEOJSON_PATH = ROOT / "public" / "comunas.geojson"
CHILE_LON = (-110.0, -50.0)       # incluye Rapa Nui y el territorio antártico chileno
CHILE_LAT = (-90.0, -17.0)


@dataclass
class Rejection:
    layer: str
    oid: int | None
    code: str                    # debe estar en geo_rejected_rows.reason_code
    detail: str
    raw: dict = field(default_factory=dict)


def read_comunas_csv(path: Path = CSV_PATH) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        return [{"cut": r["commune_id"], "name": r["commune_name"], "region_cut": r["region_id"]} for r in csv.DictReader(f)]


def cut_from_number(n) -> str | None:
    """COD_COMUNA llega como smallint (1401 -> '01401'). Devuelve None si no es un entero de 4 o 5 dígitos."""
    if n is None or isinstance(n, bool):
        return None
    if isinstance(n, float):
        if not n.is_integer():
            return None
        n = int(n)
    s = str(n).strip()
    if not s.isdigit() or not (4 <= len(s) <= 5):
        return None
    return s.zfill(5)


def cut_from_text(t) -> str | None:
    """CUT de la capa CRF: texto SIN el cero inicial en las regiones 1-9 ('1401'). Se normaliza a 5 dígitos."""
    if t is None:
        return None
    s = str(t).strip()
    return s.zfill(5) if s.isdigit() and 4 <= len(s) <= 5 else None


def finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def point_lonlat(geom) -> tuple[float, float] | None:
    if not geom or geom.get("type") != "Point":
        return None
    co = geom.get("coordinates") or []
    if len(co) < 2 or not (finite(co[0]) and finite(co[1])):
        return None
    return float(co[0]), float(co[1])


def in_chile_bbox(lon: float, lat: float) -> bool:
    return CHILE_LON[0] <= lon <= CHILE_LON[1] and CHILE_LAT[0] <= lat <= CHILE_LAT[1]


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)
