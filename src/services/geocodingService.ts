/**
 * Geocoding híbrido: base de datos interna → caché local → Google Geocoding → Nominatim (OSM).
 * Las respuestas externas se almacenan en caché en memoria para evitar llamadas redundantes.
 */

import {
  normalizeAddress,
  buildGeocodeQuery,
  buildGeocodeQueryFallbacks,
  addressTokens,
  tokenJaccard,
} from "@/utils/addressNormalize";
import { geocodeWithGoogle } from "@/services/googleMapsService";

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
  importance: number;
  /** Confianza heurística 0..1. */
  confidence: number;
  /** Fuente utilizada para el resultado. */
  source?: "cache" | "google" | "nominatim";
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

const fetchNominatim = async (
  q: string,
  signal?: AbortSignal,
): Promise<NominatimResponse[]> => {
  await ensureRateLimit();
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=cl&addressdetails=0&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return [];
    return (await res.json()) as NominatimResponse[];
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return [];
  }
};

const scoreResult = (
  r: NominatimResponse,
  expectedComuna: string | null,
  addrTokens: Set<string>,
): number => {
  const display = r.display_name.toLowerCase();
  const baseImp = typeof r.importance === "number" ? r.importance : 0.3;
  let score = baseImp;
  if (expectedComuna) {
    const comunaNorm = expectedComuna
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim();
    if (comunaNorm && display.includes(comunaNorm)) score += 0.4;
  }
  const respTokens = addressTokens(r.display_name);
  score += 0.3 * tokenJaccard(addrTokens, respTokens);
  if (r.class === "place" || r.class === "building") score += 0.15;
  else if (r.class === "highway") score += 0.05;
  return score;
};

/**
 * Geocodifica una dirección. Orden de fuentes:
 * 1. Caché local en memoria.
 * 2. Google Geocoding API (si hay API key y provider="google").
 * 3. Nominatim (OSM) con queries progresivamente más laxas.
 */
export const geocodeAddress = async (
  address: string,
  comuna: string | null,
  signal?: AbortSignal,
  options?: { preferGoogle?: boolean },
): Promise<GeocodeResult | null> => {
  const cacheKey = `${normalizeAddress(address)}|${(comuna ?? "").toLowerCase().trim()}`;
  if (memoryCache.has(cacheKey)) {
    const cached = memoryCache.get(cacheKey);
    if (cached) return { ...cached, source: "cache" };
    return null;
  }

  // 2. Google Geocoding (cuando el proveedor activo es Google o se solicita explícitamente)
  // `import.meta.env` solo existe bajo Vite; en Node (sincronización automática
  // desde Drive) es undefined, así que se accede de forma opcional para no
  // romper. Sin key, este paso se salta y queda Nominatim.
  const googleKey = (import.meta as { env?: Record<string, string> }).env?.VITE_GOOGLE_MAPS_KEY;
  if (googleKey && options?.preferGoogle) {
    const fullAddress = comuna ? `${address}, ${comuna}, Chile` : `${address}, Chile`;
    const googleResult = await geocodeWithGoogle(fullAddress, googleKey);
    if (googleResult) {
      const out: GeocodeResult = {
        lat: googleResult.lat,
        lng: googleResult.lng,
        displayName: googleResult.displayName,
        importance: googleResult.confidence,
        confidence: googleResult.confidence,
        source: "google",
      };
      memoryCache.set(cacheKey, out);
      return out;
    }
  }

  // 3. Nominatim (OSM) con fallbacks
  const queries = buildGeocodeQueryFallbacks(address, comuna);
  if (queries.length === 0) queries.push(buildGeocodeQuery(address, comuna));

  const addrTokens = addressTokens(address);

  for (const q of queries) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const results = await fetchNominatim(q, signal);
    if (!results.length) continue;

    let best: NominatimResponse | null = null;
    let bestScore = -Infinity;
    for (const r of results) {
      const s = scoreResult(r, comuna, addrTokens);
      if (s > bestScore) { bestScore = s; best = r; }
    }
    if (!best) continue;
    const lat = parseFloat(best.lat);
    const lng = parseFloat(best.lon);
    if (!isFinite(lat) || !isFinite(lng)) continue;

    const out: GeocodeResult = {
      lat,
      lng,
      displayName: best.display_name,
      importance: typeof best.importance === "number" ? best.importance : 0.3,
      confidence: Math.min(1, Math.max(0, bestScore)),
      source: "nominatim",
    };
    memoryCache.set(cacheKey, out);
    return out;
  }

  memoryCache.set(cacheKey, null);
  return null;
};

/** Limpieza del cache, útil para tests y para forzar re-geocoding. */
export const clearGeocodeCache = () => memoryCache.clear();
