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
/** true tras descontar la carga de mapa de esta apertura de la página. */
let mapLoadCounted = false;

/** Maps basemap style to Google map type. */
export const basemapToGoogleMapType = (basemap: string): GoogleMapType => {
  if (basemap === "satellite") return "satellite";
  if (basemap === "hybrid") return "hybrid";
  return "roadmap";
};

/**
 * Creates or returns a cached session token for the given map type.
 * La cuota "maps_js" se mide en CARGAS DE MAPA: se descuenta una sola vez por apertura de la
 * página (la primera sesión de Google); cambiar de mapa base (claro/satélite/híbrido) NO suma.
 */
export const createGoogleTileSession = async (
  apiKey: string,
  mapType: GoogleMapType,
): Promise<TileSession | null> => {
  const cached = sessionCache.get(mapType);
  if (cached && cached.expiry > Date.now() + 60_000) return cached;
  if (!mapLoadCounted) {
    if (!(await consumeApiQuota("maps_js"))) return null;
    mapLoadCounted = true;
  }

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

/** Devuelve `null` si la cuota de Autocomplete está agotada (el caller debe usar otra fuente). */
export const placesAutocomplete = async (
  input: string,
  apiKey: string,
  sessionToken: string,
): Promise<PlacesPrediction[] | null> => {
  if (input.length < 3) return [];
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
