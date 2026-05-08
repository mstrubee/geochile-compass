import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

    const { analysis, rmAverages } = await req.json();
    if (!analysis) {
      return new Response(JSON.stringify({ error: "Missing analysis payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const compactAnalysis = {
      bandMinutes: analysis.bandMinutes,
      area_km2: analysis.area_km2,
      totals: analysis.totals,
      density: analysis.density,
      gse: analysis.gse,
      manzanas: analysis.manzanas
        ? {
            count: analysis.manzanas.manzanaCount,
            pop: analysis.manzanas.pop,
            hh: analysis.manzanas.hh,
            nseDistribution: analysis.manzanas.nseDistribution,
          }
        : null,
      communes: (analysis.communes ?? []).slice(0, 8).map((c: any) => ({
        name: c.name,
        share: Math.round(c.areaShareInIso * 100),
        pop: Math.round(c.popInIso),
        hh: Math.round(c.hhInIso),
        ingreso: c.ingreso,
        nse: c.nse,
      })),
      territorialPoints: {
        total: analysis.territorialPoints?.total ?? 0,
        groups: (analysis.territorialPoints?.groups ?? []).map((g: any) => ({
          name: g.groupName,
          count: g.count,
        })),
      },
      comparisons: analysis.comparisons,
    };

    const systemPrompt = `Eres un analista urbano experto en la Región Metropolitana de Chile.
Recibes un objeto JSON con datos de una isócrona (zona alcanzable en X minutos desde un punto).
Tu tarea es producir un resumen ejecutivo en español, en formato Markdown, con secciones:

**Perfil socioeconómico** (1-2 frases sobre NSE, ingreso, escolaridad y composición)
**Densidad y cobertura** (1-2 frases sobre densidad poblacional y servicios disponibles)
**Fortalezas** (2-3 bullets)
**Alertas** (2-3 bullets)
**Recomendaciones** (2-3 bullets para retail/servicios/inversión)

Reglas:
- Sé concreto, usa cifras del payload (formatea números grandes con separadores de miles).
- Compara contra el promedio RM cuando aporte (campo "comparisons").
- No inventes datos. Si un campo es null, omítelo.
- Máximo 220 palabras totales.
- No incluyas títulos H1.`;

    const userPrompt = `Datos de la isócrona:\n\n${JSON.stringify(compactAnalysis, null, 2)}\n\nPromedios RM de referencia:\n${JSON.stringify(rmAverages, null, 2)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, add credits to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    const summary: string =
      data?.choices?.[0]?.message?.content ?? "No se pudo generar el resumen.";

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("isochrone-insights error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
