"""Cliente mínimo, de SOLO LECTURA, para servicios ArcGIS REST (FeatureServer / MapServer).

Garantías que el resto del ETL da por hechas:
  * pagina con `resultOffset` + `orderByFields=OBJECTID` hasta que una página viene vacía (no se confía en
    `supportsPagination`: el sondeo real lo trae `null` y la paginación igual funciona);
  * un OBJECTID repetido entre páginas (la capa cambió mientras se descargaba) es un ERROR, no se deduplica;
  * el conteo del servidor se mide ANTES y DESPUÉS de la descarga; si cambia, o no coincide con lo descargado,
    la carga falla (la base lo vuelve a exigir en publish_*_snapshot);
  * la salida se normaliza (orden por OBJECTID, JSON canónico) para que el hash del GeoJSON sea reproducible.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import requests

UA = "geochile-compass-etl/1 (solo lectura)"


class ArcGisError(RuntimeError):
    pass


class Client:
    def __init__(self, pause: float = 0.2, timeout: int = 120, retries: int = 4, session: requests.Session | None = None):
        self.s = session or requests.Session()
        self.s.headers["User-Agent"] = UA
        self.pause, self.timeout, self.retries = pause, timeout, retries
        self.requests = 0

    def get_json(self, url: str, params: dict) -> dict:
        last = "sin respuesta"
        for attempt in range(1, self.retries + 1):
            try:
                self.requests += 1
                r = self.s.get(url, params=params, timeout=self.timeout)
                if r.status_code != 200:
                    last = f"HTTP {r.status_code}"
                else:
                    data = r.json()
                    if isinstance(data, dict) and "error" in data:
                        last = f"error de ArcGIS: {json.dumps(data['error'], ensure_ascii=False)[:300]}"
                        if data["error"].get("code") in (400, 403, 404):
                            raise ArcGisError(f"{url}: {last}")
                    else:
                        time.sleep(self.pause)
                        return data
            except ArcGisError:
                raise
            except Exception as e:                       # red, JSON inválido…
                last = f"{type(e).__name__}: {e}"
            time.sleep(min(2 ** attempt * 0.5, 15))
        raise ArcGisError(f"{url}: {last} (tras {self.retries} intentos)")


def layer_meta(c: Client, layer_url: str) -> dict:
    return c.get_json(layer_url, {"f": "json"})


def server_count(c: Client, layer_url: str, where: str = "1=1") -> int:
    d = c.get_json(f"{layer_url}/query", {"where": where, "returnCountOnly": "true", "f": "json"})
    if "count" not in d:
        raise ArcGisError(f"{layer_url}: la respuesta de conteo no trae 'count'")
    return int(d["count"])


@dataclass
class Download:
    features: list[dict]
    count_before: int
    count_after: int
    pages: int
    requests: int
    meta: dict
    started_utc: str
    finished_utc: str
    notes: list[str] = field(default_factory=list)

    @property
    def consistent(self) -> bool:
        return self.count_before == self.count_after == len(self.features)


def fetch_all(c: Client, layer_url: str, *, page_size: int = 2000, out_fields: str = "*", where: str = "1=1",
              progress=None) -> Download:
    """Descarga TODA la capa (GeoJSON, outSR=4326). No lanza si los conteos no cuadran: lo informa en `consistent`."""
    started = datetime.now(timezone.utc).isoformat()
    meta = layer_meta(c, layer_url)
    before = server_count(c, layer_url, where)
    feats: list[dict] = []
    seen: set[int] = set()
    offset, pages = 0, 0
    max_pages = before // max(page_size // 20, 1) + 50           # tope de seguridad contra bucles
    while True:
        d = c.get_json(f"{layer_url}/query", {
            "where": where, "outFields": out_fields, "outSR": 4326, "returnGeometry": "true",
            "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": page_size, "f": "geojson"})
        page = d.get("features") or []
        pages += 1
        if not page:
            break
        for f in page:
            oid = (f.get("properties") or {}).get("OBJECTID", f.get("id"))
            if oid is None:
                raise ArcGisError(f"{layer_url}: un registro no trae OBJECTID (página {pages})")
            if oid in seen:
                raise ArcGisError(f"{layer_url}: OBJECTID {oid} repetido entre páginas: la capa cambió durante la descarga; reintente")
            seen.add(oid)
        feats.extend(page)
        offset += len(page)
        if progress:
            progress(len(feats), before)
        if pages > max_pages:
            raise ArcGisError(f"{layer_url}: demasiadas páginas ({pages}); abortado")
    after = server_count(c, layer_url, where)
    return Download(feats, before, after, pages, c.requests, meta, started, datetime.now(timezone.utc).isoformat())


# ---------------------------------------------------------------------------- normalización y hash
def normalized_geojson_bytes(features: list[dict]) -> bytes:
    """GeoJSON canónico: ordenado por OBJECTID, claves ordenadas, sin espacios. Es lo que se hashea y se guarda."""
    def oid(f):
        return (f.get("properties") or {}).get("OBJECTID", f.get("id"))
    ordered = sorted(features, key=oid)
    doc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": f.get("properties"), "geometry": f.get("geometry")} for f in ordered]}
    return json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def gzip_deterministic(b: bytes) -> bytes:
    return gzip.compress(b, compresslevel=9, mtime=0)


def epoch_ms_to_date_utc(ms) -> str | None:
    """ArcGIS entrega fechas como epoch en ms (en el SEA: medianoche UTC). Se convierte en UTC, sin corrimiento."""
    if ms is None:
        return None
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).date().isoformat()
