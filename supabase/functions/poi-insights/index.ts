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
  latest: { period: string; periodLabel?: string; value: number } | null;
  yoy: number | null; // % crecimiento últimos 12 vs 12 anteriores
  mom: number | null; // % crecimiento último mes vs mes anterior
  trailing12Sum: number; // ventas TTM
  bestMonth: { period: string; periodLabel?: string; value: number } | null;
  worstMonth: { period: string; periodLabel?: string; value: number } | null;
}

interface SalesContext {
  metricKey: string;
  latestRegisteredPeriod: string | null;
  latestRegisteredPeriodLabel: string | null;
  availablePeriods: string[];
  recentSeries: Array<{ period: string; periodLabel: string; value: number }>;
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
  salesContext?: SalesContext;
  aggregates: MetricsAggregate[];
  /** Métricas comparables agregadas a nivel carpeta. */
  folderContext?: {
    folderName: string;
    poiCount: number;
    medianTrailing12?: number;
    topPercentile?: number;
  };
}

const MONTHS_ES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

const monthMention = /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(20\d{2})\b/gi;

const normalizePeriod = (period: string) => {
  const [y, m] = period.split("-");
  return `${y}-${String(parseInt(m, 10)).padStart(2, "0")}-01`;
};

const periodFromMention = (month: string, year: string) => `${year}-${MONTHS_ES[month.toLowerCase()]}-01`;

const enforceAvailablePeriods = (summary: string, payload: PoiSummaryPayload): string => {
  const latest = payload.salesContext?.latestRegisteredPeriod
    ?? payload.aggregates?.map((a) => a.latest?.period).filter(Boolean).sort().at(-1)
    ?? null;
  if (!latest) return summary;

  const latestPeriod = normalizePeriod(latest);
  const latestLabel = payload.salesContext?.latestRegisteredPeriodLabel
    ?? payload.aggregates?.find((a) => a.latest?.period === latest)?.latest?.periodLabel
    ?? latestPeriod;
  const aggregatePeriods = payload.aggregates?.flatMap((a) =>
    [a.latest?.period, a.bestMonth?.period, a.worstMonth?.period]
      .filter((p): p is string => Boolean(p))
      .map(normalizePeriod),
  ) ?? [];
  const allowed = new Set([
    ...(payload.salesContext?.availablePeriods ?? []).map(normalizePeriod),
    ...aggregatePeriods,
  ]);

  let changed = false;
  const corrected = summary.replace(monthMention, (match, month: string, year: string) => {
    const mentionedPeriod = periodFromMention(month, year);
    if (mentionedPeriod > latestPeriod || (allowed.size > 0 && !allowed.has(mentionedPeriod))) {
      changed = true;
      return latestLabel;
    }
    return match;
  });

  return changed
    ? `${corrected}\n\n> Nota de validación: el último mes registrado en la base es ${latestLabel}; se corrigieron referencias fuera del rango disponible.`
    : corrected;
};

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
    const latestAvailableLabel = payload.salesContext?.latestRegisteredPeriodLabel
      ?? payload.aggregates.map((a) => a.latest?.periodLabel).filter(Boolean).at(-1)
      ?? "no informado";

    const systemPrompt = `Eres un analista comercial experto en retail chileno.
Recibes datos de un local: identidad y métricas históricas (ventas mensuales y similares).
Tu tarea es producir un resumen ejecutivo en español, en formato Markdown, con secciones:

**Perfil del local** (1-2 frases con nombre, dirección, comuna, centro SAP/zona si aplica)
**Desempeño reciente** (último mes con valor + comparación MoM y YoY si están disponibles)
**Tendencia histórica** (1-2 frases sobre TTM, mejor/peor mes histórico, picos)
**Posicionamiento** (si hay folderContext: cómo se compara con la mediana del grupo)
**Recomendación** (1-2 bullets accionables: oportunidad, riesgo, próxima acción)

Reglas CRÍTICAS:
- El último mes registrado de ventas es: ${latestAvailableLabel}. Ese límite viene desde salesContext.latestRegisteredPeriodLabel.
- NUNCA inventes meses, años ni cifras. Usa EXACTAMENTE los campos "periodLabel" / "latestRegisteredPeriodLabel" tal como aparecen en el JSON.
- El "último mes" SIEMPRE es \`salesContext.latestRegisteredPeriodLabel\` si existe; si no, \`aggregates[i].latest.periodLabel\`. No menciones ningún mes posterior a ese, aunque target_year sea posterior o hoy sea otra fecha. Los datos pueden tener rezago.
- target_year describe el año objetivo del modelo; NO significa que existan ventas hasta diciembre ni hasta el mes actual.
- Usa cifras formateadas (CLP con separadores de miles).
- Si un campo es null, omítelo. Si no hay datos suficientes, di "Datos insuficientes para análisis completo".
- Máximo 200 palabras totales. No incluyas títulos H1.`;

    const userPrompt = `Datos del local:\n\n${JSON.stringify(payload, null, 2)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
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
    const rawSummary: string =
      data?.choices?.[0]?.message?.content ?? "No se pudo generar el resumen.";
    const summary = enforceAvailablePeriods(rawSummary, payload);

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
