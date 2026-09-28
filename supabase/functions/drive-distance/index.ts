// Edge function: distancia en auto desde un punto hasta varios destinos.
//
// Devuelve los kilómetros REALES por calle y cuánto de esa ruta es autopista.
// El tiempo NO se calcula acá: el modelo de ORS supone tránsito libre, y la
// aplicación aplica las velocidades que define el admin sobre estos
// kilómetros. Así, cambiar esas velocidades no obliga a volver a rutear.

import { getSecret } from "../_shared/get-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Punto { id: string; lat: number; lng: number }
interface Body { origin: { lat: number; lng: number }; destinations: Punto[] }

/** Categorías de ORS que cuentan como autopista: 1 = Highway, 16 = Tollway. */
const AUTOPISTA = new Set([1, 16]);

/** Tope por llamada: cada destino consume una consulta de la cuota de ORS. */
const MAX_DESTINOS = 12;

const esCoord = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

interface OrsRuta {
  routes?: Array<{
    summary?: { distance?: number; duration?: number };
    extras?: { waycategory?: { summary?: Array<{ value: number; distance: number }> } };
  }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const apiKey = await getSecret("OPENROUTESERVICE_API_KEY");
    if (!apiKey) return json({ error: "OPENROUTESERVICE_API_KEY not configured" }, 500);

    const body = (await req.json()) as Body;
    if (!body?.origin || !esCoord(body.origin.lat, body.origin.lng)) {
      return json({ error: "invalid origin" }, 400);
    }
    const destinos = (Array.isArray(body.destinations) ? body.destinations : [])
      .filter((d) => d && typeof d.id === "string" && esCoord(d.lat, d.lng))
      .slice(0, MAX_DESTINOS);
    if (destinos.length === 0) return json({ error: "no destinations" }, 400);

    const results: Array<{
      id: string;
      km: number | null;
      highwayKm: number | null;
      routerMinutes: number | null;
      error?: string;
    }> = [];

    // En serie: ORS limita también por minuto, y los destinos son pocos.
    for (const d of destinos) {
      try {
        const res = await fetch(
          "https://api.openrouteservice.org/v2/directions/driving-car/json",
          {
            method: "POST",
            headers: { Authorization: apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              coordinates: [[body.origin.lng, body.origin.lat], [d.lng, d.lat]],
              extra_info: ["waycategory"],
              instructions: false,
            }),
          },
        );
        if (!res.ok) {
          const texto = await res.text();
          console.error("ORS directions", res.status, texto.slice(0, 300));
          results.push({
            id: d.id, km: null, highwayKm: null, routerMinutes: null,
            // 404 de ORS = no hay ruta posible (isla, punto sin calle cerca).
            error: res.status === 404 ? "sin ruta" : `ORS ${res.status}`,
          });
          continue;
        }
        const data = (await res.json()) as OrsRuta;
        const ruta = data.routes?.[0];
        const metros = ruta?.summary?.distance ?? 0;
        const cats = ruta?.extras?.waycategory?.summary ?? [];
        const autopistaM = cats
          .filter((c) => AUTOPISTA.has(Number(c.value)))
          .reduce((s, c) => s + (Number(c.distance) || 0), 0);
        results.push({
          id: d.id,
          km: Math.round((metros / 1000) * 100) / 100,
          highwayKm: Math.round((Math.min(autopistaM, metros) / 1000) * 100) / 100,
          routerMinutes: ruta?.summary?.duration != null
            ? Math.round(ruta.summary.duration / 60)
            : null,
        });
      } catch (e) {
        results.push({
          id: d.id, km: null, highwayKm: null, routerMinutes: null,
          error: e instanceof Error ? e.message : "error",
        });
      }
    }

    return json({ results });
  } catch (e) {
    console.error("drive-distance", e);
    return json({ error: e instanceof Error ? e.message : "unexpected" }, 500);
  }
});
