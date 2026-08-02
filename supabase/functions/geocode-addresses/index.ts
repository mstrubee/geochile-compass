// Edge function: geocodifica direcciones chilenas (calle + numero + comuna)
// a lat/lng usando Nominatim (OpenStreetMap) — servicio público, gratuito y
// sin cuenta. Cachea cada dirección en public.geocode_cache: la política de
// uso de Nominatim EXIGE cachear los resultados, así que además de ahorrar
// tiempo en corridas futuras (misma dirección reaparece en exportaciones
// mensuales), es un requisito de sus términos de servicio.
//
// Política de Nominatim (operations.osmfoundation.org/policies/nominatim):
//  - Máximo absoluto: 1 solicitud por segundo, secuencial (sin concurrencia).
//  - Requiere un User-Agent que identifique la aplicación (no el default de
//    la librería HTTP).
//  - Cachear los resultados es obligatorio.
//
// La limpieza/normalización de la dirección (mayúsculas, abreviaturas,
// ruido de villa/depto, variantes por sinónimos, etc.) vive en el módulo
// independiente ../_shared/address-normalizer — este archivo solo lo llama
// ANTES de geocodificar y prueba, en orden, los candidatos que devuelve.
// Cada candidato se valida contra la comuna/región esperada
// (../_shared/geocode-validation) antes de aceptarlo: evita quedarse con la
// calle correcta en la ciudad equivocada cuando el nombre es común (ver
// memoria del proyecto: "Colón", "Santa Rita", etc. existen en decenas de
// comunas). Ningún candidato amplía la búsqueda fuera de la comuna indicada.
//
// Si TODO lo anterior falla, como último recurso se consulta
// ../_shared/address-resolver: alias conocidos + fuzzy matching (Levenshtein/
// Jaro-Winkler/Trigram) contra el callejero real de la comuna (cacheado vía
// Overpass API). No reemplaza nada de lo anterior, solo se prueba después.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { addressNormalizer, type NormalizedCandidate } from "../_shared/address-normalizer/index.ts";
import { validateGeocodeResult, type NominatimAddressDetails } from "../_shared/geocode-validation.ts";
import { addressResolver } from "../_shared/address-resolver/index.ts";
import type { ResolveResult } from "../_shared/address-resolver/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// El normalizador puede generar bastantes candidatos para calles largas
// (variantes + sinónimos + sin tildes + sin número); se acota el número que
// realmente se prueba para mantener acotado el peor caso por dirección.
const MAX_CANDIDATES_PER_ADDRESS = 8;

// Peor caso: MAX_CANDIDATES_PER_ADDRESS + 1 (búsqueda libre) + 1 (intento
// final con la calle corregida por address-resolver) por dirección. Con
// lote de 4 y ~2-3s reales por solicitud a Nominatim, un lote puede tardar
// hasta ~100s -- cómodo bajo el límite de ejecución de la función. El
// address-resolver puede sumar 1-2 llamadas más (Nominatim + Overpass) la
// PRIMERA vez que se ve una comuna nueva; ya cacheada, no vuelve a llamarlas.
const MAX_BATCH = 3;
const DELAY_MS = 1100; // piso mínimo entre solicitudes (límite Nominatim: 1/seg)

const USER_AGENT = "GeoPlanet-Geocoder/1.0 (contacto: matiasstrube@gplanet.cl)";

interface InAddr {
  key: string;
  calle: string;
  numero: string;
  comuna: string;
}

interface OutResult {
  key: string;
  lat: number | null;
  lng: number | null;
  found: boolean;
  confidence: string | null;
  full_address: string | null;
  method: string | null;
  cached: boolean;
}

interface GeocodeLog {
  display_name?: string | null;
  method?: string | null;
  used_address?: string | null;
  changes?: Array<{ stage: string; before: string; after: string }>;
  warnings?: Array<{ stage: string; message: string }>;
  removed_tokens?: string[];
  extra_information?: string | null;
  elapsed_ms?: number;
  error?: string;
  /** Presente solo cuando address-normalizer + Nominatim fallaron y
   * address-resolver encontró una corrección (alias o fuzzy matching). */
  resolver?: {
    original_calle: string;
    resolved_calle: string;
    algorithm: ResolveResult["method"];
    score: number;
    catalog_size: number;
  };
}

interface CacheRow {
  address_key: string;
  query_text: string;
  lat: number | null;
  lng: number | null;
  found: boolean;
  confidence: string | null;
  provider: string;
  raw_response: GeocodeLog | null;
}

