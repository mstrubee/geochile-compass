import { X, Download, FileJson, Sparkles, RefreshCw, Loader2, ChevronDown, ChevronRight, ShoppingCart } from "lucide-react";
import { GastoEndogenoSection } from "./GastoEndogenoSection";
import { useCommercialCount } from "@/hooks/useCommercialCount";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Isochrone } from "@/types/isochrones";
import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import { useIsochroneAnalysis } from "@/hooks/useIsochroneAnalysis";
import { useIsochroneInsights } from "@/hooks/useIsochroneInsights";
import { useParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";
import type { ManzanaFeatureCollection } from "@/types/manzanas";

interface AnalysisPanelProps {
  open: boolean;
  onClose: () => void;
  isochrone: Isochrone | null;
  manzanas?: ManzanaFeatureCollection | null;
  width?: number;
  onWidthChange?: (w: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const fmtCLP = (n: number) => `$${fmt(n)}`;

const NSE_COLORS: Record<string, string> = {
  ABC1: "bg-[hsl(224_76%_38%)]",
  C1: "bg-[hsl(217_91%_55%)]",
  C2: "bg-[hsl(217_91%_55%)]",
  C3: "bg-brand-yellow",
  D: "bg-brand-orange",
  E: "bg-brand-red",
};

const formatComparison = (value: number, format: "int" | "clp" | "pct" | "decimal") => {
  switch (format) {
    case "clp": return fmtCLP(value);
    case "pct": return `${Math.round(value)}%`;
    case "decimal": return value.toFixed(1);
    default: return fmt(value);
  }
};

const exportJson = (a: IsochroneAnalysis, summary: string | null) => {
  const blob = new Blob([JSON.stringify({ ...a, aiSummary: summary }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement("a");
  a2.href = url;
  a2.download = `isocrona-${a.isoId}-${a.bandMinutes}min.json`;
  a2.click();
  URL.revokeObjectURL(url);
};

const exportCsv = (a: IsochroneAnalysis) => {
  const lines: string[] = [];
  lines.push("seccion,clave,valor");
  lines.push(`totales,banda_min,${a.bandMinutes}`);
  lines.push(`totales,area_km2,${a.area_km2.toFixed(3)}`);
  lines.push(`totales,personas,${a.totals.pop}`);
  lines.push(`totales,hogares,${a.totals.hh}`);
  lines.push(`totales,ingreso_total_clp,${a.totals.incomeTotal}`);
  lines.push(`totales,ingreso_promedio_hogar_clp,${a.totals.incomeAvgPerHh}`);
  lines.push(`totales,fuente,${a.totals.source}`);
  lines.push(`densidad,pop_por_km2,${a.density.popPerKm2}`);
  lines.push(`densidad,hh_por_km2,${a.density.hhPerKm2}`);
  lines.push(`densidad,puntos_por_km2,${a.density.pointsPerKm2}`);
  lines.push(`densidad,cobertura_servicios_idx,${a.density.serviceCoverageIndex}`);
  if (a.gse) {
    lines.push(`gse,manzanas,${a.gse.manzanaCount}`);
    if (a.gse.nseScoreAvg != null) lines.push(`gse,nse_score_promedio,${a.gse.nseScoreAvg}`);
    if (a.gse.educYearsAvg != null) lines.push(`gse,escolaridad_anos,${a.gse.educYearsAvg}`);
    if (a.gse.hacinAvg != null) lines.push(`gse,hacinamiento,${a.gse.hacinAvg}`);
    for (const [k, v] of Object.entries(a.gse.classDistribution)) {
      lines.push(`gse_clase,${k},${v}%`);
    }
  }
  for (const c of a.comparisons) {
    lines.push(`comparativo,${c.label},${c.value}${c.vsRmPct != null ? ` (${c.vsRmPct >= 0 ? "+" : ""}${c.vsRmPct}% vs RM)` : ""}`);
  }
  lines.push(`puntos,total,${a.territorialPoints.total}`);
  for (const g of a.territorialPoints.groups) {
    lines.push(`puntos_grupo,${g.groupName},${g.count}`);
    for (const l of g.layers) {
      lines.push(`puntos_capa,${g.groupName} > ${l.layerName},${l.count}`);
    }
  }
  for (const c of a.communes) {
    lines.push(
      `comuna,${c.name},pob=${Math.round(c.popInIso)};hh=${Math.round(c.hhInIso)};ingreso=${Math.round(c.incomeInIso)};share=${(c.areaShareInIso * 100).toFixed(1)}%`,
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement("a");
  a2.href = url;
  a2.download = `isocrona-${a.isoId}-${a.bandMinutes}min.csv`;
  a2.click();
  URL.revokeObjectURL(url);
};

type SectionKey =
  | "isocronas"
  | "comparativo"
  | "resumen_ia"
  | "gse"
  | "nse"
  | "gasto_endogeno"
  | "capas"
  | "parque"
  | "comunas"
  | "exportar";

const DEFAULT_SECTION_OPEN: Record<SectionKey, boolean> = {
  isocronas: true,
  gse: true,
  nse: true,
  gasto_endogeno: true,
  comparativo: false,
  resumen_ia: false,
  capas: false,
  parque: false,
  comunas: false,
  exportar: false,
};

export const AnalysisPanel = ({ open, onClose, isochrone, manzanas = null, width = 380, onWidthChange, minWidth = 320, maxWidth = 800 }: AnalysisPanelProps) => {
  const minutesAvailable = useMemo(
    () => (isochrone ? [...isochrone.minutes].sort((a, b) => a - b) : []),
    [isochrone],
  );
  const [tab, setTab] = useState(0);
  const selectedMin = minutesAvailable[Math.min(tab, minutesAvailable.length - 1)] ?? null;
  const bandSeconds = selectedMin != null ? selectedMin * 60 : undefined;

  const analysis = useIsochroneAnalysis({ isochrone, bandSeconds, manzanas });
  const insights = useIsochroneInsights(analysis, open);

  // Isócrona activa (misma banda que el análisis)
  const isoFeatureActive = useMemo(
    () => isochrone?.features.find((f) => f.properties?.value === bandSeconds)
       ?? isochrone?.features[tab]
       ?? isochrone?.features[0]
       ?? null,
    [isochrone, bandSeconds, tab],
  );

  // Conteo de atractores comerciales OSM dentro de la isócrona
  const commercialCount = useCommercialCount(isoFeatureActive);

  // Estado de secciones colapsadas/expandidas. Se resetea cuando cambia la isócrona.
  const [sectionOpen, setSectionOpen] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTION_OPEN);
  useEffect(() => {
    setSectionOpen(DEFAULT_SECTION_OPEN);
  }, [isochrone?.id]);
  const toggleSection = (k: SectionKey) =>
    setSectionOpen((s) => ({ ...s, [k]: !s[k] }));

  const nseDist = useMemo(() => {
    if (!analysis) return [] as { label: string; pct: number; color: string }[];
    // Prefer GSE class distribution if available (más detallado y reciente)
    if (analysis.gse && Object.keys(analysis.gse.classDistribution).length > 0) {
      return (["ABC1", "C1", "C2", "C3", "D", "E"] as const)
        .map((label) => ({
          label,
          pct: Math.round(analysis.gse!.classDistribution[label] ?? 0),
          color: NSE_COLORS[label] ?? "bg-surface-3",
        }))
        .filter((r) => r.pct > 0);
    }
    if (analysis.manzanas && Object.keys(analysis.manzanas.nseDistribution).length > 0) {
      const total = Object.values(analysis.manzanas.nseDistribution).reduce(
        (s, v) => s + (v ?? 0),
        0,
      );
      if (total <= 0) return [];
      const labelMap: Record<number, string> = { 1: "E", 2: "D", 3: "C3", 4: "C2", 5: "ABC1" };
      return (["ABC1", "C2", "C3", "D", "E"] as const).map((label) => {
        const numKey = Object.entries(labelMap).find(([, v]) => v === label)?.[0];
        const v = numKey ? analysis.manzanas!.nseDistribution[Number(numKey) as 1 | 2 | 3 | 4 | 5] ?? 0 : 0;
        return { label, pct: Math.round((v / total) * 100), color: NSE_COLORS[label] };
      });
    }
    const counts: Record<string, number> = {};
    let total = 0;
    for (const c of analysis.communes) {
      if (!c.nse) continue;
      counts[c.nse] = (counts[c.nse] ?? 0) + c.hhInIso;
      total += c.hhInIso;
    }
    if (total <= 0) return [];
    return (["ABC1", "C2", "C3", "D", "E"] as const).map((label) => ({
      label,
      pct: Math.round(((counts[label] ?? 0) / total) * 100),
      color: NSE_COLORS[label],
    }));
  }, [analysis]);

  const nseSource = analysis?.gse
    ? "GSE manzana (Censo 2012)"
    : analysis?.totals.source === "manzanas"
      ? "Manzanas Censo 2017"
      : "Comunal";

  // Drag handler para redimensionar el panel desde su borde izquierdo.
  const resizingRef = useRef(false);
  useEffect(() => {
    if (!onWidthChange) return;
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      // El panel está pegado al borde derecho de la ventana; ancho = viewport - clientX.
      const next = window.innerWidth - e.clientX;
      onWidthChange(next);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onWidthChange]);
  const startResize = (e: React.MouseEvent) => {
    if (!onWidthChange) return;
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      style={{ width }}
      className={[
        "absolute right-0 top-0 z-[600] flex h-full flex-col border-l border-border/60 bg-surface/85 backdrop-blur-2xl backdrop-saturate-150 transition-transform duration-300",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
    >
      {onWidthChange && open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar panel"
          onMouseDown={startResize}
          className="group absolute left-0 top-0 z-10 flex h-full w-1.5 -translate-x-1/2 cursor-col-resize items-center justify-center hover:bg-primary/20"
        >
          <span className="h-10 w-[3px] rounded-full bg-border/60 transition-colors group-hover:bg-primary" />
        </div>
      )}
      <div className="relative flex-shrink-0 border-b border-border/40 px-5 pb-3 pt-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: isochrone?.color ?? "hsl(var(--iso-1))" }}
          />
          Análisis territorial
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {isochrone
            ? `Isócrona ${isochrone.mode === "driving-car" ? "vehículo" : isochrone.mode === "foot-walking" ? "caminata" : "bici"} · ${minutesAvailable.join(" / ")} min`
            : "Crea o selecciona una isócrona para ver datos."}
        </p>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-surface-2/60 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          aria-label="Cerrar panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-6 pt-3">
        {!isochrone && (
          <div className="rounded-xl bg-surface-2/60 px-4 py-6 text-center text-[12px] text-muted-foreground">
            Activa el modo Isócrona y haz click en el mapa para generar una.
          </div>
        )}

        {analysis && (
          <>
            <Section
              title="Isócronas"
              open={sectionOpen.isocronas}
              onToggle={() => toggleSection("isocronas")}
            >
              {isochrone && minutesAvailable.length > 0 && (
                <div className="mb-3 flex gap-0.5 rounded-lg bg-surface-2/60 p-0.5">
                  {minutesAvailable.map((m, i) => (
                    <button
                      key={m}
                      onClick={() => setTab(i)}
                      className={[
                        "flex-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-all",
                        tab === i ? "bg-surface-3 text-foreground shadow-apple-sm" : "text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              )}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <Metric value={fmt(analysis.totals.pop)} label="Personas" />
                <Metric value={fmt(analysis.totals.hh)} label="Hogares" />
                <Metric value={fmtCLP(analysis.totals.incomeTotal)} label="Ingreso total/mes" />
                <Metric value={fmtCLP(analysis.totals.incomeAvgPerHh)} label="Ingreso prom./hogar" />
                <Metric value={analysis.area_km2.toFixed(2)} label="Área km²" />
                <Metric value={fmt(analysis.density.popPerKm2)} label="Densidad hab/km²" />
              </div>
              <div className="rounded-md bg-surface-2/40 px-3 py-1.5 text-[10px] text-muted-foreground">
                Fuente población:{" "}
                <span className="font-medium text-foreground">
                  {analysis.totals.source === "manzanas"
                    ? "Manzanas Censo 2017"
                    : "Estimado por comuna (proporcional al área)"}
                </span>
                {analysis.gse && (
                  <div className="mt-1">
                    GSE/NSE enriquecido con {analysis.gse.manzanaCount} manzanas Censo 2012.
                  </div>
                )}
              </div>
            </Section>

            {analysis.gse && (
              <Section
                title="Indicadores GSE (Censo 2012)"
                open={sectionOpen.gse}
                onToggle={() => toggleSection("gse")}
              >
                <div className="rounded-xl bg-surface-2/60 p-3">
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {analysis.gse.nseScoreAvg != null && (
                      <KV label="NSE score" value={analysis.gse.nseScoreAvg.toFixed(0)} />
                    )}
                    {analysis.gse.educYearsAvg != null && (
                      <KV label="Escolaridad" value={`${analysis.gse.educYearsAvg.toFixed(1)} años`} />
                    )}
                    {analysis.gse.hacinAvg != null && (
                      <KV label="Hacinamiento" value={analysis.gse.hacinAvg.toFixed(2)} />
                    )}
                    {analysis.gse.autoScoreAvg != null && (
                      <KV label="Motorización" value={analysis.gse.autoScoreAvg.toFixed(0)} />
                    )}
                  </div>
                </div>
              </Section>
            )}

            {nseDist.length > 0 && (
              <Section
                title={`Distribución NSE · ${nseSource}`}
                open={sectionOpen.nse}
                onToggle={() => toggleSection("nse")}
              >
                <div className="rounded-xl bg-surface-2/60 p-3">
                  {nseDist.map((n) => (
                    <div key={n.label} className="mb-1.5 flex items-center gap-2">
                      <span className="w-9 flex-shrink-0 font-mono text-[11px] text-foreground">{n.label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div className={["h-full transition-all duration-500", n.color].join(" ")} style={{ width: `${n.pct}%` }} />
                      </div>
                      <span className="w-7 text-right font-mono text-[10px] text-text-muted">{n.pct}%</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Gasto Endógeno Autoplanet ── */}
            <Section
              title="💰 Gasto Endógeno Autoplanet"
              open={sectionOpen.gasto_endogeno}
              onToggle={() => toggleSection("gasto_endogeno")}
            >
              <GastoEndogenoSection analysis={analysis} />
            </Section>

            {analysis.comparisons.length > 0 && (
              <Section
                title="Comparativo vs. promedio RM"
                open={sectionOpen.comparativo}
                onToggle={() => toggleSection("comparativo")}
              >
                <div className="overflow-hidden rounded-xl bg-surface-2/60">
                  {analysis.comparisons.map((c) => (
                    <div key={c.key} className="flex items-center justify-between border-b border-border/30 px-3 py-1.5 text-[11px] last:border-b-0">
                      <span className="text-foreground">{c.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-foreground">{formatComparison(c.value, c.format)}</span>
                        {c.vsRmPct != null && (
                          <span
                            className={[
                              "rounded px-1.5 py-0.5 font-mono text-[10px]",
                              c.vsRmPct >= 0
                                ? "bg-brand-green/15 text-brand-green"
                                : "bg-brand-red/15 text-brand-red",
                            ].join(" ")}
                          >
                            {c.vsRmPct >= 0 ? "+" : ""}{c.vsRmPct}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section
              title="Resumen IA · Gemini"
              open={sectionOpen.resumen_ia}
              onToggle={() => toggleSection("resumen_ia")}
            >
              <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                    <Sparkles className="h-3 w-3 text-primary" />
                    Resumen
                  </div>
                  <button
                    onClick={insights.regenerate}
                    disabled={insights.loading}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground disabled:opacity-50"
                    aria-label="Regenerar resumen"
                  >
                    <RefreshCw className={["h-2.5 w-2.5", insights.loading ? "animate-spin" : ""].join(" ")} />
                    Regenerar
                  </button>
                </div>
                {insights.loading && (
                  <div className="space-y-1.5">
                    <div className="h-2 w-full animate-pulse rounded bg-surface-3" />
                    <div className="h-2 w-5/6 animate-pulse rounded bg-surface-3" />
                    <div className="h-2 w-4/6 animate-pulse rounded bg-surface-3" />
                  </div>
                )}
                {insights.error && (
                  <div className="text-[11px] text-brand-red">{insights.error}</div>
                )}
                {insights.summary && (
                  <div className="prose prose-sm prose-invert max-w-none text-[11.5px] leading-relaxed text-foreground [&>*]:my-1 [&_h1]:hidden [&_h2]:mt-2 [&_h2]:text-[12px] [&_h2]:font-semibold [&_p]:text-[11.5px] [&_strong]:text-foreground [&_ul]:my-1 [&_ul]:pl-4 [&_li]:my-0.5">
                    <ReactMarkdown>{insights.summary}</ReactMarkdown>
                  </div>
                )}
              </div>
            </Section>

            {/* ── Atractores Comerciales dentro de la isócrona ── */}
            {commercialCount && (
              <Section
                title={`🏪 Atractores comerciales · ${commercialCount.total.toLocaleString("es-CL")} establec.`}
                open={sectionOpen.capas}
                onToggle={() => toggleSection("capas")}
              >
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "shops",      icon: "🛍️", label: "Comercios y tiendas"   },
                    { key: "food",       icon: "🍽️", label: "Alimentación"          },
                    { key: "services",   icon: "🏢", label: "Servicios financ."     },
                    { key: "health_edu", icon: "🏥", label: "Salud y educación"     },
                    { key: "other",      icon: "🏨", label: "Turismo y otros"       },
                  ] as const).map(({ key, icon, label }) => (
                    <div key={key} className="rounded-lg bg-surface-2/50 p-2">
                      <div className="text-lg">{icon}</div>
                      <div className="mt-1 text-[13px] font-bold tabular-nums text-foreground">
                        {commercialCount[key].toLocaleString("es-CL")}
                      </div>
                      <div className="text-[9px] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                  <div className="rounded-lg bg-blue-900/20 border border-blue-500/20 p-2">
                    <div className="text-[13px] font-bold text-blue-400 tabular-nums">
                      {commercialCount.total.toLocaleString("es-CL")}
                    </div>
                    <div className="text-[9px] text-muted-foreground">Total establec.</div>
                    <div className="text-[9px] text-muted-foreground/60 mt-0.5">
                      {analysis.area_km2 > 0
                        ? `${(commercialCount.total / analysis.area_km2).toFixed(0)}/km²`
                        : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-2 rounded-md bg-surface-2/30 px-2.5 py-1.5 text-[9px] text-muted-foreground/70">
                  Fuente: OSM 2024 · grid 100m · solo establecimientos dentro del polígono de la isócrona
                </div>
              </Section>
            )}

            <Section
              title={`Capas territoriales · ${analysis.territorialPoints.total} puntos`}
              open={sectionOpen.capas}
              onToggle={() => toggleSection("capas")}
            >
              <div className="overflow-hidden rounded-xl bg-surface-2/60">
                {analysis.territorialPoints.groups.length === 0 ? (
                  <div className="px-3 py-3 text-center text-[11px] text-text-muted">
                    Sin puntos territoriales en el área.
                  </div>
                ) : (
                  analysis.territorialPoints.groups.map((g) => {
                    const dens = analysis.density.pointsPerKm2ByGroup.find((d) => d.groupId === g.groupId);
                    return (
                      <div key={g.groupId} className="border-b border-border/30 px-3 py-2 last:border-b-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: g.color ?? "#888" }} />
                            <span className="text-[12px] font-medium text-foreground">{g.groupName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {dens && (
                              <span className="font-mono text-[10px] text-muted-foreground">{dens.perKm2.toFixed(1)}/km²</span>
                            )}
                            <span className="font-mono text-[12px] text-foreground">{g.count}</span>
                          </div>
                        </div>
                        {g.layers.length > 0 && (
                          <div className="mt-1 ml-4 space-y-0.5">
                            {g.layers.map((l) => (
                              <div key={l.layerId} className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span className="truncate">{l.layerName}</span>
                                <span className="ml-2 font-mono">{l.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Section>

            <ParqueAnalysisSection
              isoFeature={isoFeatureActive}
              open={sectionOpen.parque}
              onToggle={() => toggleSection("parque")}
            />

            <Section
              title="Comunas cubiertas"
              open={sectionOpen.comunas}
              onToggle={() => toggleSection("comunas")}
            >
              <div className="overflow-hidden rounded-xl bg-surface-2/60">
                <div className="grid grid-cols-[1fr_55px_55px_55px] border-b border-border/40 text-[10px] font-medium text-muted-foreground">
                  <div className="px-2 py-1.5">Comuna</div>
                  <div className="px-2 py-1.5 text-right">% iso</div>
                  <div className="px-2 py-1.5 text-right">Pob.</div>
                  <div className="px-2 py-1.5 text-right">NSE</div>
                </div>
                {analysis.communes.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[11px] text-text-muted">
                    Sin comunas cubiertas.
                  </div>
                ) : (
                  analysis.communes.map((c) => (
                    <div
                      key={c.name}
                      className="grid grid-cols-[1fr_55px_55px_55px] border-b border-border/30 text-[11px] last:border-b-0"
                    >
                      <div className="truncate px-2 py-1.5 text-foreground">{c.name}</div>
                      <div className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {(c.areaShareInIso * 100).toFixed(0)}%
                      </div>
                      <div className="px-2 py-1.5 text-right font-mono text-foreground">
                        {fmt(c.popInIso)}
                      </div>
                      <div className="px-2 py-1.5 text-right text-muted-foreground">
                        {c.nse ?? "—"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Section>

            <Section
              title="Exportar"
              open={sectionOpen.exportar}
              onToggle={() => toggleSection("exportar")}
            >
              <div className="flex gap-1.5">
                <button
                  onClick={() => exportCsv(analysis)}
                  className="flex-1 rounded-lg bg-surface-2/60 px-2 py-2 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3"
                >
                  <Download className="mr-1 inline h-3 w-3" /> CSV
                </button>
                <button
                  onClick={() => exportJson(analysis, insights.summary)}
                  className="flex-1 rounded-lg bg-surface-2/60 px-2 py-2 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3"
                >
                  <FileJson className="mr-1 inline h-3 w-3" /> JSON
                </button>
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
};

const Metric = ({ value, label }: { value: string; label: string }) => (
  <div className="rounded-xl bg-surface-2/60 px-3 py-2.5">
    <div className="text-[16px] font-semibold leading-none tracking-tight text-foreground">
      {value}
    </div>
    <div className="mt-1.5 text-[11px] text-muted-foreground">{label}</div>
  </div>
);

const KV = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between rounded-md bg-surface-3/40 px-2 py-1">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono font-medium text-foreground">{value}</span>
  </div>
);

const Section = ({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) => (
  <div className="mb-3">
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 flex w-full items-center gap-1.5 px-1 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {open ? (
        <ChevronDown className="h-3 w-3 flex-shrink-0" />
      ) : (
        <ChevronRight className="h-3 w-3 flex-shrink-0" />
      )}
      <span className="truncate">{title}</span>
    </button>
    {open && <div>{children}</div>}
  </div>
);

const ParqueAnalysisSection = ({
  isoFeature,
  open,
  onToggle,
}: {
  isoFeature: import("geojson").Feature<
    import("geojson").Polygon | import("geojson").MultiPolygon,
    unknown
  > | null;
  open: boolean;
  onToggle: () => void;
}) => {
  const { stats, loading } = useParqueIsochroneStats(isoFeature, open);
  return (
    <Section title="Parque vehicular" open={open} onToggle={onToggle}>
      <div className="rounded-xl bg-surface-2/60 p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
          </div>
        ) : !stats || stats.vehiculos <= 0 ? (
          <div className="text-center text-[11px] text-text-muted">
            Sin vehículos en el área.
          </div>
        ) : (
          <>
            <div className="mb-3 space-y-1">
              <KV label="Vehículos" value={`~${fmt(stats.vehiculos)} (±5%)`} />
              <KV label="Edad media" value={`${stats.edad_media.toFixed(1)} años`} />
              <KV
                label="P25 / P75"
                value={`${stats.edad_p25.toFixed(0)} / ${stats.edad_p75.toFixed(0)} años`}
              />
            </div>
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">
              Ranking marcas
            </div>
            <div className="overflow-hidden rounded-lg border border-border/30">
              {stats.ranking_marcas.slice(0, 10).map((m, i) => (
                <div
                  key={m.marca}
                  className="grid grid-cols-[22px_1fr_70px_56px] border-t border-border/30 text-[11px] first:border-t-0"
                >
                  <div className="px-2 py-1.5 font-mono text-muted-foreground">{i + 1}.</div>
                  <div className="truncate px-2 py-1.5 text-foreground">{m.marca}</div>
                  <div className="px-2 py-1.5 text-right font-mono text-foreground">{fmt(m.count)}</div>
                  <div className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                    ({m.pct.toFixed(1)}%)
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              Estimación ponderada por hexágonos (~500 m) sobre la isócrona de {(((isoFeature?.properties as { value?: number } | null)?.value ?? 0) / 60) || "?"} min.
            </div>
          </>

        )}
      </div>
    </Section>
  );
};
