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

interface MetricsAggregate {
  metricKey: string;
  format: string;
  totalAllTime: number;
  latest: { period: string; periodLabel?: string; value: number } | null;
  yoy: number | null;
  mom: number | null;
  trailing12Sum: number;
  bestMonth: { period: string; periodLabel?: string; value: number } | null;
  worstMonth: { period: string; periodLabel?: string; value: number } | null;
  recentSeries?: Array<{ period: string; periodLabel?: string; value: number }>;
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
    address?: string | null;
    comuna?: string | null;
    centro_sap?: string;
    gerente_zonal?: string;
    zona?: string;
    [k: string]: unknown;
  };
  salesContext?: SalesContext;
  aggregates: MetricsAggregate[];
  folderContext?: {
    folderName: string;
    poiCount: number;
    medianTrailing12?: number;
    topPercentile?: number;
  };
}

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MONTHS_ES_TO_NUM: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09",
  octubre: "10", noviembre: "11", diciembre: "12",
};
const monthMention =
  /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/gi;

const normalizePeriod = (period: string) => {
  const [y, m] = period.split("-");
  return `${y}-${String(parseInt(m, 10)).padStart(2, "0")}-01`;
};
const formatPeriodEs = (period: string) => {
  const [y, m] = period.split("-");
  const idx = parseInt(m, 10) - 1;
  return MESES_ES[idx] ? `${MESES_ES[idx]} ${y}` : period;
};
const fmtClp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/** Construye un salesContext desde aggregates si el cliente no lo envió. */
const deriveSalesContext = (payload: PoiSummaryPayload): SalesContext | null => {
  if (payload.salesContext?.latestRegisteredPeriod) return payload.salesContext;
  const ventas = payload.aggregates?.find((a) => a.metricKey === "ventas");
  if (!ventas?.latest) return null;
  const series = (ventas.recentSeries ?? []).map((p) => ({
    period: normalizePeriod(p.period),
    periodLabel: p.periodLabel ?? formatPeriodEs(p.period),
    value: Math.round(p.value),
  }));
  return {
    metricKey: "ventas",
    latestRegisteredPeriod: normalizePeriod(ventas.latest.period),
    latestRegisteredPeriodLabel: ventas.latest.periodLabel ?? formatPeriodEs(ventas.latest.period),
    availablePeriods: series.map((p) => p.period),
    recentSeries: series,
  };
};

/** Resumen seguro generado por código cuando el modelo alucina. */
const buildSafeSummary = (payload: PoiSummaryPayload, ctx: SalesContext | null): string => {
  const name = payload.poi?.name ?? "Local";
  const comuna = payload.poi?.comuna ? `, ${payload.poi.comuna}` : "";
  if (!ctx || !ctx.latestRegisteredPeriodLabel || ctx.recentSeries.length === 0) {
    return `**Perfil del local**\n${name}${comuna}.\n\n**Desempeño reciente**\nDatos insuficientes para análisis completo.`;
  }
  const last = ctx.recentSeries[ctx.recentSeries.length - 1];
  const prev = ctx.recentSeries[ctx.recentSeries.length - 2];
  const mom = prev && prev.value > 0
    ? ((last.value - prev.value) / prev.value) * 100
    : null;
  const momLine = mom != null
    ? ` (${mom >= 0 ? "+" : ""}${mom.toFixed(1)}% vs ${prev!.periodLabel})`
    : "";
  return [
    `**Perfil del local**`,
    `${name}${comuna}.`,
    ``,
    `**Desempeño reciente**`,
    `Último mes registrado: ${last.periodLabel} con ventas de ${fmtClp(last.value)}${momLine}.`,
    ``,
    `> Nota: el modelo generó información fuera del rango disponible y fue reemplazado por un resumen automático basado únicamente en los datos cargados.`,
  ].join("\n");
};

