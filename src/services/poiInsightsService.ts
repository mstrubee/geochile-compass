import { supabase } from "@/integrations/supabase/client";
import type { SavedPoi } from "@/types/pois";
import type { PoiAttribute } from "@/types/poiMetrics";
import type { MetricAggregate } from "@/utils/poiMetricsAggregate";

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-04-01" → "abril 2026". Si no parsea, devuelve el string crudo. */
const formatPeriodEs = (period: string): string => {
  const [y, m] = period.split("-");
  const idx = parseInt(m, 10) - 1;
  if (!MESES_ES[idx] || !y) return period;
  return `${MESES_ES[idx]} ${y}`;
};

/**
 * Llama a la edge function `poi-insights` para generar un resumen ejecutivo.
 * Devuelve markdown listo para renderizar.
 */
export const fetchPoiInsights = async ({
  poi,
  attrs,
  aggregates,
  folderContext,
}: {
  poi: SavedPoi;
  attrs: PoiAttribute[];
  aggregates: MetricAggregate[];
  folderContext?: {
    folderName: string;
    poiCount: number;
    medianTrailing12?: number;
  };
}): Promise<{ summary: string }> => {
  const attrMap: Record<string, string> = {};
  for (const a of attrs) if (a.attr_value) attrMap[a.attr_key] = a.attr_value;

  const payload = {
    poi: {
      name: poi.name,
      address: (poi.properties as Record<string, unknown>)?.["Dirección"] as string ?? null,
      comuna: (poi.properties as Record<string, unknown>)?.["Comuna"] as string ?? null,
      centro_sap: attrMap["Centro Sap"],
      gerente_zonal: attrMap["Gerente Zonal"],
      zona: attrMap["Zona"],
      ...attrMap,
    },
    aggregates: aggregates.map((a) => {
      const fmt = (p: { period: string; value: number } | null) =>
        p ? { period: p.period, periodLabel: formatPeriodEs(p.period), value: Math.round(p.value) } : null;
      const tail = a.series.slice(-6).map((p) => ({
        period: p.period,
        periodLabel: formatPeriodEs(p.period),
        value: Math.round(p.value),
      }));
      return {
        metricKey: a.metricKey,
        format: a.format,
        totalAllTime: Math.round(a.totalAllTime),
        latest: fmt(a.latest),
        yoy: a.yoy != null ? Math.round(a.yoy * 10) / 10 : null,
        mom: a.mom != null ? Math.round(a.mom * 10) / 10 : null,
        trailing12Sum: Math.round(a.trailing12Sum),
        bestMonth: fmt(a.bestMonth),
        worstMonth: fmt(a.worstMonth),
        recentSeries: tail,
      };
    }),
    folderContext,
  };

  const { data, error } = await supabase.functions.invoke("poi-insights", {
    body: payload,
  });
  if (error) throw error;
  return data as { summary: string };
};
