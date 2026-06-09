import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  AllGeminiKeysFailedError,
  callGeminiWithRotation,
  getAdminClient,
} from "../_shared/gemini-keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const fmt = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value).toLocaleString("es-CL");
};

const pctText = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return null;
  return `${Math.round(value)}%`;
};

const extractRetryAfterMs = (detail: string) => {
  try {
    const parsed = JSON.parse(detail);
    const retryInfo = parsed?.error?.details?.find(
      (item: { "@type"?: string }) => item?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
    );
    const retryDelay = retryInfo?.retryDelay as string | undefined;
    if (retryDelay?.endsWith("s")) {
      return Math.max(1000, Math.round(Number.parseFloat(retryDelay) * 1000));
    }
  } catch {
    // noop
  }

  const messageMatch = detail.match(/Please retry in\s+([\d.]+)s/i);
  if (messageMatch) {
    return Math.max(1000, Math.round(Number.parseFloat(messageMatch[1]) * 1000));
  }

  return 30000;
};

const buildFallbackSummary = (analysis: any) => {
  const topGse = Object.entries(analysis?.gse?.classDistribution ?? {})
    .sort(([, a], [, b]) => Number(b) - Number(a))[0] as [string, number] | undefined;

  const positiveComparison = (analysis?.comparisons ?? []).find((item: any) => (item?.vsRmPct ?? 0) >= 10);
  const negativeComparison = (analysis?.comparisons ?? []).find((item: any) => (item?.vsRmPct ?? 0) <= -10);

  const strengths: string[] = [];
  const alerts: string[] = [];
  const recommendations: string[] = [];

  if ((analysis?.density?.serviceCoverageIndex ?? 0) >= 70) {
    strengths.push(`Buena cobertura de servicios, con un índice de ${fmt(analysis.density.serviceCoverageIndex)}.`);
  }
  if ((analysis?.territorialPoints?.total ?? 0) > 0) {
    strengths.push(`${fmt(analysis.territorialPoints.total)} puntos de interés detectados dentro de la isócrona.`);
  }
  if (positiveComparison) {
    strengths.push(`${positiveComparison.label} se ubica ${positiveComparison.vsRmPct}% sobre el promedio RM.`);
  }
  if ((analysis?.density?.serviceCoverageIndex ?? 0) < 35) {
    alerts.push(`Cobertura de servicios acotada, con índice ${fmt(analysis.density.serviceCoverageIndex)}.`);
  }
  if ((analysis?.gse?.hacinAvg ?? 0) >= 2.5) {
    alerts.push(`Se observa hacinamiento elevado (${analysis.gse.hacinAvg.toFixed(2)}).`);
  }
  if (negativeComparison) {
    alerts.push(`${negativeComparison.label} está ${negativeComparison.vsRmPct}% bajo el promedio RM.`);
  }

  if ((analysis?.density?.popPerKm2 ?? 0) >= 8000) {
    recommendations.push("Priorizar formatos de alta rotación y servicios de conveniencia.");
  } else {
    recommendations.push("Evaluar una propuesta de cobertura barrial con ticket medio controlado.");
  }
  if ((analysis?.gse?.classDistribution?.ABC1 ?? 0) + (analysis?.gse?.classDistribution?.C1 ?? 0) >= 35) {
    recommendations.push("Incorporar oferta premium y surtido diferenciado orientado a hogares de mayor ingreso.");
  } else {
    recommendations.push("Ajustar mix comercial a sensibilidad de precio y promociones recurrentes.");
  }
  recommendations.push("Usar este resumen como contingencia y reintentar el análisis IA cuando se libere cuota de Gemini.");

  // Lectura territorial del NSE — siempre incluida
  const topGseLabel = topGse?.[0] ?? "C3";
  const isHighNse = topGseLabel === "ABC1" || topGseLabel === "C1";
  const nseLecturaSection = `**Lectura territorial del NSE**
La distribución GSE está ponderada por **hogares**, no por área.
${isHighNse
  ? `En este caso NSE alto (${topGseLabel}) domina también en hogares, consistente con el patrón visual del mapa.`
  : `El mapa puede mostrar visualmente más manzanas ABC1 (azules/grandes), pero por hogares predomina **${topGseLabel}** (${pctText(topGse?.[1])}). Esto se debe a que:
- Manzana ABC1 típica: ~2.500 m² con ~6 hogares → 2 hog/1.000m² (casas unifamiliares)
- Manzana ${topGseLabel} típica: ~900 m² con ~60 hogares → 67 hog/1.000m² (edificios de dpto.)
Para análisis comercial, la distribución por hogares es la correcta: mide clientes potenciales, no metros cuadrados.`}`;

  return [
    `**Perfil socioeconómico** ${[
      analysis?.totals?.hh ? `${fmt(analysis.totals.hh)} hogares estimados` : null,
      analysis?.totals?.pop ? `${fmt(analysis.totals.pop)} personas` : null,
      analysis?.totals?.incomeAvgPerHh ? `ingreso promedio hogar ${fmt(analysis.totals.incomeAvgPerHh)} CLP` : null,
      topGse ? `predomina el segmento ${topGse[0]} (${pctText(topGse[1])}) por hogares` : null,
    ].filter(Boolean).join(", ")}.`,
    nseLecturaSection,
    `**Densidad y cobertura** ${[
      analysis?.area_km2 ? `${analysis.area_km2.toFixed(2)} km² de cobertura` : null,
      analysis?.density?.popPerKm2 ? `${fmt(analysis.density.popPerKm2)} hab/km²` : null,
      analysis?.density?.hhPerKm2 ? `${fmt(analysis.density.hhPerKm2)} hogares/km²` : null,
      analysis?.density?.serviceCoverageIndex != null ? `índice de cobertura ${fmt(analysis.density.serviceCoverageIndex)}` : null,
    ].filter(Boolean).join(", ")}.`,
    `**Fortalezas**\n${(strengths.length ? strengths : ["Base territorial con indicadores suficientes para una primera lectura operativa."]).map((item) => `- ${item}`).join("\n")}`,
    `**Alertas**\n${(alerts.length ? alerts : ["La cuota de Gemini impidió generar una lectura narrativa más fina en este momento."]).map((item) => `- ${item}`).join("\n")}`,
    `**Recomendaciones**\n${recommendations.map((item) => `- ${item}`).join("\n")}`,
  ].join("\n\n");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FALLBACK_KEY = Deno.env.get("GEMINI_API_KEY") ?? undefined;
    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
    const admin = getAdminClient();

    const { analysis, rmAverages } = await req.json();
    if (!analysis) {
      return new Response(JSON.stringify({ error: "Missing analysis payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Densidades típicas por NSE para que Gemini pueda construir el ejemplo comparativo.
    // Basado en datos Censo 2017/2024 RM: casas ABC1 vs edificios C3.
    const nseTypicalDensity = {
      ABC1: { area_m2: 2500, hog_per_manzana: 6,  hog_per_1000m2: 2 },
      C1:   { area_m2: 1800, hog_per_manzana: 18, hog_per_1000m2: 10 },
      C2:   { area_m2: 1200, hog_per_manzana: 30, hog_per_1000m2: 25 },
      C3:   { area_m2: 900,  hog_per_manzana: 60, hog_per_1000m2: 67 },
      D:    { area_m2: 700,  hog_per_manzana: 50, hog_per_1000m2: 71 },
      E:    { area_m2: 600,  hog_per_manzana: 35, hog_per_1000m2: 58 },
    };
    // NSE dominante por hogares vs el de mayor área típica
    const gseDist = analysis.gse?.classDistribution ?? {};
    const topGseByHh = Object.entries(gseDist).sort(([,a],[,b]) => Number(b)-Number(a))[0]?.[0] ?? "C3";

    const compactAnalysis = {
      bandMinutes: analysis.bandMinutes,
      area_km2: analysis.area_km2,
      totals: analysis.totals,
      density: analysis.density,
      gse: analysis.gse,
      // Contexto para la sección "Lectura territorial del NSE"
      nse_context: {
        nota: "classDistribution ponderado por HOGARES, no por área. Ver nseTypicalDensity.",
        nseTypicalDensity,
        topGseByHh,
        paradoja_esperada: topGseByHh !== "ABC1" && topGseByHh !== "C1"
          ? `Mapa puede mostrar más azul (ABC1) porque esas manzanas son físicamente más grandes, pero por hogares domina ${topGseByHh}.`
          : `NSE alto por hogares es consistente con manzanas de tamaño medio-grande.`,
      },
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

**Perfil socioeconómico** (2-3 frases sobre NSE, ingreso, escolaridad y composición)
**Lectura territorial del NSE** (OBLIGATORIO — ver instrucción abajo)
**Densidad y cobertura** (1-2 frases sobre densidad poblacional y servicios disponibles)
**Fortalezas** (2-3 bullets)
**Alertas** (2-3 bullets)
**Recomendaciones** (2-3 bullets para retail/servicios/inversión)

── INSTRUCCIÓN OBLIGATORIA: Lectura territorial del NSE ──
El campo gse.classDistribution está ponderado por HOGARES, no por área.
Esto puede generar aparente contradicción con el mapa: manzanas ABC1 se ven
grandes (son casas con lotes amplios) pero tienen pocos hogares por m².
Manzanas C3 se ven pequeñas (edificios de departamentos) pero concentran
muchos hogares por m². SIEMPRE incluye esta sección con:
1. Un ejemplo comparativo concreto usando las cifras reales del payload:
   "Ej: manzana ABC1 típica → X m² con ~Y hogares (Z hog/1.000m²)"
   "Ej: manzana C3 típica   → X m² con ~Y hogares (Z hog/1.000m²)"
   Estima X,Y,Z de forma razonable a partir de gse.classDistribution,
   density.popPerKm2, gse.hacinAvg y el patrón urbano conocido.
2. Una conclusión sobre qué métrica es más relevante para el negocio:
   "Para análisis comercial, la distribución por hogares es la correcta
    porque mide clientes potenciales, no metros cuadrados."
Si el NSE dominante en el payload coincide con lo esperable visualmente
(ej: ABC1 > 40%), igual incluye la sección pero nota que en este caso
área y hogares coinciden más.

── Reglas generales ──
- Sé concreto, usa cifras del payload (formatea números grandes con separadores de miles).
- Compara contra el promedio RM cuando aporte (campo "comparisons").
- No inventes datos. Si un campo es null, omítelo.
- Máximo 300 palabras totales.
- No incluyas títulos H1.`;

    const userPrompt = `Datos de la isócrona:\n\n${JSON.stringify(compactAnalysis, null, 2)}\n\nPromedios RM de referencia:\n${JSON.stringify(rmAverages, null, 2)}`;

    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4 },
    };
    const fallbackModels = [GEMINI_MODEL, "gemini-2.5-flash-lite", "gemini-1.5-flash"];

    let data: any = null;
    let lastError: AllGeminiKeysFailedError | null = null;
    for (const model of fallbackModels) {
      try {
        const result = await callGeminiWithRotation({
          model,
          admin,
          fallbackEnvKey: FALLBACK_KEY,
          body,
        });
        data = result.data;
        break;
      } catch (err) {
        if (err instanceof AllGeminiKeysFailedError) {
          lastError = err;
          // If everyone failed for THIS model, try next fallback model.
          continue;
        }
        throw err;
      }
    }

    if (!data) {
      const attempts = lastError?.attempts ?? [];
      const anyQuota = attempts.some((a) => a.reason === "quota" || a.reason === "rate_limit");
      const anyUnavailable = attempts.some((a) => a.reason === "unavailable");
      const lastDetail = attempts[attempts.length - 1]?.message ?? "";
      const summary = buildFallbackSummary(compactAnalysis);
      return new Response(
        JSON.stringify({
          error: anyQuota
            ? "RATE_LIMITED"
            : anyUnavailable
              ? "SERVICE_UNAVAILABLE"
              : "ALL_KEYS_FAILED",
          detail: lastDetail,
          attempts,
          fallback: true,
          retryAfterMs: anyQuota ? extractRetryAfterMs(lastDetail) : undefined,
          summary,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const summary: string =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ??
      "No se pudo generar el resumen.";

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
