// Edge function: geocodifica direcciones chilenas (calle + numero + comuna)
// a lat/lng usando la API de Mapbox (v6, forward geocoding estructurado).
// Cachea cada dirección en public.geocode_cache para no volver a pagar/
// consultar el proveedor cuando la misma dirección reaparece en una
// exportación futura.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSecret } from "../_shared/get-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BATCH = 200;
const CONCURRENCY = 5;

interface InAddr {
  key: string; // provisto por el cliente; normalmente igual a address_key
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
      return json(400, { error: `máximo ${MAX_BATCH} direcciones por llamada` });
    }

    const mapboxToken = await getSecret("MAPBOX_ACCESS_TOKEN");
    if (!mapboxToken) return json(500, { error: "MAPBOX_ACCESS_TOKEN no configurado" });

    // Normaliza y arma la lista de keys a resolver.
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
          full_address: c.raw_response?.full_address ?? null,
          cached: true,
        });
      } else {
        toGeocode.push(a);
      }
    }

    // 2) Geocodificar las que faltan, con concurrencia limitada.
    const upserts: any[] = [];
    let idx = 0;
    const worker = async () => {
      while (idx < toGeocode.length) {
        const a = toGeocode[idx++];
        const addressLine1 = `${a.calle} ${a.numero}`.trim();
        const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
        url.searchParams.set("address_line1", addressLine1);
        url.searchParams.set("place", a.comuna);
        url.searchParams.set("country", "CL");
        url.searchParams.set("limit", "1");
        url.searchParams.set("access_token", mapboxToken);

        let lat: number | null = null;
        let lng: number | null = null;
        let confidence: string | null = null;
        let fullAddress: string | null = null;
        let found = false;

        try {
          const resp = await fetch(url.toString());
          const j = await resp.json();
          const feat = j?.features?.[0];
          const coords = feat?.geometry?.coordinates;
          if (Array.isArray(coords) && coords.length === 2) {
            lng = Number(coords[0]);
            lat = Number(coords[1]);
            found = Number.isFinite(lat) && Number.isFinite(lng);
          }
          confidence = feat?.properties?.match_code?.confidence ?? null;
          fullAddress = feat?.properties?.full_address ?? feat?.properties?.name ?? null;

          upserts.push({
            address_key: a.key,
            query_text: addressLine1 + ", " + a.comuna,
            lat,
            lng,
            found,
            confidence,
            provider: "mapbox",
            raw_response: { full_address: fullAddress, feature: feat ?? null },
          });
        } catch (e) {
          upserts.push({
            address_key: a.key,
            query_text: addressLine1 + ", " + a.comuna,
            lat: null,
            lng: null,
            found: false,
            confidence: null,
            provider: "mapbox",
            raw_response: { error: String(e) },
          });
        }

        results.push({ key: a.key, lat, lng, found, confidence, full_address: fullAddress, cached: false });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toGeocode.length) }, worker));

    if (upserts.length) {
      await admin.from("geocode_cache").upsert(upserts, { onConflict: "address_key" });
    }

    return json(200, { results, from_cache: addrs.length - toGeocode.length, geocoded: toGeocode.length });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
