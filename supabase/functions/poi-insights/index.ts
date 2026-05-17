import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MetricsAggregate {
  metricKey: string;
  format: string;
  totalAllTime: number;
  latest: { period: string; value: number } | null;
  yoy: number | null; // % crecimiento últimos 12 vs 12 anteriores
  mom: number | null; // % crecimiento último mes vs mes anterior
  trailing12Sum: number; // ventas TTM
  bestMonth: { period: string; value: number } | null;
  worstMonth: { period: string; value: number } | null;
}

interface PoiSummaryPayload {
  poi: {
    name: string;
    address: string | null;
    comuna: string | null;
    centro_sap?: string;
    gerente_zonal?: string;
    zona?: string;
    [k: string]: unknown;
  };
  aggregates: MetricsAggregate[];
  /** Métricas comparables agregadas a nivel carpeta. */
  folderContext?: {
    folderName: string;
    poiCount: number;
    medianTrailing12?: number;
    topPercentile?: number;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const MODEL = Deno.env.get("LOVABLE_AI_MODEL") ?? "google/gemini-2.5-flash";

    let payload: PoiSummaryPayload;
    try {
      const raw = await req.text();
      payload = raw ? (JSON.parse(raw) as PoiSummaryPayload) : ({} as PoiSummaryPayload);
    } catch (_err) {
      payload = {} as PoiSummaryPayload;
    }
    if (!payload?.poi) {
      console.error("poi-insights: missing poi in payload", payload);
      return new Response(
        JSON.stringify({ error: "Missing payload: poi is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!Array.isArray(payload.aggregates)) {
      payload.aggregates = [];
    }

    const systemPrompt = `Eres un analista comercial experto en retail chileno.
Recibes datos de un local: identidad y métricas históricas (ventas mensuales y similares).
Tu tarea es producir un resumen ejecutivo en español, en formato Markdown, con secciones:

**Perfil del local** (1-2 frases con nombre, dirección, comuna, centro SAP/zona si aplica)
**Desempeño reciente** (último mes con valor + comparación MoM y YoY si están disponibles)
**Tendencia histórica** (1-2 frases sobre TTM, mejor/peor mes histórico, picos)
**Posicionamiento** (si hay folderContext: cómo se compara con la mediana del grupo)
**Recomendación** (1-2 bullets accionables: oportunidad, riesgo, próxima acción)

Reglas:
- Sé concreto, usa cifras formateadas (CLP con separadores de miles).
- No inventes datos. Si un campo es null, omítelo.
- Máximo 200 palabras totales.
- No incluyas títulos H1.
- Si no hay datos suficientes, di "Datos insuficientes para análisis completo" y entrega lo que tengas.`;

    const userPrompt = `Datos del local:\n\n${JSON.stringify(payload, null, 2)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("Lovable AI error", aiRes.status, t);
      const status = aiRes.status === 429 ? 429 : aiRes.status === 402 ? 402 : 500;
      return new Response(
        JSON.stringify({
          error:
            aiRes.status === 429
              ? "Rate limit exceeded"
              : aiRes.status === 402
                ? "AI credits exhausted"
                : "AI gateway error",
          detail: t,
        }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await aiRes.json();
    const summary: string =
      data?.choices?.[0]?.message?.content ?? "No se pudo generar el resumen.";

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("poi-insights error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
