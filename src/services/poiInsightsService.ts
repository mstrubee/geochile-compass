import { supabase } from "@/integrations/supabase/client";
import type { SavedPoi } from "@/types/pois";
import type { PoiAttribute } from "@/types/poiMetrics";
import type { MetricAggregate } from "@/utils/poiMetricsAggregate";

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
    aggregates: aggregates.map((a) => ({
      metricKey: a.metricKey,
      format: a.format,
      totalAllTime: Math.round(a.totalAllTime),
      latest: a.latest ? { period: a.latest.period, value: Math.round(a.latest.value) } : null,
      yoy: a.yoy != null ? Math.round(a.yoy * 10) / 10 : null,
      mom: a.mom != null ? Math.round(a.mom * 10) / 10 : null,
      trailing12Sum: Math.round(a.trailing12Sum),
      bestMonth: a.bestMonth ? { period: a.bestMonth.period, value: Math.round(a.bestMonth.value) } : null,
      worstMonth: a.worstMonth ? { period: a.worstMonth.period, value: Math.round(a.worstMonth.value) } : null,
    })),
    folderContext,
  };

  const { data, error } = await supabase.functions.invoke("poi-insights", {
    body: payload,
  });
  if (error) throw error;
  return data as { summary: string };
};
