import { X, Download, FileJson, FileText, Sparkles, RefreshCw, Loader2, ChevronDown, ChevronRight, ShoppingCart, TrendingUp, Store } from "lucide-react";
import { GastoEndogenoSection } from "./GastoEndogenoSection";
import { useCommercialCount } from "@/hooks/useCommercialCount";
import { computeSalesProjection, type ProjectionResult } from "@/services/salesProjectionService";
import { fetchMaturationCurve, type MaturationCurve } from "@/services/maturationCurveService";
import type { ReportProjection } from "@/utils/reportData";
import type { ProjectionSettings } from "@/types/savedIsochrones";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Isochrone } from "@/types/isochrones";
import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import { useIsochroneAnalysis } from "@/hooks/useIsochroneAnalysis";
import { useIsochroneInsights } from "@/hooks/useIsochroneInsights";
import { useParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";
import { useIsochroneReport } from "@/hooks/useIsochroneReport";
import { exportReportToPdf } from "@/utils/reportExportPdf";
import { exportReportToPptx } from "@/utils/reportExportPptx";
import type { MapCaptureImages } from "@/utils/mapCapture";
import { MapCapturePreviewDialog } from "./MapCapturePreviewDialog";
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
  /** Carpetas disponibles para la proyección (el usuario elige cuál usar). */
  projectionFolders?: Array<{ id: string; name: string }>;
  /** Abre la sección de proyección automáticamente al montar. */
  autoOpenProjection?: boolean;
  /** Nombre de la isócrona guardada que se está analizando (para el header). */
  isochroneName?: string | null;
  /** Ajustes de proyección recordados de esta ubicación. */
  projectionSettings?: ProjectionSettings | null;
  /** Persiste los ajustes para recuperarlos al volver a abrir la isócrona. */
  onProjectionSettingsChange?: (s: ProjectionSettings) => void;
  /** Fotos del mapa para el informe (isócrona, GSE, gasto, atractores). */
  onCaptureMapImages?: (iso: Isochrone, zoomOffset?: number) => Promise<MapCaptureImages | null>;
}

/** Castigo del formato Express: vende menos que un local estándar. */
const EXPRESS_ADJUST_PCT = -20;

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
  | "proyeccion"
  | "capas"
  | "parque"
  | "comunas"
  | "exportar";

const DEFAULT_SECTION_OPEN: Record<SectionKey, boolean> = {
  isocronas: true,
  gse: true,
  nse: true,
  gasto_endogeno: true,
  proyeccion: false,
  comparativo: false,
  resumen_ia: false,
  capas: false,
  parque: false,
  comunas: false,
  exportar: false,
};

