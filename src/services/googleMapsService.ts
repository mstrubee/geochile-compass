/**
 * Google Maps Platform — session tokens, usage tracking, geocoding, places.
 * Toda la comunicación con las APIs de Google pasa por este módulo.
 */

const TILES_BASE = "https://tile.googleapis.com/v1";
const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";
// Places API (New) — reemplaza la API legacy deprecada en marzo 2025.
// Soporta CORS nativo desde el browser, sin proxy.
const PLACES_NEW_BASE = "https://places.googleapis.com/v1/places";

export type GoogleMapType = "roadmap" | "satellite" | "hybrid";

// ── Usage tracking ────────────────────────────────────────────────────────────

const USAGE_KEY = "geoplanet_google_usage_v1";

export interface UsageData {
  cycleStart: string; // YYYY-MM-DD
  sessions: number;
  tiles: number;
  geocoding: number;
  places: number;
}

const currentCycleStart = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

export const loadUsage = (): UsageData => {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as UsageData;
      if (data.cycleStart === currentCycleStart()) return data;
    }
  } catch { /* ignore */ }
  return { cycleStart: currentCycleStart(), sessions: 0, tiles: 0, geocoding: 0, places: 0 };
};

export const incrementUsage = (
  service: keyof Omit<UsageData, "cycleStart">,
  count = 1,
): UsageData => {
  const usage = loadUsage();
  usage[service] += count;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch { /* ignore */ }
  return usage;
};

// ── Tile session management ───────────────────────────────────────────────────

interface TileSession {
  session: string;
  expiry: number; // Unix ms
  mapType: GoogleMapType;
}

const sessionCache = new Map<GoogleMapType, TileSession>();

/** Maps basemap style to Google map type. */
export const basemapToGoogleMapType = (basemap: string): GoogleMapType => {
  if (basemap === "satellite") return "satellite";
  if (basemap === "hybrid") return "hybrid";
  return "roadmap";
};

/**
 * Creates or returns a cached session token for the given map type.
 * Counts one session per creation toward the monthly quota.
 */
export const createGoogleTileSession = async (
  apiKey: string,
  mapType: GoogleMapType,
): Promise<TileSession | null> => {
  const cached = sessionCache.get(mapType);
  if (cached && cached.expiry > Date.now() + 60_000) return cached;

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
    incrementUsage("sessions");
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
    incrementUsage("geocoding");

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

export const placesAutocomplete = async (
  input: string,
  apiKey: string,
  sessionToken: string,
): Promise<PlacesPrediction[]> => {
  if (input.length < 3) return [];
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
    incrementUsage("places");
    return (data.suggestions ?? []).map((s) => ({
      placeId: s.placePrediction.placeId,
      description: s.placePrediction.text.text,
      mainText: s.placePrediction.structuredFormat.mainText.text,
      secondaryText: s.placePrediction.structuredFormat.secondaryText?.text ?? "",
    }));
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
    return {
      lat: data.location.latitude,
      lng: data.location.longitude,
      displayName: data.formattedAddress ?? data.displayName?.text ?? "",
    };
  } catch (e) {
    console.warn("[Places API New] place details fetch error:", e);
    return null;
  }
};
