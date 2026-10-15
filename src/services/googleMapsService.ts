/**
 * Google Maps Platform — session tokens, geocoding, places.
 * Toda la comunicación con las APIs de Google pasa por este módulo, y TODA llamada pide antes
 * permiso a la cuota del servidor (apiQuotaService): si el límite gratuito mensual se agotó y
 * un admin no autorizó más, la llamada no sale y el caller cae a OpenStreetMap.
 */
import { consumeApiQuota } from "@/services/apiQuotaService";

const TILES_BASE = "https://tile.googleapis.com/v1";
const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";
// Places API (New) — reemplaza la API legacy deprecada en marzo 2025.
// Soporta CORS nativo desde el browser, sin proxy.
const PLACES_NEW_BASE = "https://places.googleapis.com/v1/places";

export type GoogleMapType = "roadmap" | "satellite" | "hybrid";

// ── Tile session management ───────────────────────────────────────────────────

interface TileSession {
  session: string;
  expiry: number; // Unix ms
  mapType: GoogleMapType;
}

const sessionCache = new Map<GoogleMapType, TileSession>();

// Las sesiones de Google duran ~2 semanas: se guardan en el navegador para que abrir o recargar
// el mapa las reutilice SIN crear otra sesión ni gastar cuota. Van atadas a la API key (si se
// cambia la key, no se reutilizan).
const SESSION_STORE_KEY = "geoplanet_google_tile_sessions_v1";
const SESSION_MARGIN_MS = 5 * 60_000;
const keyTag = (apiKey: string) => apiKey.slice(-8);

type StoredSessions = Partial<Record<GoogleMapType, TileSession & { key: string }>>;

const readStored = (): StoredSessions => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORE_KEY) ?? "{}") as StoredSessions;
  } catch {
    return {};
  }
};

const writeStored = (apiKey: string, session: TileSession) => {
  try {
    const all = readStored();
    all[session.mapType] = { ...session, key: keyTag(apiKey) };
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(all));
  } catch { /* storage lleno o bloqueado: solo se pierde el ahorro */ }
};

const isFresh = (s: TileSession | undefined): s is TileSession =>
  !!s && s.expiry > Date.now() + SESSION_MARGIN_MS;

/** Maps basemap style to Google map type. */
export const basemapToGoogleMapType = (basemap: string): GoogleMapType => {
  if (basemap === "satellite") return "satellite";
  if (basemap === "hybrid") return "hybrid";
  return "roadmap";
};

/**
 * Devuelve la sesión de teselas del tipo de mapa: de la memoria, o del navegador si sigue
 * vigente (sin gastar cuota), o creando una nueva en Google.
 * La cuota "maps_js" se mide en CARGAS DE MAPA y se descuenta SOLO cuando hay que crear una
 * sesión nueva en Google; reutilizar una guardada es gratis.
 */