export const AnalysisPanel = ({
  open, onClose, isochrone, manzanas = null,
  width = 380, onWidthChange, minWidth = 320, maxWidth = 800,
  projectionFolders = [],
  autoOpenProjection = false,
  isochroneName = null,
  projectionSettings = null,
  onProjectionSettingsChange,
  onCaptureMapImages,
}: AnalysisPanelProps) => {
  // Folder seleccionado para proyección — default al primero de la lista
  const [selectedFolderId, setSelectedFolderId] = useState<string>(
    () => projectionFolders[0]?.id ?? "",
  );
  // Actualizar cuando cambian los folders disponibles
  useEffect(() => {
    if (projectionFolders.length > 0 && !projectionFolders.find(f => f.id === selectedFolderId)) {
      setSelectedFolderId(projectionFolders[0].id);
    }
  }, [projectionFolders]);
  const projectionFolderId = selectedFolderId || null;
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
    setSectionOpen({
      ...DEFAULT_SECTION_OPEN,
      proyeccion: autoOpenProjection,
    });
    // La banda elegida es de la isócrona anterior: volver a la primera.
    setTab(0);
  }, [isochrone?.id, autoOpenProjection]);

  // Proyección de potencial de venta
  const { stats: parqueForProjection } = useParqueIsochroneStats(isoFeatureActive, open);

  // Informe completo para exportar PDF (sin consultas de comercio — solo geodata)
  const { report: fullReport } = useIsochroneReport({
    isochrone,
    isoName: isochroneName,
    manzanas,
    parqueStats: parqueForProjection,
  });
  const [projResult,  setProjResult]  = useState<ProjectionResult | null>(null);
  // Snapshot de la proyección tal como quedó en pantalla (con ajustes), para
  // que el PDF diga exactamente lo mismo que la sección.

  const [exportingPptx, setExportingPptx] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // La curva vive acá y no en la sección: el informe necesita el snapshot de
  // la proyección aunque esa sección esté colapsada (la sección se desmonta).
  const [curve, setCurve] = useState<MaturationCurve | null>(null);
  useEffect(() => {
    if (!projectionFolderId) { setCurve(null); return; }
    let cancelled = false;
    void fetchMaturationCurve(projectionFolderId).then((c) => {
      if (!cancelled) setCurve(c);
    });
    return () => { cancelled = true; };
  }, [projectionFolderId]);
  const [projLoading, setProjLoading] = useState(false);
  const [projError,   setProjError]   = useState<string | null>(null);

  // Reset projection cuando cambia la isócrona
  // Ajustes que reporta la sección (ajuste manual, tasas, rampa).
  const [projAdjust, setProjAdjust] = useState<ProjectionSettings | null>(null);

  useEffect(() => {
    // Si esta ubicación ya tenía una proyección corrida, se muestra tal cual:
    // recalcular consulta toda la red y da lo mismo mientras esos datos no
    // cambien. Para rehacerla está el botón "Nueva proyección".
    setProjResult((projectionSettings?.result as ProjectionResult | null) ?? null);
    setProjAdjust(projectionSettings ?? null);
    setProjError(null);
  }, [isochrone?.id, projectionSettings]);

  /**
   * Proyección tal como quedaría en pantalla, para los informes.
   *
   * Se calcula acá y no en la sección porque esa se desmonta al colapsarla:
   * exportar con la sección cerrada producía un informe sin la lámina de
   * proyección aunque la proyección existiera.
   */
  const projForReport: ReportProjection | null = useMemo(() => {
    if (!projResult) return null;
    const adjustPct = projAdjust?.adjustPct ?? 0;
    const rampEnabled = projAdjust?.rampEnabled ?? true;
    const isExpress = projAdjust?.isExpress ?? false;
    const rows = buildProjRows(
      projResult,
      curve,
      projAdjust?.rateOverrides ?? [],
      rampEnabled,
    );
    const f = 1 + adjustPct / 100;
    return {
      folderName:
        projectionFolders.find((x) => x.id === selectedFolderId)?.name ??
        projResult.folderName,
      baseYear: projResult.baseYear,
      estimatedUf: projResult.estimatedUf * f,
      estimatedClp: projResult.estimatedClp * f,
      lowUf: projResult.lowUf * f,
      highUf: projResult.highUf * f,
      adjustPct,
      isExpress,
      usesMaturationCurve: !!curve && !curve.isFallback,
      maturationIsCustom: !!curve?.isCustom,
      maturationSampleSize: curve?.sampleSize ?? 0,
      rampEnabled,
      steadyStateUf: projResult.estimatedUf * f,
      nWithSales: projResult.nWithSales,
      nWithPredicted: projResult.nWithPredicted,
      usedPredictions: projResult.usedPredictions,
      diagnosticMsg: projResult.diagnosticMsg,
      years: rows.map((r) => ({
        label: r.label, uf: r.uf * f, clp: r.clp * f,
        ratePct: r.ratePct, maturityPct: r.maturityPct, isBase: r.isBase,
      })),
      comparables: projResult.comparables.map((c) => ({
        name: c.name, ufPerMonth: c.ufPerMonth, isActual: c.isActual, weight: c.weight,
      })),
    };
  }, [projResult, projAdjust, curve, projectionFolders, selectedFolderId]);

  // Guarda resultado y ajustes juntos: son una sola cosa desde el punto de
  // vista del usuario ("la proyección de esta ubicación").
  const persistProjection = useCallback(
    (adjust: ProjectionSettings | null, res: ProjectionResult | null) => {
      if (!onProjectionSettingsChange) return;
      onProjectionSettingsChange({
        adjustPct: adjust?.adjustPct ?? 0,
        rateOverrides: adjust?.rateOverrides ?? [],
        rampEnabled: adjust?.rampEnabled ?? true,
        isExpress: adjust?.isExpress ?? false,
        result: res,
        computedAt: res ? new Date().toISOString() : null,
      });
    },
    [onProjectionSettingsChange],
  );

  const runProjection = useCallback(async () => {
    if (!projectionFolderId || !analysis) return;
    setProjLoading(true);
    setProjError(null);
    try {
      const r = await computeSalesProjection({
        folderId:    projectionFolderId,
        isoAnalysis: analysis,
        isoFeature:  isoFeatureActive,
        parque:      parqueForProjection,
      });
      setProjResult(r);
      persistProjection(projAdjust, r);
    } catch (e) {
      setProjError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjLoading(false);
    }
  }, [projectionFolderId, analysis, isoFeatureActive, parqueForProjection, persistProjection, projAdjust]);
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
    ? "GSE manzana (Censo 2024)"
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
            ? <>
                {/* Nombre de la isócrona guardada si existe */}
                {isochroneName && (
                  <span className="mr-1 font-semibold text-foreground">{isochroneName} ·</span>
                )}
                {`Isócrona ${isochrone.mode === "driving-car" ? "vehículo" : isochrone.mode === "foot-walking" ? "caminata" : "bici"} · ${minutesAvailable.join(" / ")} min`}
              </>
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
                    GSE/NSE enriquecido con {analysis.gse.manzanaCount} manzanas Censo 2024.
                  </div>
                )}
              </div>
            </Section>

            {analysis.gse && (
              <Section
                title="Indicadores GSE (Censo 2024)"
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
                  <p className="mb-2 text-[9px] leading-relaxed text-muted-foreground/70">
                    <strong className="text-muted-foreground">Ponderado por hogares</strong> (no por área).
                    C3 puede dominar aunque el mapa muestre "más azul": edificios de dpto.
                    concentran más hogares/m² que casas ABC1.
                  </p>
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

            {/* ── Proyección de Potencial de Venta ── */}
            {projectionFolders.length > 0 && (
              <Section
                title="📈 Proyección de Potencial de Venta"
                open={sectionOpen.proyeccion}
                onToggle={() => toggleSection("proyeccion")}
              >
                <ProjectionSection
                  folders={projectionFolders}
                  selectedFolderId={selectedFolderId}
                  onFolderChange={(id) => {
                    setSelectedFolderId(id);
                    setProjResult(null);
                    setProjError(null);
                  }}
                  result={projResult}
                  loading={projLoading}
                  error={projError}
                  canRun={!!analysis}
                  onRun={runProjection}
                  onReset={() => { setProjResult(null); setProjError(null); }}
                  curve={curve}
                  savedSettings={projectionSettings}
                  onSettingsChange={(s) => { setProjAdjust(s); persistProjection(s, projResult); }}
                  onRerun={runProjection}
                />
              </Section>
            )}

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
              <button
                onClick={() => setPreviewOpen(true)}
                disabled={!fullReport || exportingPptx}
                className="mt-1.5 w-full rounded-lg bg-brand-red/10 px-2 py-2 text-[11px] font-medium text-brand-red transition-colors hover:bg-brand-red/20 disabled:opacity-40"
              >
                {exportingPptx
                  ? <><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Generando…</>
                  : <><FileText className="mr-1 inline h-3 w-3" /> Informe directorio (2 láminas)</>}
              </button>
              <button
                onClick={() => {
                  if (!fullReport) return;
                  exportReportToPdf({ ...fullReport, projection: projForReport });
                }}
                disabled={!fullReport}
                className="mt-1.5 w-full rounded-lg bg-blue-600/10 px-2 py-2 text-[11px] font-medium text-blue-400 transition-colors hover:bg-blue-600/20 disabled:opacity-40"
              >
                <FileText className="mr-1 inline h-3 w-3" /> Informe PDF oficial
              </button>
            </Section>
          </>
        )}
      </div>

      <MapCapturePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onCapture={async (z) =>
          isochrone && onCaptureMapImages ? onCaptureMapImages(isochrone, z) : null
        }
        onConfirm={async (imgs) => {
          if (!fullReport) return;
          setExportingPptx(true);
          try {
            await exportReportToPptx(fullReport, projForReport, imgs);
          } finally {
            setExportingPptx(false);
          }
        }}
      />
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

