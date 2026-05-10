import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Sparkles,
  FileSpreadsheet,
  X,
  RefreshCw,
} from "lucide-react";
import * as XLSX from "xlsx";
import type { SavedPoi } from "@/types/pois";
import { usePoiMetrics, usePoiAttributes } from "@/hooks/usePoiMetrics";
import {
  aggregateMetrics,
  formatMetricValue,
  formatPeriod,
  type MetricAggregate,
} from "@/utils/poiMetricsAggregate";
import { fetchPoiInsights } from "@/services/poiInsightsService";
import type { PoiFolderSchema } from "@/types/poiMetrics";
import { PoiAnalysisPanel } from "@/components/panels/PoiAnalysisPanel";

interface Props {
  open: boolean;
  onClose: () => void;
  poi: SavedPoi | null;
  schema: PoiFolderSchema | null;
  onRename?: (id: string, name: string) => Promise<void> | void;
  onKpiOrderChange?: (folderId: string, order: string[]) => Promise<void> | void;
  /** Lista de POIs del mismo chain para resolver nombres de peers en análisis. */
  chainPois?: SavedPoi[];
  /** Si es admin (para mostrar botón de recompute en el panel análisis). */
  isAdmin?: boolean;
  /** Callback para disparar recompute del análisis. */
  onRecomputeAnalysis?: () => void;
  /** Si el batch de recompute está corriendo. */
  recomputingAnalysis?: boolean;
}

