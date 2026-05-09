import type { PoiMetric } from "@/types/poiMetrics";

export interface MetricAggregate {
  metricKey: string;
  format: string;
  totalAllTime: number;
  latest: { period: string; value: number } | null;
  yoy: number | null;
  mom: number | null;
  trailing12Sum: number;
  bestMonth: { period: string; value: number } | null;
  worstMonth: { period: string; value: number } | null;
  /** Serie completa ordenada (para graficar). */
  series: Array<{ period: string; value: number }>;
}

const sortByPeriod = (a: PoiMetric, b: PoiMetric) =>
  a.period < b.period ? -1 : a.period > b.period ? 1 : 0;

export const aggregateMetrics = (
  metrics: PoiMetric[],
  formatByKey: Record<string, string> = {},
): MetricAggregate[] => {
  const byKey = new Map<string, PoiMetric[]>();
  for (const m of metrics) {
    const arr = byKey.get(m.metric_key) ?? [];
    arr.push(m);
    byKey.set(m.metric_key, arr);
  }
  const out: MetricAggregate[] = [];
  byKey.forEach((arr, key) => {
    const sorted = [...arr].sort(sortByPeriod);
    const series = sorted.map((m) => ({ period: m.period, value: m.value }));
    const total = series.reduce((s, p) => s + p.value, 0);
    const latest = series.length ? series[series.length - 1] : null;

    // MoM
    let mom: number | null = null;
    if (series.length >= 2) {
      const prev = series[series.length - 2];
      const last = series[series.length - 1];
      if (prev.value > 0) mom = ((last.value - prev.value) / prev.value) * 100;
    }

    // YoY: comparar último mes con el mismo mes del año anterior
    let yoy: number | null = null;
    if (latest) {
      const [y, m] = latest.period.split("-").map(Number);
      const prevYear = `${y - 1}-${String(m).padStart(2, "0")}-01`;
      const prevSamePeriod = series.find((p) => p.period === prevYear);
      if (prevSamePeriod && prevSamePeriod.value > 0) {
        yoy = ((latest.value - prevSamePeriod.value) / prevSamePeriod.value) * 100;
      }
    }

    // Trailing 12 months sum (últimos 12 períodos disponibles)
    const trailing12 = series.slice(-12);
    const trailing12Sum = trailing12.reduce((s, p) => s + p.value, 0);

    // Mejor / peor mes
    let best = series[0] ?? null;
    let worst = series[0] ?? null;
    for (const p of series) {
      if (p.value > (best?.value ?? -Infinity)) best = p;
      if (p.value < (worst?.value ?? Infinity)) worst = p;
    }

    out.push({
      metricKey: key,
      format: formatByKey[key] ?? "decimal",
      totalAllTime: total,
      latest,
      yoy,
      mom,
      trailing12Sum,
      bestMonth: best,
      worstMonth: worst,
      series,
    });
  });
  return out;
};

/** Formato amigable de un valor según el format declarado. */
export const formatMetricValue = (value: number, format: string): string => {
  if (!isFinite(value)) return "—";
  const rounded = Math.round(value);
  if (format === "clp") return `$${rounded.toLocaleString("es-CL")}`;
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (format === "decimal") return value.toFixed(2);
  return rounded.toLocaleString("es-CL");
};

/** Etiqueta de período (YYYY-MM-DD → "Mar 2024"). */
export const formatPeriod = (period: string): string => {
  const [y, m] = period.split("-");
  const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const idx = parseInt(m, 10) - 1;
  return `${monthNames[idx] ?? m} ${y}`;
};