// ── ProjectionSection ────────────────────────────────────────────────────────

const fmtUF  = (v: number) => `${v.toFixed(1)} UF`;
const fmtCLPM = (v: number) =>
  `$${new Intl.NumberFormat("es-CL").format(Math.round(v / 1_000_000))}M`;

interface ProjectionSectionProps {
  folders:          Array<{ id: string; name: string }>;
  selectedFolderId: string;
  onFolderChange:   (id: string) => void;
  result:           ProjectionResult | null;
  loading:          boolean;
  error:            string | null;
  canRun:           boolean;
  onRun:            () => void;
  onReset:          () => void;
  /** Curva de maduración vigente para la carpeta. */
  curve?:           MaturationCurve | null;
  savedSettings?:   ProjectionSettings | null;
  onSettingsChange?: (s: ProjectionSettings) => void;
  /** Vuelve a correr el predictor descartando el resultado guardado. */
  onRerun?:         () => void;
}

/**
 * Filas de la proyección.
 *
 * `result.estimatedUf` sale de comparables ya maduros: es el potencial EN
 * RÉGIMEN de la ubicación, no lo que rinde un local recién abierto. Con
 * `ramp` activo la curva parte en la fracción medida del régimen (≈50%) y
 * sube hasta el 100%; sin él se asume la ubicación ya madura, que es lo que
 * corresponde al evaluar el traslado de un local en marcha.
 */
