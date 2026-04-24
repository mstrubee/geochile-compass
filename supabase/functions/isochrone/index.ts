// Edge function: proxy a OpenRouteService para calcular isócronas.
// Mantiene la API key del lado del servidor.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  mode: "foot-walking" | "driving-car" | "cycling-regular";
  lat: number;
  lng: number;
  minutes: number[];
}

const ALLOWED_MODES = new Set([
  "foot-walking",
  "driving-car",
  "cycling-regular",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("OPENROUTESERVICE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENROUTESERVICE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as Body;

    if (!body || !ALLOWED_MODES.has(body.mode)) {
      return new Response(JSON.stringify({ error: "invalid mode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (
      typeof body.lat !== "number" ||
      typeof body.lng !== "number" ||
      Number.isNaN(body.lat) ||
      Number.isNaN(body.lng)
    ) {
      return new Response(JSON.stringify({ error: "invalid coordinates" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const minutes = Array.isArray(body.minutes)
      ? body.minutes
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0 && n <= 60)
      : [];
    if (!minutes.length) {
      return new Response(JSON.stringify({ error: "invalid minutes" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ranges = minutes.map((m) => Math.round(m * 60)); // seconds
    const url = `https://api.openrouteservice.org/v2/isochrones/${body.mode}`;

    const orsRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/geo+json",
      },
      body: JSON.stringify({
        locations: [[body.lng, body.lat]],
        range: ranges,
        range_type: "time",
        attributes: ["area"],
      }),
    });

    const text = await orsRes.text();
    if (!orsRes.ok) {
      console.error("ORS error", orsRes.status, text);
      return new Response(
        JSON.stringify({ error: "ORS request failed", status: orsRes.status, details: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/geo+json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("isochrone fn error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