const normalizeKey = (calle: string, numero: string, comuna: string): string =>
  `${calle} ${numero}, ${comuna}, Chile`.toLowerCase().replace(/\s+/g, " ").trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface NominatimHit {
  lat: number;
  lng: number;
  confidence: string | null;
  displayName: string | null;
  address?: NominatimAddressDetails;
}

/** Una sola llamada a Nominatim, respetando el piso de 1 req/seg (dinámico). */
const nominatimCall = async (params: Record<string, string>): Promise<NominatimHit | null> => {
  const t0 = Date.now();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1"); // necesario para validar comuna/región

  let hit: NominatimHit | null = null;
  try {
    const resp = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
    const arr = await resp.json();
    const feat = Array.isArray(arr) ? arr[0] : null;
    if (feat) {
      const lat = parseFloat(feat.lat);
      const lng = parseFloat(feat.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        hit = {
          lat, lng,
          confidence: feat.importance != null ? String(feat.importance) : null,
          displayName: feat.display_name ?? null,
          address: feat.address ?? undefined,
        };
      }
    }
  } catch (_e) {
    hit = null;
  }

  const elapsed = Date.now() - t0;
  if (elapsed < DELAY_MS) await sleep(DELAY_MS - elapsed);
  return hit;
};

interface GeocodeOutcome {
  hit: NominatimHit | null;
  method: string | null;
  usedAddress: string | null;
  resolver?: ResolveResult;
}

/**
 * Prueba, en orden, los candidatos que arma el address-normalizer (dirección
 * original, normalizada, variantes, sinónimos, sin tildes, sin número), y
 * como último recurso una búsqueda libre. Cada candidato encontrado se
 * valida contra la comuna esperada antes de aceptarlo; si no coincide, se
 * sigue con el próximo candidato en vez de darlo por bueno.
 */
const geocodeCandidate = async (
  candidate: NormalizedCandidate,
  comuna: string,
): Promise<GeocodeOutcome | null> => {
  const street = `${candidate.calle} ${candidate.numero}`.trim();
  if (!street) return null;
  const hit = await nominatimCall({ street, city: comuna, country: "Chile" });
  if (!hit) return null;
  const validation = validateGeocodeResult(hit.address, comuna);
  if (!validation.valid) return null;
  return { hit, method: candidate.label, usedAddress: street };
};

