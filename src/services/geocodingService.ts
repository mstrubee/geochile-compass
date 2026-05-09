/**
 * Geocoding via OpenStreetMap Nominatim.
 *
 * IMPORTANT — Política de uso de Nominatim:
 *  - Máximo 1 req/seg (lo respetamos con queue interna).
 *  - Identificarse con un User-Agent o Referer (no se puede setear
 *    desde el navegador, se hace mejor desde una Edge Function).
 *  - Para lotes grandes considerar self-hosted o pago.
 *
 * Para la app actual, llamamos directo desde el cliente (usar admin).
 * Mantenemos un cache en memoria para no re-pegar la misma dirección
 * dentro de una misma sesión.
 */

import { normalizeAddress, buildGeocodeQuery } from "@/utils/addressNormalize";

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
  importance: number;
  /** Confianza heurística 0..1 según `importance` y `class`. */
  confidence: number;
}

const memoryCache = new Map<string, GeocodeResult | null>();

/** Throttle a 1 req/seg como pide la política de uso. */
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ensureRateLimit = async () => {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - elapsed);
  lastRequestAt = Date.now();
};

interface NominatimResponse {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
  class?: string;
  type?: string;
}

/**
 * Geocodifica una dirección. Devuelve `null` si no encuentra resultado.
 * El cache es por (address+comuna) normalizados.
 */
export const geocodeAddress = async (
  address: string,
  comuna: string | null,
  signal?: AbortSignal,
): Promise<GeocodeResult | null> => {
  const cacheKey = `${normalizeAddress(address)}|${(comuna ?? "").toLowerCase().trim()}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey) ?? null;

  await ensureRateLimit();
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");

  const q = buildGeocodeQuery(address, comuna);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=cl&addressdetails=0&q=${encodeURIComponent(q)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    memoryCache.set(cacheKey, null);
    return null;
  }
  if (!res.ok) {
    memoryCache.set(cacheKey, null);
    return null;
  }
  const arr = (await res.json()) as NominatimResponse[];
  if (!arr.length) {
    memoryCache.set(cacheKey, null);
    return null;
  }
  const r = arr[0];
  const lat = parseFloat(r.lat);
  const lng = parseFloat(r.lon);
  if (!isFinite(lat) || !isFinite(lng)) {
    memoryCache.set(cacheKey, null);
    return null;
  }
  // Heurística simple de confianza: punto de tipo "house"/"building" > "road" > resto.
  const baseImp = typeof r.importance === "number" ? r.importance : 0.3;
  const typeBoost =
    r.class === "place" || r.class === "building"
      ? 0.2
      : r.class === "highway"
        ? 0.05
        : 0;
  const out: GeocodeResult = {
    lat,
    lng,
    displayName: r.display_name,
    importance: baseImp,
    confidence: Math.min(1, baseImp + typeBoost),
  };
  memoryCache.set(cacheKey, out);
  return out;
};

/** Limpieza del cache, útil para tests y para forzar re-geocoding. */
export const clearGeocodeCache = () => memoryCache.clear();