const buildProjRows = (
  result: ProjectionResult,
  curve: MaturationCurve | null,
  overrides: (number | null)[],
  ramp: boolean,
): Array<{
  index: number; label: string; uf: number; clp: number;
  ratePct: number; maturityPct: number; isBase: boolean;
}> => {
  const ufToClp = result.estimatedUf > 0 ? result.estimatedClp / result.estimatedUf : 0;
  const horizon = Math.max(0, result.fiveYearProjection.length - 1);
  const factors = curve?.rampFactors ?? [];
  const startFactor = ramp && factors.length > 0 ? factors[0] : 1;

  const rows: Array<{
    index: number; label: string; uf: number; clp: number;
    ratePct: number; maturityPct: number; isBase: boolean;
  }> = [];
  for (let i = 0; i <= horizon; i++) {
    const fallbackRate = i <= 0
      ? 0
      : Math.round((curve?.rates[i - 1] ?? result.growthRate) * 1000) / 10;
    const ratePct = overrides[i] ?? fallbackRate;
    const uf = i === 0
      ? result.estimatedUf * startFactor
      : rows[i - 1].uf * (1 + ratePct / 100);
    rows.push({
      index: i,
      // Sin año calendario: no sabemos cuándo abre. Ponerle 2026 daría una
      // precisión que el dato no tiene y envejecería mal.
      label: i === 0 ? "Base" : `Año ${i}`,
      uf, clp: uf * ufToClp, ratePct,
      maturityPct: result.estimatedUf > 0 ? (uf / result.estimatedUf) * 100 : 0,
      isBase: i === 0,
    });
  }
  return rows;
};

