"""Normalización de los expedientes del SEIA. Nada se corrige en silencio: lo dudoso se CUENTA y queda en el reporte.

Lo comprobado por el usuario (2026-10-16) son los NOMBRES de los campos; el FORMATO de varios sigue abierto (DISENO Parte 4,
P7), así que este módulo es tolerante en la lectura y estricto en lo que guarda:

  * COMUNAS: nombre exacto normalizado (comunas + alias de la fuente), sin coincidencia aproximada. Si no calza todo el texto
    se parte por GUION (el separador real del servicio: «Pica-Pozo Almonte», comprobado con el sondeo del 2026-10-17; ninguna
    comuna oficial lleva guion) y por , ; / | " y " " e "; lo que no calce se guarda en `comunas_unresolved` y se informa.
  * Fechas: epoch en milisegundos (lo habitual en ArcGIS) o texto ISO. Un instante a medianoche UTC exacta es una fecha «sin
    hora» y se toma tal cual (convertirla a Santiago la corría un día atrás); cualquier otro instante se pasa a la fecha
    local de America/Santiago. Cuántas de cada una hubo queda en `warnings` (así P7 se responde con datos).
  * Coordenadas: solo se acepta el punto de la GEOMETRÍA del servicio (outSR=4326). X/Y/NUEVO_X/NUEVO_Y quedan en `raw` y
    NO se usan como respaldo: su CRS no está comprobado. Fuera de rango o no-punto → sin punto (se conserva el expediente).
  * Un `ID_EXPEDIENTE` ausente o repetido en la capa RECHAZA la fila (todas las copias del repetido); no se adivina cuál vale.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from permisos.norm import norm

SANTIAGO = ZoneInfo("America/Santiago")

# campos que se guardan TAL CUAL en una columna: no se repiten en `raw`
VERBATIM = ("ID_EXPEDIENTE", "NOMBRE_PROYECTO", "FORMA_PRESENTACION", "LETRA_TIPOLOGIA", "NOMBRE_TIPOLOGIA",
            "REGION", "COMUNAS", "TITULAR", "ESTADO_EVALUACION")
URL_FIELDS = ("URL_EXPEDIENTE", "URL", "ENLACE", "LINK")      # el servicio real trae URL_EXPEDIENTE (https://seia.sea.gob.cl/expediente/…)
# NO se guardan en `raw`: USUARIO es el nombre de usuario del FUNCIONARIO que editó el registro (dato personal que no se necesita).
# Sigue en el archivo original archivado en Storage (bucket privado).
NOT_IN_RAW = ("USUARIO",)
MAX_USD = Decimal("9999999999999999.99")          # numeric(18,2)
_SPLIT = re.compile(r"\s*(?:-|,|;|/|\||\s[ye]\s)\s*", re.IGNORECASE)


@dataclass
class Row:
    external_id: str
    objectid: Any
    name: str | None
    submission_form_declared: str | None
    typology_letter: str | None
    typology_name: str | None
    region_declared: str | None
    comunas_declared: str | None
    comuna_cuts: list[str]
    comunas_unresolved: list[str]
    titular: str | None
    status_declared: str | None
    submitted_at: date | None
    qualified_at: date | None
    investment_usd: Decimal | None
    expediente_url: str | None
    lon: float | None
    lat: float | None
    raw: dict


@dataclass
class Rejection:
    code: str                    # missing_id | duplicate_key | unreadable_feature
    detail: str
    objectid: Any
    raw: dict


@dataclass
class Parsed:
    rows: list[Row] = field(default_factory=list)
    rejections: list[Rejection] = field(default_factory=list)
    features_received: int = 0
    warnings: Counter = field(default_factory=Counter)
    comuna_rows: Counter = field(default_factory=Counter)        # all_resolved | partial | none_resolved | no_text
    unresolved_tokens: Counter = field(default_factory=Counter)


# --------------------------------------------------------------------------------------------------------------------
class Resolver:
    """COMUNAS -> CUT por nombre EXACTO normalizado. `comunas` sale de la base (o del CSV del repo); `aliases` son filas
    {name, cut} propias de la fuente SEIA (tabla comuna_name_aliases). Los nombres de comuna son únicos en el país."""

    def __init__(self, comunas: list[dict], aliases: list[dict] | None = None):
        self.by_name: dict[str, str] = {}
        for c in comunas:
            self.by_name[norm(c["name"])] = c["cut"]
        for a in aliases or []:
            self.by_name[norm(a["name"])] = a["cut"]

    def resolve(self, text: str | None) -> tuple[list[str], list[str]]:
        """-> (CUT en orden y sin repetir, fragmentos que no calzaron)."""
        if text is None or not str(text).strip():
            return [], []
        whole = self.by_name.get(norm(text))
        if whole:
            return [whole], []
        cuts: list[str] = []
        unresolved: list[str] = []
        for part in _SPLIT.split(str(text)):
            part = part.strip(" .")
            if not part:
                continue
            cut = self.by_name.get(norm(part))
            if cut is None:
                unresolved.append(part)
            elif cut not in cuts:
                cuts.append(cut)
        return cuts, unresolved


# --------------------------------------------------------------------------------------------------------------------
def _text(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


def to_date(v: Any, warnings: Counter, field_name: str) -> date | None:
    """epoch ms (o s) o texto ISO -> fecha; None si no hay valor; cuenta lo que no pudo leer."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        if isinstance(v, bool):
            raise ValueError
        if isinstance(v, (int, float)) or (isinstance(v, str) and re.fullmatch(r"-?\d+(\.\d+)?", v.strip())):
            ms = float(v)
            if not math.isfinite(ms):
                raise ValueError
            dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
            if dt.hour == dt.minute == dt.second == dt.microsecond == 0:
                warnings[f"date_utc_midnight:{field_name}"] += 1          # fecha «sin hora»: se toma la fecha UTC
                return dt.date()
            warnings[f"date_with_time:{field_name}"] += 1                  # instante con hora: fecha local de Santiago
            return dt.astimezone(SANTIAGO).date()
        return date.fromisoformat(str(v).strip()[:10])
    except (ValueError, OverflowError, OSError):
        warnings[f"bad_date:{field_name}"] += 1
        return None