export const createGoogleTileSession = async (
  apiKey: string,
  mapType: GoogleMapType,
): Promise<TileSession | null> => {
  const cached = sessionCache.get(mapType);
  if (isFresh(cached)) return cached;
  const stored = readStored()[mapType];
  if (stored && stored.key === keyTag(apiKey) && isFresh(stored)) {
    const { key: _k, ...session } = stored;
    sessionCache.set(mapType, session);
    return session;
  }
  if (!(await consumeApiQuota("maps_js"))) return null;

  const body: Record<string, unknown> = {
    mapType: mapType === "hybrid" ? "satellite" : mapType,
    language: "es",
    region: "CL",
    scale: "scaleFactor1x",
    highDpi: false,
  };
  if (mapType === "hybrid") body.layerTypes = ["layerRoadmap"];

  try {
    const res = await fetch(`${TILES_BASE}/createSession?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("[Google Maps] createSession failed:", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { session: string; expiry: string };
    const session: TileSession = {
      session: data.session,
      expiry: new Date(data.expiry).getTime(),
      mapType,
    };
    sessionCache.set(mapType, session);
    writeStored(apiKey, session);
    return session;
  } catch (e) {
    console.warn("[Google Maps] createSession error:", e);
    return null;
  }
};

/** Builds the tile URL template for Leaflet. */
export const buildGoogleTileUrl = (session: string, apiKey: string): string =>
  `${TILES_BASE}/2dtiles/{z}/{x}/{y}?session=${session}&key=${apiKey}`;

// ── Geocoding API ─────────────────────────────────────────────────────────────

export interface GoogleGeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
  confidence: number;
}

const geocodeCache = new Map<string, GoogleGeocodeResult | null>();

export const geocodeWithGoogle = async (
  address: string,
  apiKey: string,
): Promise<GoogleGeocodeResult | null> => {
  const key = address.toLowerCase().trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  if (!(await consumeApiQuota("geocoding"))) return null;

  try {
    const url = `${GEOCODE_BASE}?address=${encodeURIComponent(address)}&key=${apiKey}&region=cl&language=es&components=country:CL`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number }; location_type: string };
      }>;
    };

    if (data.status !== "OK" || !data.results.length) {
      geocodeCache.set(key, null);
      return null;
    }
    const r = data.results[0];
    const result: GoogleGeocodeResult = {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      displayName: r.formatted_address,
      confidence: r.geometry.location_type === "ROOFTOP" ? 0.95 : 0.7,
    };
    geocodeCache.set(key, result);
    return result;
  } catch {
    return null;
  }
};

// ── Places API (New) — Autocomplete + Place Details ──────────────────────────
// Documentación: https://developers.google.com/maps/documentation/places/web-service/place-autocomplete-new
// El sessionToken agrupa Autocomplete + Place Details en una sola unidad de facturación.

export interface PlacesPrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

// Caché en memoria: repetir la misma búsqueda o elegir de nuevo el mismo lugar no vuelve a
// llamar a Google (ni gasta cuota). Tope de tamaño para no crecer sin límite.
const SEARCH_TTL_MS = 10 * 60_000;
const SEARCH_CACHE_MAX = 200;
const autocompleteCache = new Map<string, { at: number; value: PlacesPrediction[] }>();
const placeCoordsCache = new Map<string, { lat: number; lng: number; displayName: string }>();

const remember = <V,>(map: Map<string, V>, key: string, value: V) => {
  if (map.size >= SEARCH_CACHE_MAX) map.delete(map.keys().next().value as string);
  map.set(key, value);
};

/** Devuelve `null` si la cuota de Autocomplete está agotada (el caller debe usar otra fuente). */
export const placesAutocomplete = async (
  input: string,
  apiKey: string,
  sessionToken: string,
): Promise<PlacesPrediction[] | null> => {
  if (input.length < 3) return [];
  const cacheKey = input.trim().toLowerCase();
  const hit = autocompleteCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.value;
  if (!(await consumeApiQuota("autocomplete"))) return null;
  try {
    // API key va en la URL para evitar CORS preflight por header X-Goog-Api-Key
    const res = await fetch(`${PLACES_NEW_BASE}:autocomplete?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        sessionToken,
        includedRegionCodes: ["cl"],
        languageCode: "es",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn("[Places API New] autocomplete error:", res.status, text);
      return [];
    }
    const data = (await res.json()) as {
      suggestions?: Array<{
        placePrediction: {
          placeId: string;
          text: { text: string };
          structuredFormat: {
            mainText: { text: string };
            secondaryText?: { text: string };
          };
        };
      }>;
    };
    const predictions = (data.suggestions ?? []).map((s) => ({
      placeId: s.placePrediction.placeId,
      description: s.placePrediction.text.text,
      mainText: s.placePrediction.structuredFormat.mainText.text,
      secondaryText: s.placePrediction.structuredFormat.secondaryText?.text ?? "",
    }));
    remember(autocompleteCache, cacheKey, { at: Date.now(), value: predictions });
    return predictions;
  } catch (e) {
    console.error("[Places] fetch threw:", e);
    return [];
  }
};

/**
 * Resuelve coordenadas a partir de un placeId (Places API New).
 * Completar el sessionToken aquí cierra la sesión de facturación — no se cobra extra.
 */
export const getPlaceCoords = async (
  placeId: string,
  apiKey: string,
  sessionToken: string,
): Promise<{ lat: number; lng: number; displayName: string } | null> => {
  const cachedCoords = placeCoordsCache.get(placeId);
  if (cachedCoords) return cachedCoords;
  if (!(await consumeApiQuota("places"))) return null;
  try {
    // $fields evita el header X-Goog-FieldMask (que dispara CORS preflight)
    const url = `${PLACES_NEW_BASE}/${placeId}?key=${apiKey}&sessionToken=${sessionToken}&languageCode=es&$fields=location,formattedAddress,displayName`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[Places API New] place details error:", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as {
      location?: { latitude: number; longitude: number };
      formattedAddress?: string;
      displayName?: { text: string; languageCode?: string };
    };
    if (!data.location) return null;
    const coords = {
      lat: data.location.latitude,
      lng: data.location.longitude,
      displayName: data.formattedAddress ?? data.displayName?.text ?? "",
    };
    remember(placeCoordsCache, placeId, coords);
    return coords;
  } catch (e) {
    console.warn("[Places API New] place details fetch error:", e);
    return null;
  }
};