const geocodeAddress = async (
  admin: SupabaseClient,
  calle: string,
  numero: string,
  comuna: string,
): Promise<{
  outcome: GeocodeOutcome;
  changes: Array<{ stage: string; before: string; after: string }>;
  warnings: Array<{ stage: string; message: string }>;
  removedTokens: string[];
  extraInformation: string | null;
}> => {
  const normalized = addressNormalizer.normalize({ calle, numero, comuna });
  const candidates = normalized.normalizedAddresses.slice(0, MAX_CANDIDATES_PER_ADDRESS);
  const base = {
    changes: normalized.changes,
    warnings: normalized.warnings,
    removedTokens: normalized.removedTokens,
    extraInformation: normalized.extraInformation,
  };

  // Sin nombre de calle no hay nada que buscar: ni Nominatim ni el fuzzy
  // matching del resolver pueden inventar una calle a partir de la nada. Se
  // corta de inmediato en vez de gastar ~10 solicitudes por dirección — en la
  // sábana real del usuario el 22% de las direcciones aún sin resolver tienen
  // la columna de calle vacía, así que este atajo es lo que evita que una
  // corrida de reintento se pase horas consultando por direcciones imposibles.
  if (!calle.trim()) {
    return {
      outcome: { hit: null, method: null, usedAddress: null },
      ...base,
      warnings: [
        ...normalized.warnings,
        { stage: "input", message: "La columna de calle viene vacía: no hay nada que geocodificar." },
      ],
    };
  }

  for (const candidate of candidates) {
    const outcome = await geocodeCandidate(candidate, comuna);
    if (outcome) return { outcome, ...base };
  }

  // Último recurso: búsqueda libre (no estructurada) — encuentra
  // villas/poblaciones que en OSM están cargadas como "lugar", no calle.
  const freeText = `${calle} ${numero}, ${comuna}, Chile`;
  const freeHit = await nominatimCall({ q: freeText });
  if (freeHit) {
    const validation = validateGeocodeResult(freeHit.address, comuna);
    if (validation.valid) {
      return { outcome: { hit: freeHit, method: "unstructured", usedAddress: freeText }, ...base };
    }
  }

  // address-resolver: alias conocidos + fuzzy matching contra el callejero
  // real de la comuna. Solo se consulta cuando TODO lo anterior falló.
  const resolved = await addressResolver.resolve(admin, { calle, numero, comuna });
  if (resolved) {
    const resolvedOutcome = await geocodeCandidate(
      { label: `resolved:${resolved.method}`, calle: resolved.resolvedCalle, numero },
      comuna,
    );
    if (resolvedOutcome) return { outcome: { ...resolvedOutcome, resolver: resolved }, ...base };
  }

  return { outcome: { hit: null, method: null, usedAddress: null, resolver: resolved ?? undefined }, ...base };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json(401, { error: "unauthorized" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .limit(1);
    if (!roles?.length) return json(403, { error: "forbidden: admin required" });

    const body = await req.json();
    const retryNotFound = !!body.retry_not_found;
    const rawAddrs: InAddr[] = Array.isArray(body.addresses) ? body.addresses : [];
    if (!rawAddrs.length) return json(400, { error: "addresses (array) required" });
    if (rawAddrs.length > MAX_BATCH) {
      return json(400, {
        error: `máximo ${MAX_BATCH} direcciones por llamada (límite de Nominatim: 1 req/seg, hasta ${MAX_CANDIDATES_PER_ADDRESS + 2} intentos por dirección)`,
      });
    }

    const addrs = rawAddrs.map((a) => ({
      ...a,
      key: a.key || normalizeKey(a.calle, a.numero, a.comuna),
    }));
    const keys = addrs.map((a) => a.key);

    // 1) Consultar caché para todas las keys de una vez.
    const { data: cachedRows } = await admin
      .from("geocode_cache")
      .select("address_key, lat, lng, found, confidence, raw_response")
      .in("address_key", keys);
    const cacheMap = new Map(
      ((cachedRows ?? []) as CacheRow[]).map((r) => [r.address_key, r]),
    );

    const results: OutResult[] = [];
    const toGeocode: typeof addrs = [];

    for (const a of addrs) {
      const c = cacheMap.get(a.key);
      if (c && (c.found || !retryNotFound)) {
        results.push({
          key: a.key,
          lat: c.lat,
          lng: c.lng,
          found: c.found,
          confidence: c.confidence,
          full_address: c.raw_response?.display_name ?? null,
          method: c.raw_response?.method ?? null,
          cached: true,
        });
      } else {
        toGeocode.push(a);
      }
    }

    // 2) Geocodificar las que faltan: SECUENCIAL, respetando el piso de
    // 1 req/seg de Nominatim. Cada resultado se guarda en el acto (no al
    // final del lote): si la función se corta a mitad de camino, lo ya
    // geocodificado no se pierde.
    for (const a of toGeocode) {
      const t0 = Date.now();
      const streetLine = `${a.calle} ${a.numero}`.trim();
      let row: CacheRow;
      let lat: number | null = null;
      let lng: number | null = null;
      let confidence: string | null = null;
      let displayName: string | null = null;
      let method: string | null = null;
      let found = false;

      try {
        const { outcome, changes, warnings, removedTokens, extraInformation } =
          await geocodeAddress(admin, a.calle, a.numero, a.comuna);
        method = outcome.method;
        if (outcome.hit) {
          lat = outcome.hit.lat;
          lng = outcome.hit.lng;
          confidence = outcome.hit.confidence;
          displayName = outcome.hit.displayName;
          found = true;
        }
        row = {
          address_key: a.key,
          query_text: streetLine + ", " + a.comuna,
          lat, lng, found, confidence,
          provider: "nominatim",
          raw_response: {
            display_name: displayName,
            method,
            used_address: outcome.usedAddress,
            changes,
            warnings,
            removed_tokens: removedTokens,
            extra_information: extraInformation,
            elapsed_ms: Date.now() - t0,
            ...(outcome.resolver && {
              resolver: {
                original_calle: outcome.resolver.originalCalle,
                resolved_calle: outcome.resolver.resolvedCalle,
                algorithm: outcome.resolver.method,
                score: outcome.resolver.score,
                catalog_size: outcome.resolver.catalogSize,
              },
            }),
          },
        };
      } catch (e) {
        row = {
          address_key: a.key,
          query_text: streetLine + ", " + a.comuna,
          lat: null, lng: null, found: false, confidence: null,
          provider: "nominatim",
          raw_response: { error: String(e), elapsed_ms: Date.now() - t0 },
        };
      }

      await admin.from("geocode_cache").upsert([row], { onConflict: "address_key" });
      results.push({ key: a.key, lat, lng, found, confidence, full_address: displayName, method, cached: false });
    }

    return json(200, { results, from_cache: addrs.length - toGeocode.length, geocoded: toGeocode.length });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
