// Edge function: proxy a OpenRouteService para calcular isócronas.
// Mantiene la API key del lado del servidor.

import { getSecret } from "../_shared/get-secret.ts";

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
    const apiKey = await getSecret("OPENROUTESERVICE_API_KEY");
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

    const orsBody = JSON.stringify({
      locations: [[body.lng, body.lat]],
      range: ranges,
      range_type: "time",
      attributes: ["area"],
    });

    /**
     * Cuota que informa ORS en sus cabeceras.
     *
     * ORS publica el límite y lo consumido en cada respuesta; sin exponerlo,
     * saber cuántas isócronas quedan disponibles obligaba a inferirlo del plan
     * documentado en vez de leerlo del servicio.
     */
    const quotaOf = (r: Response) => {
      const pick = (...names: string[]) => {
        for (const n of names) {
          const v = r.headers.get(n);
          if (v != null) return v;
        }
        return null;
      };
      const q = {
        limitDay:      pick("x-ratelimit-limit", "X-Ratelimit-Limit"),
        remainingDay:  pick("x-ratelimit-remaining", "X-Ratelimit-Remaining"),
        resetAt:       pick("x-ratelimit-reset", "X-Ratelimit-Reset"),
        limitMinute:   pick("x-ratelimit-limit-minute", "ratelimit-limit"),
        remainingMin:  pick("x-ratelimit-remaining-minute", "ratelimit-remaining"),
        retryAfter:    pick("retry-after", "Retry-After"),
      };
      return Object.values(q).some((v) => v != null) ? q : null;
    };

    // Retry con backoff exponencial ante 429 (rate limit) o 5xx transitorios
    let orsRes: Response | null = null;
    let text = "";
    let lastNetErr: string | null = null;
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 20000);
        orsRes = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: apiKey,
            "Content-Type": "application/json",
            Accept: "application/geo+json",
          },
          body: orsBody,
          signal: ctrl.signal,
        });
        clearTimeout(timeoutId);
        text = await orsRes.text();
        if (orsRes.ok) break;
        const retryable = orsRes.status === 429 || orsRes.status >= 500;
        if (!retryable || attempt === maxAttempts) {
          console.error("ORS error", orsRes.status, text, quotaOf(orsRes));
          const status = orsRes.status === 429 ? 429 : 502;
          return new Response(
            JSON.stringify({
              error: "ORS request failed",
              status: orsRes.status,
              details: text,
              // Sin esto, un 429 no dice cuánta cuota queda ni cuándo se
              // renueva, y la única salida era adivinar el plan de ORS.
              quota: quotaOf(orsRes),
            }),
            { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        console.warn(`ORS ${orsRes.status} — retry ${attempt}/${maxAttempts}`);
      } catch (netErr) {
        lastNetErr = netErr instanceof Error ? netErr.message : String(netErr);
        console.warn(`ORS network error attempt ${attempt}/${maxAttempts}: ${lastNetErr}`);
        if (attempt === maxAttempts) {
          return new Response(
            JSON.stringify({ error: "ORS unreachable", details: lastNetErr }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      const waitMs = Math.min(16000, 2000 * 2 ** (attempt - 1));
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (!orsRes) {
      return new Response(JSON.stringify({ error: "ORS no response" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // La cuota se devuelve como cabeceras y no dentro del JSON: el cuerpo es el
    // GeoJSON que consumen los clientes y meterle campos ajenos lo cambiaría.
    const q = quotaOf(orsRes);
    const quotaHeaders: Record<string, string> = {};
    if (q) {
      for (const [k, v] of Object.entries(q)) {
        if (v != null) quotaHeaders[`x-ors-${k.toLowerCase()}`] = String(v);
      }
    }
    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, ...quotaHeaders, "Content-Type": "application/json" },
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