/** Devuelve true si el texto menciona meses que no están en availablePeriods. */
const mentionsInvalidMonths = (summary: string, ctx: SalesContext): boolean => {
  const allowed = new Set(ctx.availablePeriods.map(normalizePeriod));
  if (allowed.size === 0) return false;
  const latest = normalizePeriod(ctx.latestRegisteredPeriod!);
  let invalid = false;
  for (const match of summary.matchAll(monthMention)) {
    const month = match[1].toLowerCase();
    const year = match[2];
    const period = `${year}-${MONTHS_ES_TO_NUM[month]}-01`;
    if (period > latest || !allowed.has(period)) {
      invalid = true;
      break;
    }
  }
  return invalid;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FALLBACK_KEY = Deno.env.get("GEMINI_API_KEY") ?? undefined;
    const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";
    const admin = getAdminClient();

    let payload: PoiSummaryPayload;
    try {
      const raw = await req.text();
      payload = raw ? (JSON.parse(raw) as PoiSummaryPayload) : ({} as PoiSummaryPayload);
    } catch (_err) {
      payload = {} as PoiSummaryPayload;
    }
    if (!payload?.poi) {
      return new Response(
        JSON.stringify({ error: "Missing payload: poi is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!Array.isArray(payload.aggregates)) payload.aggregates = [];

    const ctx = deriveSalesContext(payload);
    payload.salesContext = ctx ?? undefined;

    // Si no hay ventas, no llamamos al modelo: devolvemos resumen seguro.
    if (!ctx) {
      return new Response(JSON.stringify({ summary: buildSafeSummary(payload, null) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const latestLabel = ctx.latestRegisteredPeriodLabel!;
    const allowedList = ctx.availablePeriods
      .map((p) => formatPeriodEs(p))
      .join(", ");

    const systemPrompt = `Eres un analista comercial experto en retail chileno. Produces un resumen ejecutivo en español, en Markdown, con secciones:

**Perfil del local** (1-2 frases con nombre, dirección, comuna, centro SAP/zona si aplica)
**Desempeño reciente** (último mes registrado + comparación MoM y YoY SOLO si las cifras están en los datos)
**Tendencia histórica** (TTM, mejor/peor mes histórico)
**Posicionamiento** (si hay folderContext)
**Recomendación** (1-2 bullets accionables)

Reglas CRÍTICAS, sin excepción:
- El ÚLTIMO mes registrado de ventas es: ${latestLabel}. Nunca menciones meses posteriores.
- Los ÚNICOS meses que puedes nombrar son: ${allowedList}.
- Ignora cualquier referencia a "target_year", año actual, año cerrado o meses no listados arriba.
- Usa cifras EXACTAS del JSON. No inventes números ni proyecciones.
- Formato CLP con separador de miles (ej: $108.469.704).
- Si un campo es null, omítelo. Máximo 200 palabras. Sin H1.`;

    const userPrompt = `Datos del local:\n\n${JSON.stringify(payload, null, 2)}`;

    let data: any;
    try {
      const result = await callGeminiWithRotation({
        model: MODEL,
        admin,
        fallbackEnvKey: FALLBACK_KEY,
        body: {
          systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
        },
      });
      data = result.data;
    } catch (err) {
      if (err instanceof AllGeminiKeysFailedError) {
        console.error("[poi-insights] all gemini keys failed", err.attempts);
        return new Response(
          JSON.stringify({
            error: "ALL_KEYS_FAILED",
            attempts: err.attempts,
            fallback: true,
            summary: buildSafeSummary(payload, ctx),
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw err;
    }

    const rawSummary: string =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("")
      ?? "";

    // Validación determinística: si menciona meses fuera del rango, reemplazar por resumen seguro.
    let summary = rawSummary.trim();
    if (!summary) {
      summary = buildSafeSummary(payload, ctx);
    } else if (mentionsInvalidMonths(summary, ctx)) {
      console.warn("poi-insights: model mentioned invalid months. Replacing with safe summary.");
      summary = buildSafeSummary(payload, ctx);
    }

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
