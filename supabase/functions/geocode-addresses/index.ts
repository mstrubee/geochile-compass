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
// Estrategia de búsqueda en cascada (cada intento respeta el límite de 1/seg
// antes de pasar al siguiente; se detiene en el primero que encuentre algo):
//   1) Estructurada tal cual (street=calle+numero, city=comuna).
//   2) Estructurada sin el prefijo genérico de la calle (Avenida/Av./Calle/
//      Pasaje) — en OSM muchas calles están cargadas SIN el prefijo (ej. la
//      calle "Lazo" existe, pero "Avenida Lazo" no matchea nada).
//   3) Búsqueda libre (no estructurada) con calle+numero+comuna — encuentra
//      villas/poblaciones que en OSM están cargadas como "lugar", no calle.
// Ninguna de las 3 amplía la búsqueda fuera de la comuna indicada (evita el
// riesgo de matchear la calle correcta en la ciudad equivocada).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Peor caso: 3 solicitudes por dirección (si las 2 primeras fallan). Con
// lote de 10 y ~2-3s reales por solicitud, un lote puede tardar hasta
// ~90s -- cómodo bajo el límite de ejecución de la función.
const MAX_BATCH = 10;
const DELAY_MS = 1100; // piso mínimo entre solicitudes (límite Nominatim: 1/seg)

const USER_AGENT = "GeoPlanet-Geocoder/1.0 (contacto: matiasstrube@gplanet.cl)";

const PREFIXES_RE = /^(avenida|av\.?|avda\.?|calle|pasaje|psje\.?)\s+/i;

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

interface CacheRow {
  address_key: string;
  query_text: string;
  lat: number | null;
  lng: number | null;
  found: boolean;
  confidence: string | null;
  provider: string;
  raw_response: { display_name?: string | null; method?: string | null; error?: string } | null;
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
}

/** Una sola llamada a Nominatim, respetando el piso de 1 req/seg (dinámico). */
const nominatimCall = async (params: Record<string, string>): Promise<NominatimHit | null> => {
  const t0 = Date.now();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

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

/** Prueba las 3 estrategias en cascada; se detiene en la primera que encuentre algo. */
const geocodeCascade = async (
  calle: string,
  numero: string,
  comuna: string,
): Promise<{ hit: NominatimHit | null; method: string | null }> => {
  const streetLine = `${calle} ${numero}`.trim();

  // 1) Estructurada tal cual.
  const r1 = await nominatimCall({ street: streetLine, city: comuna, country: "Chile" });
  if (r1) return { hit: r1, method: "structured" };

  // 2) Estructurada sin prefijo genérico (si la calle tenía uno).
  const calleSinPrefijo = calle.replace(PREFIXES_RE, "").trim();
  if (calleSinPrefijo && calleSinPrefijo.toLowerCase() !== calle.toLowerCase()) {
    const r2 = await nominatimCall({
      street: `${calleSinPrefijo} ${numero}`.trim(),
      city: comuna,
      country: "Chile",
    });
    if (r2) return { hit: r2, method: "structured_no_prefix" };
  }

  // 3) Búsqueda libre (encuentra villas/poblaciones cargadas como "lugar").
  const r3 = await nominatimCall({ q: `${calle} ${numero}, ${comuna}, Chile` });
  if (r3) return { hit: r3, method: "unstructured" };

  return { hit: null, method: null };
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
      return json(400, { error: `máximo ${MAX_BATCH} direcciones por llamada (límite de Nominatim: 1 req/seg, hasta 3 intentos por dirección)` });
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

    // 2) Geocodificar las que faltan: SECUENCIAL, cascada de hasta 3 intentos
    // por dirección, cada uno respetando el piso de 1 req/seg de Nominatim.
    // Cada resultado se guarda en el acto (no al final del lote): si la
    // función se corta a mitad de camino, lo ya geocodificado no se pierde.
    for (const a of toGeocode) {
      const streetLine = `${a.calle} ${a.numero}`.trim();
      let row: CacheRow;
      let lat: number | null = null;
      let lng: number | null = null;
      let confidence: string | null = null;
      let displayName: string | null = null;
      let method: string | null = null;
      let found = false;

      try {
        const { hit, method: m } = await geocodeCascade(a.calle, a.numero, a.comuna);
        method = m;
        if (hit) {
          lat = hit.lat; lng = hit.lng; confidence = hit.confidence; displayName = hit.displayName;
          found = true;
        }
        row = {
          address_key: a.key,
          query_text: streetLine + ", " + a.comuna,
          lat, lng, found, confidence,
          provider: "nominatim",
          raw_response: { display_name: displayName, method },
        };
      } catch (e) {
        row = {
          address_key: a.key,
          query_text: streetLine + ", " + a.comuna,
          lat: null, lng: null, found: false, confidence: null,
          provider: "nominatim",
          raw_response: { error: String(e) },
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
