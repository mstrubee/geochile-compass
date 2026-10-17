"""Cliente de SOLO LECTURA del servicio ArcGIS REST del SEA (ProyectosSEIA/MapServer).

Comprobado por el usuario el 2026-10-16 desde otro entorno (esta sesión no alcanza el host): capa 1 = EIA, capa 2 = DIA,
formatos JSON/geoJSON/PBF, `maxRecordCount` 2000 con `resultOffset`/`resultRecordCount`. Lo que NO está comprobado
(DISENO Parte 4, P7: CRS de X/Y, formato de COMUNAS y de las fechas) se maneja defensivamente en normalize.py.

Paginación: `orderByFields=OBJECTID` y `resultOffset += len(features)` (no += page_size: el servidor puede devolver menos
de lo pedido). Termina con una página VACÍA, no al alcanzar el conteo: si el servicio tiene más filas que su conteo
(cambió mientras se paginaba) se ve en el cuadre en vez de quedar oculto.
"""
from __future__ import annotations

import json
import os
import time

import requests

DEFAULT_BASE = "https://arcgisv11.sea.gob.cl/server/rest/services/WEBServices/ProyectosSEIA/MapServer"
# capa del servicio -> (id de capa, source_key de data_sources)
LAYERS = {"eia": (1, "seia_proyectos_eia"), "dia": (2, "seia_proyectos_dia")}
UA = "geochile-compass-seia/1 (solo lectura; contacto: equipo GeoChile)"
PAGE_SIZE = 2000


class ArcGisError(RuntimeError):
    pass


class Client:
    def __init__(self, base: str | None = None, pause: float = 0.3, timeout: int = 90, retries: int = 3,
                 page_size: int = PAGE_SIZE):
        self.base = (base or os.environ.get("SEIA_BASE") or DEFAULT_BASE).rstrip("/")
        self.pause, self.timeout, self.retries, self.page_size = pause, timeout, retries, page_size
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.requests_made = 0

    def layer_url(self, layer: str) -> str:
        return f"{self.base}/{LAYERS[layer][0]}"

    def _get(self, url: str, params: dict) -> bytes:
        last = None
        for attempt in range(1, self.retries + 1):
            try:
                r = self.s.get(url, params=params, timeout=self.timeout)
                self.requests_made += 1
                time.sleep(self.pause)
                if r.status_code != 200:
                    last = f"HTTP {r.status_code}"
                    continue
                try:
                    data = r.json()
                except ValueError:
                    last = "la respuesta no es JSON"
                    continue
                if isinstance(data, dict) and "error" in data:      # ArcGIS responde 200 con {"error": …}
                    err = data["error"] if isinstance(data["error"], dict) else {}
                    last = f"arcgis error: {json.dumps(data['error'], ensure_ascii=False)[:300]}"
                    if err.get("code") in (400, 403, 404, 499):
                        break
                    continue
                return r.content
            except requests.RequestException as e:
                last = f"{type(e).__name__}: {e}"
            time.sleep(min(2 ** attempt, 8))
        raise ArcGisError(f"{url}: {last}")

    def count(self, layer: str) -> int:
        body = json.loads(self._get(f"{self.layer_url(layer)}/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"}))
        n = body.get("count")
        if not isinstance(n, int) or n < 0:
            raise ArcGisError(f"{layer}: el servicio no informó un conteo válido ({body!r:.200})")
        return n

    def metadata(self, layer: str) -> dict:
        """Metadatos de la capa (puede traer editingInfo.lastEditDate). Un fallo aquí no detiene la carga."""
        try:
            return json.loads(self._get(self.layer_url(layer), {"f": "json"}))
        except (ArcGisError, ValueError):
            return {}

    def fetch_pages(self, layer: str, expected_count: int) -> list[bytes]:
        """Respuestas CRUDAS (bytes) de cada página, en orden."""
        pages: list[bytes] = []
        offset = 0
        while True:
            raw = self._get(f"{self.layer_url(layer)}/query", {
                "where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": "4326",
                "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": self.page_size, "f": "geojson"})
            feats = json.loads(raw).get("features")
            if feats is None:
                raise ArcGisError(f"{layer}: la página en offset {offset} no trae 'features'")
            if not feats:
                return pages
            pages.append(raw)
            offset += len(feats)
            if offset > expected_count + 5 * self.page_size:
                raise ArcGisError(f"{layer}: paginación sin fin (offset {offset} para un conteo de {expected_count}); "
                                  "¿el servicio ignora resultOffset?")