export const PoiDetailDialog = ({
  open,
  onClose,
  poi,
  schema,
  onRename,
  onKpiOrderChange,
  chainPois = [],
  isAdmin = false,
  onRecomputeAnalysis,
  recomputingAnalysis = false,
}: Props) => {
  // Tabs principales: "Resumen" (toda la UI actual) | "Análisis" (panel Ridge)
  const [mainTab, setMainTab] = useState<"summary" | "analysis">("summary");
  const { metrics, loading: metricsLoading } = usePoiMetrics(poi?.id ?? null);
  const { attrs, loading: attrsLoading } = usePoiAttributes(poi?.id ?? null);
  const [insights, setInsights] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<"monthly" | "annual">("monthly");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const displayName = nameOverride ?? poi?.name ?? "POI";

  useEffect(() => {
    setNameOverride(null);
    setEditingName(false);
  }, [poi?.id]);

  const commitRename = async () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (!poi || !next || next === displayName) return;
    setNameOverride(next);
    try {
      await onRename?.(poi.id, next);
    } catch (e) {
      setNameOverride(null);
      toast.error(e instanceof Error ? e.message : "No se pudo renombrar");
    }
  };

  // Reset cuando cambia el POI
  useEffect(() => {
    if (open) {
      setInsights(null);
      setInsightsError(null);
    }
  }, [open, poi?.id]);

  const formatByKey = useMemo(() => {
    const out: Record<string, string> = {};
    if (schema?.metric_definitions) {
      for (const d of schema.metric_definitions) out[d.key] = d.format;
    }
    return out;
  }, [schema]);

  const aggregates = useMemo(
    () => aggregateMetrics(metrics, formatByKey),
    [metrics, formatByKey],
  );

  // Selecciona la primera métrica disponible al cargar
  useEffect(() => {
    if (aggregates.length > 0 && !activeMetric) {
      setActiveMetric(aggregates[0].metricKey);
    }
  }, [aggregates, activeMetric]);

  const rawActive = aggregates.find((a) => a.metricKey === activeMetric) ?? aggregates[0] ?? null;

  // Sanitiza: descarta meses futuros (no se inventan valores)
  const active = useMemo(() => {
    if (!rawActive) return null;
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const series = rawActive.series.filter((p) => p.period <= currentPeriod);
    const total = series.reduce((s, p) => s + p.value, 0);
    const latest = series.length ? series[series.length - 1] : null;
    let mom: number | null = null;
    if (series.length >= 2) {
      const prev = series[series.length - 2];
      const last = series[series.length - 1];
      if (prev.value > 0) mom = ((last.value - prev.value) / prev.value) * 100;
    }
    let yoy: number | null = null;
    if (latest) {
      const [y, m] = latest.period.split("-").map(Number);
      const prevYear = `${y - 1}-${String(m).padStart(2, "0")}-01`;
      const prev = series.find((p) => p.period === prevYear);
      if (prev && prev.value > 0) yoy = ((latest.value - prev.value) / prev.value) * 100;
    }
    const trailing12 = series.slice(-12);
    const trailing12Sum = trailing12.reduce((s, p) => s + p.value, 0);
    const avgLast12 = trailing12.length > 0 ? trailing12Sum / trailing12.length : null;

    // Promedio del último año calendario completado
    const lastCompletedYear = new Date().getFullYear() - 1;
    const yearSeries = series.filter((p) => p.period.startsWith(`${lastCompletedYear}-`));
    const avgLastCompletedYear =
      yearSeries.length === 12
        ? yearSeries.reduce((s, p) => s + p.value, 0) / 12
        : null;

    let best = series[0] ?? null;
    let worst = series[0] ?? null;
    for (const p of series) {
      if (p.value > (best?.value ?? -Infinity)) best = p;
      if (p.value < (worst?.value ?? Infinity)) worst = p;
    }
    return {
      ...rawActive,
      series,
      totalAllTime: total,
      latest,
      mom,
      yoy,
      trailing12Sum,
      bestMonth: best,
      worstMonth: worst,
      avgLast12,
      avgLastCompletedYear,
      lastCompletedYear,
    };
  }, [rawActive]);

  // Series anuales (suma por año calendario)
  const annualSeries = useMemo(() => {
    if (!active) return [] as Array<{ year: string; value: number; avg: number; complete: boolean; months: { period: string; value: number }[] }>;
    const map = new Map<string, { sum: number; months: { period: string; value: number }[] }>();
    for (const p of active.series) {
      const y = p.period.slice(0, 4);
      const cur = map.get(y) ?? { sum: 0, months: [] };
      cur.sum += p.value;
      cur.months.push(p);
      map.set(y, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([year, { sum, months }]) => ({
        year,
        value: sum,
        avg: months.length > 0 ? sum / months.length : 0,
        complete: months.length === 12,
        months,
      }));
  }, [active]);

  const [yearDetail, setYearDetail] = useState<typeof annualSeries[number] | null>(null);

  const labelByKey = useMemo(() => {
    const out: Record<string, string> = {};
    if (schema?.metric_definitions) {
      for (const d of schema.metric_definitions) out[d.key] = d.label;
    }
    return out;
  }, [schema]);

  const handleGenerateInsights = async () => {
    if (!poi) return;
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const r = await fetchPoiInsights({
        poi,
        attrs,
        aggregates,
      });
      setInsights(r.summary);
    } catch (e) {
      setInsightsError(
        e instanceof Error ? e.message : "Error al generar el resumen",
      );
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleExport = () => {
    if (!poi || aggregates.length === 0) return;
    const wb = XLSX.utils.book_new();

    // Hoja resumen
    const resumen: (string | number | null)[][] = [
      ["Detalle de POI"],
      ["Nombre", poi.name],
      ["Lat", poi.lat],
      ["Lng", poi.lng],
      [],
      ["Atributos"],
      ...attrs.map((a) => [a.attr_key, a.attr_value ?? ""]),
      [],
      ["Resumen de métricas"],
      ["Métrica", "Total histórico", "Último valor", "Período último", "MoM %", "YoY %", "TTM"],
    ];
    for (const a of aggregates) {
      resumen.push([
        labelByKey[a.metricKey] ?? a.metricKey,
        Math.round(a.totalAllTime),
        a.latest ? Math.round(a.latest.value) : null,
        a.latest?.period ?? "",
        a.mom != null ? Number(a.mom.toFixed(1)) : null,
        a.yoy != null ? Number(a.yoy.toFixed(1)) : null,
        Math.round(a.trailing12Sum),
      ]);
    }
    const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
    wsResumen["!cols"] = Array.from({ length: 7 }, () => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

    // Una hoja por métrica con la serie completa
    for (const a of aggregates) {
      const aoa: (string | number)[][] = [
        ["Período", labelByKey[a.metricKey] ?? a.metricKey],
        ...a.series.map((p) => [p.period, p.value]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 14 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, sanitize(`Serie ${a.metricKey}`));
    }
    XLSX.writeFile(wb, `poi-${poi.name.replace(/[^a-zA-Z0-9-]/g, "_")}.xlsx`);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border/40 px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: poi?.color ?? "#34D399" }}
            />
            {editingName ? (
              <Input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="h-7 text-[15px] font-semibold"
              />
            ) : (
              <span
                onDoubleClick={() => {
                  if (!poi || !onRename) return;
                  setNameDraft(displayName);
                  setEditingName(true);
                }}
                title={onRename ? "Doble clic para renombrar" : undefined}
                className={onRename ? "cursor-text" : undefined}
              >
                {displayName}
              </span>
            )}
          </DialogTitle>
          {poi && (
            <div className="text-[11px] text-muted-foreground">
              {(poi.properties as Record<string, unknown>)?.["Dirección"] as string ?? ""}
              {(poi.properties as Record<string, unknown>)?.["Comuna"]
                ? ` · ${(poi.properties as Record<string, unknown>)["Comuna"] as string}`
                : ""}
            </div>
          )}
        </DialogHeader>

        {/* Main tabs: Resumen | Análisis */}
        <div className="border-b border-border/30 px-5 pt-2">
          <div className="inline-flex rounded-lg bg-surface-2/60 p-0.5">
            {([
              { id: "summary" as const, label: "Resumen" },
              { id: "analysis" as const, label: "Análisis" },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setMainTab(t.id)}
                className={[
                  "rounded-md px-3 py-1 text-[11px] font-medium transition-all",
                  mainTab === t.id
                    ? "bg-surface-3 text-foreground shadow-apple-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="scrollbar-thin flex max-h-[calc(92vh-150px)] flex-col overflow-y-auto">
          {/* === ANALYSIS TAB === */}
          {mainTab === "analysis" && poi && (
            <PoiAnalysisPanel
              poi={poi}
              chainPois={chainPois}
              isAdmin={isAdmin}
              onRecompute={onRecomputeAnalysis}
              recomputing={recomputingAnalysis}
            />
          )}

          {/* === SUMMARY TAB === (UI existente) */}
          {mainTab === "summary" && ((metricsLoading || attrsLoading) && metrics.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-[11px] text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando datos…
            </div>
          ) : aggregates.length === 0 && attrs.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center gap-2 px-4 text-center text-[12px] text-muted-foreground">
              <div>Este POI no tiene datos cargados.</div>
              <div className="text-[11px]">
                Importa un Excel desde el menú de la carpeta para comenzar.
              </div>
            </div>
          ) : (
            <div className="px-5 py-4">
              {/* Atributos */}
              {attrs.length > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3">
                  {attrs
                    .filter((a) => a.attr_value)
                    .slice(0, 6)
                    .map((a) => (
                      <div key={a.attr_key} className="rounded-lg bg-surface-2/60 px-3 py-2">
                        <div className="text-[10px] text-muted-foreground">{a.attr_key}</div>
                        <div className="truncate text-[12px] font-medium">{a.attr_value}</div>
                      </div>
                    ))}
                </div>
              )}

              {/* Tabs de métricas si hay >1 */}
              {aggregates.length > 1 && (
                <div className="mb-3 inline-flex rounded-lg bg-surface-2/60 p-0.5">
                  {aggregates.map((a) => (
                    <button
                      key={a.metricKey}
                      onClick={() => setActiveMetric(a.metricKey)}
                      className={[
                        "rounded-md px-3 py-1 text-[11px] font-medium transition-all",
                        activeMetric === a.metricKey
                          ? "bg-surface-3 text-foreground shadow-apple-sm"
                          : "text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      {labelByKey[a.metricKey] ?? a.metricKey}
                    </button>
                  ))}
                </div>
              )}

              {/* KPIs */}
              {active && (
                <MetricKpis
                  active={active}
                  formatLabel={labelByKey[active.metricKey] ?? active.metricKey}
                  initialOrder={schema?.kpi_order ?? null}
                  onOrderChange={
                    schema && onKpiOrderChange
                      ? (next) => onKpiOrderChange(schema.folder_id, next)
                      : undefined
                  }
                />
              )}

              {/* Gráfico */}
              {active && active.series.length > 0 && (
                <div className="mt-4 rounded-xl border border-border/30 bg-surface-2/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {chartMode === "monthly"
                        ? `Serie mensual · ${active.series.length} períodos`
                        : `Ventas anuales · ${annualSeries.length} año${annualSeries.length === 1 ? "" : "s"}`}
                    </div>
                    <div className="inline-flex rounded-md bg-surface-2/60 p-0.5">
                      <button
                        onClick={() => setChartMode("monthly")}
                        className={[
                          "rounded px-2 py-0.5 text-[10px] font-medium transition-all",
                          chartMode === "monthly"
                            ? "bg-surface-3 text-foreground shadow-apple-sm"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        Mensual
                      </button>
                      <button
                        onClick={() => setChartMode("annual")}
                        className={[
                          "rounded px-2 py-0.5 text-[10px] font-medium transition-all",
                          chartMode === "annual"
                            ? "bg-surface-3 text-foreground shadow-apple-sm"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        Anual
                      </button>
                    </div>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      {chartMode === "monthly" ? (
                        <LineChart data={active.series} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                          <CartesianGrid stroke="hsl(var(--border) / 0.3)" strokeDasharray="3 3" />
                          <XAxis
                            dataKey="period"
                            tick={{ fontSize: 10 }}
                            tickFormatter={(v) => formatPeriod(v).replace(/ \d{4}/, (m) => m.slice(-3))}
                            interval="preserveStartEnd"
                            minTickGap={24}
                          />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            tickFormatter={(v) =>
                              active.format === "clp"
                                ? `${(v / 1_000_000).toFixed(0)}M`
                                : v.toLocaleString("es-CL")
                            }
                          />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--background))",
                              border: "1px solid hsl(var(--border) / 0.3)",
                              borderRadius: 8,
                              fontSize: 11,
                            }}
                            labelFormatter={(v) => formatPeriod(String(v))}
                            formatter={(v: number) => [formatMetricValue(v, active.format), labelByKey[active.metricKey] ?? active.metricKey]}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="hsl(217 91% 55%)"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        </LineChart>
                      ) : (
                        <BarChart data={annualSeries} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                          <CartesianGrid stroke="hsl(var(--border) / 0.3)" strokeDasharray="3 3" />
                          <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            tickFormatter={(v) =>
                              active.format === "clp"
                                ? `${(v / 1_000_000).toFixed(0)}M`
                                : v.toLocaleString("es-CL")
                            }
                          />
                          <Tooltip
                            cursor={{ fill: "hsl(var(--border) / 0.2)" }}
                            content={({ active: isActive, payload }) => {
                              if (!isActive || !payload || !payload.length) return null;
                              const p = payload[0].payload as { year: string; value: number; avg: number; complete: boolean; months: unknown[] };
                              return (
                                <div className="rounded-md border border-border/40 bg-background px-2.5 py-2 text-[11px] shadow-md">
                                  <div className="mb-1 font-medium">
                                    Año {p.year}{!p.complete ? ` (${p.months.length}/12)` : ""}
                                  </div>
                                  <div className="text-muted-foreground">
                                    Total: <span className="font-mono text-foreground">{formatMetricValue(p.value, active.format)}</span>
                                  </div>
                                  <div className="text-muted-foreground">
                                    Promedio mensual: <span className="font-mono text-foreground">{formatMetricValue(p.avg, active.format)}</span>
                                  </div>
                                  <div className="mt-1 text-[10px] text-muted-foreground">Click para ver detalle mes a mes</div>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="value"
                            fill="hsl(217 91% 55%)"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(data) => {
                              const p = (data as { payload?: typeof annualSeries[number] }).payload;
                              if (p) setYearDetail(p);
                            }}
                          />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </div>
              )}


              {/* Resumen ejecutivo */}
              <div className="mt-4 rounded-xl border border-border/30 bg-surface-2/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <div className="text-[12px] font-medium">Resumen ejecutivo (IA)</div>
                  </div>
                  <Button
                    size="sm"
                    variant={insights ? "outline" : "default"}
                    className="h-7 text-[11px]"
                    onClick={handleGenerateInsights}
                    disabled={insightsLoading || aggregates.length === 0}
                  >
                    {insightsLoading ? (
                      <>
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        Generando…
                      </>
                    ) : insights ? (
                      <>
                        <RefreshCw className="mr-1.5 h-3 w-3" />
                        Regenerar
                      </>
                    ) : (
                      "Generar"
                    )}
                  </Button>
                </div>
                {insightsError && (
                  <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-[10px] text-destructive">
                    {insightsError}
                  </div>
                )}
                {insights ? (
                  <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-foreground">
                    <SimpleMarkdown markdown={insights} />
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    Genera un resumen con IA en base a los datos actuales del local.
                  </div>
                )}
              </div>

              {/* Tabla histórica reducida */}
              {active && active.series.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-[11px] font-medium text-muted-foreground">
                    Histórico (últimos 24 meses)
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border/30">
                    <div className="grid grid-cols-2 bg-surface-2/60 text-[10px] font-medium text-muted-foreground">
                      <div className="px-3 py-1.5">Período</div>
                      <div className="px-3 py-1.5 text-right">Valor</div>
                    </div>
                    {[...active.series].reverse().slice(0, 24).map((p) => (
                      <div
                        key={p.period}
                        className="grid grid-cols-2 border-t border-border/30 text-[11px]"
                      >
                        <div className="px-3 py-1">{formatPeriod(p.period)}</div>
                        <div className="px-3 py-1 text-right font-mono">
                          {formatMetricValue(p.value, active.format)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-between border-t border-border/40 bg-surface-2/40 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cerrar
          </Button>
          {aggregates.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
              Exportar Excel
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {yearDetail && active && (
      <Dialog open onOpenChange={(o) => !o && setYearDetail(null)}>
        <DialogContent className="max-w-md p-0">
          <DialogHeader className="border-b border-border/40 px-5 pb-3 pt-4">
            <DialogTitle className="text-[14px] font-semibold tracking-tight">
              Detalle mensual · Año {yearDetail.year}
              {!yearDetail.complete && (
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  ({yearDetail.months.length}/12 meses)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 px-5 py-3">
            <div className="rounded-lg bg-surface-2/60 px-3 py-2">
              <div className="text-[16px] font-semibold leading-none tracking-tight">
                {formatMetricValue(yearDetail.value, active.format)}
              </div>
              <div className="mt-1.5 text-[10px] text-muted-foreground">Total del año</div>
            </div>
            <div className="rounded-lg bg-surface-2/60 px-3 py-2">
              <div className="text-[16px] font-semibold leading-none tracking-tight">
                {formatMetricValue(yearDetail.avg, active.format)}
              </div>
              <div className="mt-1.5 text-[10px] text-muted-foreground">Promedio mensual</div>
            </div>
          </div>
          <div className="scrollbar-thin max-h-[60vh] overflow-y-auto px-5 pb-4">
            <div className="rounded-lg border border-border/30">
              <div className="grid grid-cols-2 bg-surface-2/60 text-[10px] font-medium text-muted-foreground">
                <div className="px-3 py-1.5">Mes</div>
                <div className="px-3 py-1.5 text-right">Valor</div>
              </div>
              {yearDetail.months.map((m) => (
                <div
                  key={m.period}
                  className="grid grid-cols-2 border-t border-border/30 text-[11px]"
                >
                  <div className="px-3 py-1">{formatPeriod(m.period)}</div>
                  <div className="px-3 py-1 text-right font-mono">
                    {formatMetricValue(m.value, active.format)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
};

type ActiveAggregate = MetricAggregate & {
  avgLast12: number | null;
  avgLastCompletedYear: number | null;
  lastCompletedYear: number;
};

const DEFAULT_KPI_ORDER = ["latest", "mom", "yoy", "ttm", "avg12", "avgYear"] as const;
type KpiId = (typeof DEFAULT_KPI_ORDER)[number];

const normalizeOrder = (raw: unknown): KpiId[] => {
  const arr = Array.isArray(raw) ? (raw as string[]) : [];
  const valid = arr.filter((k): k is KpiId =>
    (DEFAULT_KPI_ORDER as readonly string[]).includes(k),
  );
  const missing = DEFAULT_KPI_ORDER.filter((k) => !valid.includes(k));
  return [...valid, ...missing];
};

const MetricKpis = ({
  active,
  formatLabel,
  initialOrder,
  onOrderChange,
}: {
  active: ActiveAggregate;
  formatLabel: string;
  initialOrder: string[] | null;
  onOrderChange?: (next: string[]) => Promise<void> | void;
}) => {
  const [order, setOrder] = useState<KpiId[]>(() => normalizeOrder(initialOrder));
  // Si llega un nuevo orden desde el servidor (otro POI / refresh), lo sincronizamos
  useEffect(() => {
    setOrder(normalizeOrder(initialOrder));
  }, [initialOrder]);
  const dragId = useRef<KpiId | null>(null);

  const persist = (next: KpiId[]) => {
    setOrder(next);
    void onOrderChange?.(next);
  };

  const onDrop = (target: KpiId) => {
    const src = dragId.current;
    dragId.current = null;
    if (!src || src === target) return;
    const next = order.filter((k) => k !== src);
    const idx = next.indexOf(target);
    next.splice(idx, 0, src);
    persist(next);
  };

  const cards: Record<KpiId, ReactNode> = {
    latest: (
      <>
        <div className="text-[16px] font-semibold leading-none tracking-tight">
          {active.latest ? formatMetricValue(active.latest.value, active.format) : "—"}
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          {active.latest ? `Último mes · ${formatPeriod(active.latest.period)}` : "Sin datos"}
        </div>
      </>
    ),
    mom: (
      <>
        <div className="flex items-center gap-1.5">
          {active.mom != null && active.mom >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-brand-green" />
          ) : active.mom != null ? (
            <TrendingDown className="h-3.5 w-3.5 text-destructive" />
          ) : null}
          <div
            className={[
              "text-[16px] font-semibold leading-none tracking-tight",
              active.mom == null ? "" : active.mom >= 0 ? "text-brand-green" : "text-destructive",
            ].join(" ")}
          >
            {active.mom != null ? `${active.mom > 0 ? "+" : ""}${active.mom.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">vs mes anterior</div>
      </>
    ),
    yoy: (
      <>
        <div className="flex items-center gap-1.5">
          {active.yoy != null && active.yoy >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-brand-green" />
          ) : active.yoy != null ? (
            <TrendingDown className="h-3.5 w-3.5 text-destructive" />
          ) : null}
          <div
            className={[
              "text-[16px] font-semibold leading-none tracking-tight",
              active.yoy == null ? "" : active.yoy >= 0 ? "text-brand-green" : "text-destructive",
            ].join(" ")}
          >
            {active.yoy != null ? `${active.yoy > 0 ? "+" : ""}${active.yoy.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">vs mismo mes año anterior</div>
      </>
    ),
    ttm: (
      <>
        <div className="text-[16px] font-semibold leading-none tracking-tight">
          {formatMetricValue(active.trailing12Sum, active.format)}
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">{formatLabel} TTM (suma 12m)</div>
      </>
    ),
    avg12: (
      <>
        <div className="text-[16px] font-semibold leading-none tracking-tight">
          {active.avgLast12 != null ? formatMetricValue(active.avgLast12, active.format) : "—"}
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">Promedio últimos 12 meses</div>
      </>
    ),
    avgYear: (
      <>
        <div className="text-[16px] font-semibold leading-none tracking-tight">
          {active.avgLastCompletedYear != null
            ? formatMetricValue(active.avgLastCompletedYear, active.format)
            : "—"}
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          Promedio mensual {active.lastCompletedYear}
        </div>
      </>
    ),
  };

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {order.map((id) => (
        <div
          key={id}
          draggable
          onDragStart={(e) => {
            dragId.current = id;
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDrop(id);
          }}
          className="cursor-grab rounded-xl bg-surface-2/60 px-3 py-2.5 active:cursor-grabbing transition-shadow hover:ring-1 hover:ring-border/50"
          title="Arrastra para reordenar"
        >
          {cards[id]}
        </div>
      ))}
    </div>
  );
};


/** Render mínimo de markdown — sólo bold (**text**) y bullets (`- `). */
const SimpleMarkdown = ({ markdown }: { markdown: string }) => {
  const lines = markdown.split("\n");
  return (
    <div>
      {lines.map((ln, i) => {
        const trimmed = ln.trim();
        if (!trimmed) return <div key={i} className="h-2" />;
        // Render bold como spans
        const renderInline = (s: string) => {
          const parts = s.split(/(\*\*[^*]+\*\*)/g);
          return parts.map((p, idx) =>
            p.startsWith("**") && p.endsWith("**") ? (
              <strong key={idx}>{p.slice(2, -2)}</strong>
            ) : (
              <span key={idx}>{p}</span>
            ),
          );
        };
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={i} className="ml-3 flex gap-1.5">
              <span className="text-primary">•</span>
              <span>{renderInline(trimmed.slice(2))}</span>
            </div>
          );
        }
        if (/^#{1,6} /.test(trimmed)) {
          return (
            <div key={i} className="mt-1 font-semibold">
              {renderInline(trimmed.replace(/^#{1,6}\s+/, ""))}
            </div>
          );
        }
        return <div key={i}>{renderInline(trimmed)}</div>;
      })}
    </div>
  );
};

const sanitize = (s: string) => s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