const ProjectionSection = ({
  folders, selectedFolderId, onFolderChange,
  result, loading, error, canRun, onRun, onReset, curve = null,
  savedSettings, onSettingsChange, onRerun,
}: ProjectionSectionProps) => {
  // Ajuste manual sobre la estimación (castigo o premio, en %).
  //
  // Es deliberadamente arbitrario: sirve para incorporar lo que el modelo no
  // ve —re-maduración tras un cierre, obras en la calle, un contrato
  // particular—. Se aplica solo al mostrar: `result` queda intacto, así que
  // "volver al original" es exacto y siempre se puede contrastar.
  const [adjustPct, setAdjustPct] = useState(0);
  // Crecimiento por año. null en una posición = usar el de la curva.
  const [rateOverrides, setRateOverrides] = useState<(number | null)[]>([]);
  // Por defecto se proyecta una ubicación NUEVA, que parte en rampa.
  const [rampEnabled, setRampEnabled] = useState(true);
  const [isExpress, setIsExpress] = useState(false);
  // Último valor persistido, para no reescribir lo que acabamos de restaurar.
  const lastSavedKey = useRef<string | null>(null);

  // Restaura los ajustes recordados de esta ubicación; si no hay, valores por defecto.
  useEffect(() => {
    setAdjustPct(savedSettings?.adjustPct ?? 0);
    setRateOverrides(savedSettings?.rateOverrides ?? []);
    setRampEnabled(savedSettings?.rampEnabled ?? true);
    setIsExpress(savedSettings?.isExpress ?? false);
    // El centinela se reinicia ACÁ y no en un efecto aparte: uno posterior
    // volvía a anularlo después del efecto de guardado, y el primer cambio del
    // usuario se perdía siempre.
    lastSavedKey.current = null;
    // Solo al cambiar de proyección: si dependiera de savedSettings, cada
    // guardado revertiría lo que el usuario está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Recuerda los ajustes de esta ubicación.
  const settingsKey = JSON.stringify({ adjustPct, rateOverrides, rampEnabled, isExpress });
  useEffect(() => {
    if (!onSettingsChange || !result) return;
    // El primer valor tras restaurar es el ya guardado: no reescribirlo.
    if (lastSavedKey.current === null) { lastSavedKey.current = settingsKey; return; }
    if (lastSavedKey.current === settingsKey) return;
    lastSavedKey.current = settingsKey;
    onSettingsChange({ adjustPct, rateOverrides, rampEnabled, isExpress });
  }, [settingsKey, adjustPct, rateOverrides, rampEnabled, isExpress, result, onSettingsChange]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-green-400" />
        Analizando comparables de la red…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div>
        <button onClick={onReset} className="text-[10px] text-muted-foreground hover:text-foreground">↺ Reintentar</button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Estima el potencial de venta comparando el perfil territorial
          con los locales de la red seleccionada.
        </p>

        {/* Selector de carpeta/negocio */}
        {folders.length > 1 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Red de comparación</div>
            <div className="flex flex-col gap-0.5">
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onFolderChange(f.id)}
                  className={[
                    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-all",
                    selectedFolderId === f.id
                      ? "bg-green-600/20 text-green-300 ring-1 ring-green-500/30"
                      : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                  ].join(" ")}
                >
                  <Store className="h-3 w-3 flex-shrink-0" />
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {folders.length === 1 && (
          <div className="flex items-center gap-2 rounded-lg bg-surface-2/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <Store className="h-3 w-3" />
            Comparando con red: <b className="ml-1 text-foreground">{folders[0].name}</b>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {["Población", "NSE", "Ingresos", "Parque vehicular", "Atractores"].map((f) => (
            <span key={f} className="rounded bg-surface-2/60 px-2 py-0.5 text-[9px] text-muted-foreground">{f}</span>
          ))}
        </div>
        {!canRun && (
          <div className="text-[10px] text-amber-500/80 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando datos territoriales…
          </div>
        )}
        <button
          onClick={onRun}
          disabled={!canRun || !selectedFolderId}
          className={[
            "flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[12px] font-semibold transition-all",
            canRun && selectedFolderId
              ? "bg-green-600 hover:bg-green-500 text-white"
              : "bg-surface-2/60 text-muted-foreground cursor-not-allowed opacity-50",
          ].join(" ")}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          Proyectar potencial de venta
        </button>
      </div>
    );
  }

  // Resultado
  const selectedFolderName = folders.find(f => f.id === selectedFolderId)?.name ?? result.folderName;

  // La curva se recalcula acá para que editar una tasa sea inmediato, sin
  // volver a consultar comparables. El crecimiento NO es plano: un local nuevo
  // madura rápido los primeros años y recién después entra en régimen.
  const steadyPct = Math.round(result.growthRate * 1000) / 10;
  const ratesChanged = rateOverrides.some((r) => r != null);
  // Mismo helper que alimenta el snapshot del PDF: si divergieran, el informe
  // diría algo distinto de lo que el usuario tiene en pantalla.
  const projRows = buildProjRows(result, curve, rateOverrides, rampEnabled);

  // El número estable de una ubicación es su potencial EN RÉGIMEN: la rampa de
  // los primeros años es transitoria y depende de cuándo abra.
  const baseProj    = projRows.find((y) => y.isBase);
  const displayProj = { uf: result.estimatedUf, clp: result.estimatedClp };

  const adjusted = adjustPct !== 0;
  const factor   = 1 + adjustPct / 100;
  const adj      = (v: number) => v * factor;

  return (
    <div className="space-y-3">
      {/* Aviso si usó predicciones del modelo en lugar de ventas reales */}
      {result.usedPredictions && (
        <div className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-400/90">
          ⚠ Sin ventas reales cargadas — usando predicciones del modelo Ridge como referencia.
        </div>
      )}

      {/* KPI central — año en curso */}
      <div className="rounded-xl bg-gradient-to-br from-green-900/25 to-emerald-900/10 border border-green-500/20 p-3">
        <div className="text-[10px] text-green-400/70 uppercase tracking-wider mb-1">
          Potencial estimado · en régimen
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-bold text-green-400">{fmtUF(adj(displayProj.uf))}</span>
          <span className="text-[11px] text-green-400/60">/mes</span>
          {adjusted && (
            <span className={[
              "rounded px-1 text-[9px] font-medium",
              adjustPct > 0 ? "bg-green-400/15 text-green-300" : "bg-brand-orange/15 text-brand-orange",
            ].join(" ")}>
              {adjustPct > 0 ? "+" : ""}{adjustPct}% manual
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">{fmtCLPM(adj(displayProj.clp))}/mes</div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          Rango: <span className="text-foreground">{fmtUF(adj(result.lowUf))}</span> — <span className="text-foreground">{fmtUF(adj(result.highUf))}</span>
          <span className="ml-1 text-[9px]">(p25–p75 de comparables)</span>
        </div>
        {adjusted && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            Cálculo original: <span className="text-foreground">{fmtUF(displayProj.uf)}</span>/mes
          </div>
        )}
        {rampEnabled && baseProj && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            Al abrir: <span className="text-foreground">{fmtUF(adj(baseProj.uf))}</span>/mes
            {" · "}{Math.round(baseProj.maturityPct)}% del régimen
          </div>
        )}
      </div>

      {/* Volver a correr el predictor */}
      {onRerun && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>
            {savedSettings?.computedAt
              ? `Calculada el ${new Date(savedSettings.computedAt).toLocaleDateString("es-CL")}`
              : "Proyección vigente"}
          </span>
          <button
            onClick={onRerun}
            className="rounded-md border border-border/50 px-2 py-1 text-[10px] transition-colors hover:bg-surface-3 hover:text-foreground"
            title="Vuelve a consultar la red y recalcula desde cero"
          >
            ⟳ Nueva proyección
          </button>
        </div>
      )}

      {/* Ajustes del analista */}
      <div className="rounded-lg bg-surface-2/40 p-2.5">
        {(adjusted || ratesChanged || !rampEnabled || isExpress) && (
          <button
            onClick={() => { setAdjustPct(0); setRateOverrides([]); setRampEnabled(true); setIsExpress(false); }}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-brand-orange/40 bg-brand-orange/10 py-1.5 text-[10px] font-medium text-brand-orange transition-colors hover:bg-brand-orange/20"
            title="Descarta todos los ajustes y vuelve al cálculo programado"
          >
            ↺ Volver al cálculo original
          </button>
        )}
        {/*
          El formato Express vende menos que un local estándar. La superficie
          todavía no es una variable del modelo, así que se corrige por fuera
          con un valor fijo en vez de sumarse al ajuste que hubiera.
        */}
        <button
          onClick={() => {
            const next = !isExpress;
            setIsExpress(next);
            setAdjustPct(next ? EXPRESS_ADJUST_PCT : 0);
          }}
          className={[
            "mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[10px] font-medium transition-colors",
            isExpress
              ? "border-brand-orange bg-brand-orange/20 text-brand-orange"
              : "border-border/50 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
          ].join(" ")}
          title={`Fija el ajuste en ${EXPRESS_ADJUST_PCT}%`}
        >
          <Store className="h-3 w-3" />
          {isExpress ? `Local Express · ${EXPRESS_ADJUST_PCT}% aplicado` : "Marcar como local Express"}
        </button>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {isExpress ? "Ajuste Express" : "Ajuste manual"}
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={-90}
              max={200}
              step={1}
              value={adjustPct}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setAdjustPct(Number.isFinite(n) ? Math.max(-90, Math.min(200, n)) : 0);
              }}
              className="h-7 w-16 rounded-md border border-border/50 bg-surface-3 px-1.5 text-right text-[11px] font-mono"
            />
            <span className="text-[11px] text-muted-foreground">%</span>
            <button
              onClick={() => setAdjustPct(0)}
              disabled={!adjusted}
              className="rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground disabled:opacity-40"
              title="Volver al cálculo original"
            >
              ↺ Reset
            </button>
          </div>
        </div>
        <input
          type="range"
          min={-90}
          max={200}
          step={1}
          value={adjustPct}
          onChange={(e) => setAdjustPct(parseInt(e.target.value, 10))}
          className="mt-2 w-full accent-green-500"
        />
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          Castiga o premia la estimación por factores que el modelo no ve (re-maduración
          tras un cierre, obras, contrato particular, formato express sin dato de
          superficie). No altera el cálculo: es un criterio propio y queda declarado
          como tal.
        </p>

        <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-border/30 pt-2.5">
          <input
            type="checkbox"
            checked={rampEnabled}
            onChange={(e) => setRampEnabled(e.target.checked)}
            className="mt-0.5 h-3 w-3"
          />
          <span className="text-[10px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Ubicación nueva (parte en rampa)</span>
            <br />
            El potencial estimado sale de locales ya maduros. Con esto activo la
            curva parte en {Math.round((curve?.rampFactors[0] ?? 0.49) * 100)}% de ese
            nivel y sube hasta el 100%. Desactívalo si evalúas trasladar un local
            que ya está en régimen.
          </span>
        </label>
      </div>

      {/* Proyección 5 años */}
      {projRows.length > 1 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            {/* Relativo a la apertura: no sabemos en qué año calendario abre. */}
            Proyección a {projRows.length - 1} años desde la apertura
            {adjusted && (
              <span className="ml-1 normal-case text-brand-orange">
                · ajustada {adjustPct > 0 ? "+" : ""}{adjustPct}%
              </span>
            )}
            <span
              className={[
                "ml-1 normal-case text-[9px]",
                ratesChanged ? "text-brand-orange" : "",
              ].join(" ")}
            >
              ({ratesChanged
                ? "crecimiento ajustado"
                : curve?.isCustom
                  ? "curva definida por admin"
                  : curve && !curve.isFallback
                    ? `curva de maduración · ${curve.sampleSize} locales`
                    : `${steadyPct}% anual`})
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-white/8">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-surface-2/60">
                  <th className="py-1 px-2 text-left text-[10px] text-muted-foreground font-medium">Año</th>
                  <th className="py-1 px-2 text-right text-[10px] text-muted-foreground font-medium">
                    <span className="inline-flex items-center gap-1">
                      Crec.
                      <button
                        onClick={() => setRateOverrides([])}
                        disabled={!ratesChanged}
                        title="Volver a la curva original"
                        className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >↺</button>
                    </span>
                  </th>
                  <th className="py-1 px-2 text-right text-[10px] text-muted-foreground font-medium">% rég.</th>
                  <th className="py-1 px-2 text-right text-[10px] text-muted-foreground font-medium">UF/mes</th>
                  <th className="py-1 px-2 text-right text-[10px] text-muted-foreground font-medium">CLP/mes</th>
                </tr>
              </thead>
              <tbody>
                {projRows.map((yr, i) => (
                  <tr key={yr.index} className={[
                    "border-t border-white/5",
                    yr.isBase   ? "bg-surface-2/30 font-semibold" :
                    i % 2 === 0 ? "bg-surface-1/20" : "",
                  ].join(" ")}>
                    <td className="py-1 px-2 flex items-center gap-1">
                      {yr.label}
                      {yr.isBase && rampEnabled && (
                        <span className="rounded bg-surface-2/60 px-1 text-[8px] text-muted-foreground">
                          apertura
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-2 text-right">
                      {yr.isBase ? (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      ) : (
                        <input
                          type="number"
                          min={-50}
                          max={200}
                          step={0.5}
                          value={yr.ratePct}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            setRateOverrides((prev) => {
                              const next = [...prev];
                              next[i] = Number.isFinite(n) ? Math.max(-50, Math.min(200, n)) : null;
                              return next;
                            });
                          }}
                          className={[
                            "h-6 w-14 rounded border border-border/40 bg-surface-3 px-1 text-right text-[10px] font-mono",
                            rateOverrides[i] != null ? "text-brand-orange" : "text-muted-foreground",
                          ].join(" ")}
                        />
                      )}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-[10px] text-muted-foreground">
                      {Math.round(yr.maturityPct)}%
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums font-mono text-foreground">
                      {fmtUF(adj(yr.uf))}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">
                      {fmtCLPM(adj(yr.clp))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Factores clave */}
      <div className="space-y-1">
        {result.keyFactors.map((f, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className={[
              "mt-1 h-2 w-2 flex-shrink-0 rounded-full",
              f.impact === "positive" ? "bg-green-400" :
              f.impact === "negative" ? "bg-red-400" : "bg-muted-foreground",
            ].join(" ")} />
            <span className="text-foreground leading-snug">{f.label}</span>
          </div>
        ))}
      </div>

      {/* Comparables */}
      {result.comparables.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
            <Store className="h-3 w-3" />
            {result.comparables.length} locales comparables
            <span className="normal-case ml-1">
              ({result.nWithSales} con ventas reales
              {result.nWithPredicted > 0 ? ` · ${result.nWithPredicted} predichos` : ""})
            </span>
          </div>
          <div className="space-y-1">
            {result.comparables.map((c) => (
              <div key={c.poiId} className="flex items-center gap-2 rounded-lg bg-surface-2/30 px-2.5 py-1.5 text-[11px]">
                <span className="flex-1 truncate text-foreground">{c.name}</span>
                {!c.isActual && <span className="text-[8px] text-amber-400/70 bg-amber-400/10 rounded px-1">pred.</span>}
                <span className="font-mono text-green-400">{fmtUF(c.ufPerMonth)}</span>
                <span className="text-[10px] text-muted-foreground">{Math.round((1-c.distanceScore)*100)}% sim.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cambio de red si hay más de 1 folder */}
      {folders.length > 1 && (
        <div className="flex items-center gap-2 pt-1 border-t border-white/8">
          <span className="text-[10px] text-muted-foreground">Red comparada:</span>
          <select
            value={selectedFolderId}
            onChange={(e) => { onFolderChange(e.target.value); onReset(); }}
            className="flex-1 rounded bg-surface-2/60 px-2 py-0.5 text-[11px] text-foreground border-none outline-none cursor-pointer"
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="text-[9px] text-muted-foreground/60 leading-relaxed">
        Basado en {result.comparables.length} locales similares por perfil territorial.
        Excluye factores de gestión y marketing.
      </div>

      <button onClick={onReset} className="text-[10px] text-muted-foreground hover:text-foreground">
        ↺ Nueva proyección
      </button>
    </div>
  );
};
