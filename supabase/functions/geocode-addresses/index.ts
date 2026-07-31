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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// En la práctica Nominatim responde en ~2-3s por solicitud, así que un lote
// de 25 tarda ~60-75s: cómodo bajo el límite de ejecución de la función,
// incluso sin contar que ahora cada resultado se guarda al toque.
const MAX_BATCH = 25;
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
  cached: boolean;
}

const normalizeKey = (calle: string, numero: string, comuna: string): string =>
  `${calle} ${numero}, ${comuna}, Chile`.toLowerCase().replace(/\s+/g, " ").trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
      return json(400, { error: `máximo ${MAX_BATCH} direcciones por llamada (límite de Nominatim: 1 req/seg)` });
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
    const cacheMap = new Map((cachedRows ?? []).map((r: any) => [r.address_key, r]));

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
          cached: true,
        });
      } else {
        toGeocode.push(a);
      }
    }

    // 2) Geocodificar las que faltan: SECUENCIAL, 1 solicitud por vez (sin
    // concurrencia — la política de Nominatim la prohíbe explícitamente).
    // Cada resultado se guarda en el acto (no al final del lote): si la
    // función se corta a mitad de camino, lo ya geocodificado no se pierde.
    // La pausa es dinámica: solo espera lo que falte para completar 1
    // segundo desde que arrancó la solicitud (Nominatim suele tardar ~2s
    // por sí solo, así que en la práctica casi nunca hace falta pausar).
    for (const a of toGeocode) {
      const t0 = Date.now();
      const streetLine = `${a.calle} ${a.numero}`.trim();
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("street", streetLine);
      url.searchParams.set("city", a.comuna);
      url.searchParams.set("country", "Chile");
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      url.searchParams.set("addressdetails", "0");

      let lat: number | null = null;
      let lng: number | null = null;
      let confidence: string | null = null;
      let displayName: string | null = null;
      let found = false;
      let row: any;

      try {
        const resp = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
        const arr = await resp.json();
        const feat = Array.isArray(arr) ? arr[0] : null;
        if (feat) {
          lat = parseFloat(feat.lat);
          lng = parseFloat(feat.lon);
          found = Number.isFinite(lat) && Number.isFinite(lng);
          confidence = feat.importance != null ? String(feat.importance) : null;
          displayName = feat.display_name ?? null;
        }
        row = {
          address_key: a.key,
          query_text: streetLine + ", " + a.comuna,
          lat, lng, found, confidence,
          provider: "nominatim",
          raw_response: { display_name: displayName, feature: feat ?? null },
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
      results.push({ key: a.key, lat, lng, found, confidence, full_address: displayName, cached: false });

      const elapsed = Date.now() - t0;
      if (elapsed < DELAY_MS) await sleep(DELAY_MS - elapsed);
    }

    return json(200, { results, from_cache: addrs.length - toGeocode.length, geocoded: toGeocode.length });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