def to_usd(v: Any, warnings: Counter) -> Decimal | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        d = Decimal(str(v).strip())
        if not d.is_finite():
            raise InvalidOperation
    except InvalidOperation:
        warnings["bad_investment"] += 1
        return None
    if d < 0:
        warnings["negative_investment"] += 1
        return None
    if d > MAX_USD:
        warnings["investment_out_of_range"] += 1
        return None
    return d.quantize(Decimal("0.01"))


def to_point(geom: Any, warnings: Counter) -> tuple[float | None, float | None]:
    if not geom:
        warnings["no_geometry"] += 1
        return None, None
    if not isinstance(geom, dict) or geom.get("type") != "Point":
        warnings["non_point_geometry"] += 1
        return None, None
    c = geom.get("coordinates")
    try:
        lon, lat = float(c[0]), float(c[1])
    except (TypeError, ValueError, IndexError):
        warnings["unreadable_coordinates"] += 1
        return None, None
    if not (math.isfinite(lon) and math.isfinite(lat)) or not (-180 <= lon <= 180 and -90 <= lat <= 90):
        warnings["coordinates_out_of_range"] += 1
        return None, None
    return lon, lat


def parse_feature(feat: Any, resolver: Resolver, parsed: Parsed) -> Row | None:
    """Una Feature GeoJSON -> Row; si no se puede, registra el rechazo y devuelve None."""
    props = feat.get("properties") if isinstance(feat, dict) else None
    if not isinstance(props, dict):
        parsed.rejections.append(Rejection("unreadable_feature", "la feature no trae 'properties'", None, {}))
        return None
    up = {str(k).upper(): v for k, v in props.items()}
    objectid = up.get("OBJECTID", feat.get("id"))
    ext = _text(up.get("ID_EXPEDIENTE"))
    if ext is None:
        parsed.rejections.append(Rejection("missing_id", "sin ID_EXPEDIENTE", objectid, props))
        return None

    comunas_text = _text(up.get("COMUNAS"))
    cuts, unresolved = resolver.resolve(comunas_text)

    url_field = next((f for f in URL_FIELDS if isinstance(up.get(f), str) and str(up[f]).strip().startswith("https://")), None)
    url = str(up[url_field]).strip() if url_field else None
    lon, lat = to_point(feat.get("geometry"), parsed.warnings)
    skip = set(VERBATIM) | set(NOT_IN_RAW) | ({url_field} if url_field else set())      # la URL que se usó ya está en su columna
    raw = {k: v for k, v in props.items() if str(k).upper() not in skip and v is not None and v != ""}
    return Row(
        external_id=ext, objectid=objectid, name=_text(up.get("NOMBRE_PROYECTO")),
        submission_form_declared=_text(up.get("FORMA_PRESENTACION")),
        typology_letter=_text(up.get("LETRA_TIPOLOGIA")), typology_name=_text(up.get("NOMBRE_TIPOLOGIA")),
        region_declared=_text(up.get("REGION")), comunas_declared=comunas_text,
        comuna_cuts=cuts, comunas_unresolved=unresolved, titular=_text(up.get("TITULAR")),
        status_declared=_text(up.get("ESTADO_EVALUACION")),
        submitted_at=to_date(up.get("FECHA_PRESENTACION"), parsed.warnings, "FECHA_PRESENTACION"),
        qualified_at=to_date(up.get("FECHA_CALIFICACION"), parsed.warnings, "FECHA_CALIFICACION"),
        investment_usd=to_usd(up.get("INVERSION_US"), parsed.warnings),
        expediente_url=url, lon=lon, lat=lat, raw=raw)


def parse_pages(pages: list[bytes], resolver: Resolver) -> Parsed:
    """Páginas CRUDAS (bytes) -> Parsed. Los repetidos se rechazan TODOS (no se adivina cuál es el bueno)."""
    parsed = Parsed()
    rows: list[Row] = []
    for raw_page in pages:
        for feat in json.loads(raw_page).get("features") or []:
            parsed.features_received += 1
            row = parse_feature(feat, resolver, parsed)
            if row is not None:
                rows.append(row)
    counts = Counter(r.external_id for r in rows)
    dup = {k for k, n in counts.items() if n > 1}
    for r in rows:
        if r.external_id in dup:
            parsed.rejections.append(Rejection("duplicate_key", f"ID_EXPEDIENTE {r.external_id} aparece {counts[r.external_id]} veces en la capa", r.objectid, r.raw))
        else:
            parsed.rows.append(r)
    # estadísticas de comunas SOLO sobre lo que efectivamente se carga (no sobre rechazados)
    for r in parsed.rows:
        if r.comunas_declared is None:
            parsed.comuna_rows["no_text"] += 1
        elif r.comuna_cuts and not r.comunas_unresolved:
            parsed.comuna_rows["all_resolved"] += 1
        elif r.comuna_cuts:
            parsed.comuna_rows["partial"] += 1
        else:
            parsed.comuna_rows["none_resolved"] += 1
        for tok in r.comunas_unresolved:
            parsed.unresolved_tokens[tok] += 1
    return parsed
