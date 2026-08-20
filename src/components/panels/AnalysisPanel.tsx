import { X, Download, FileJson, FileText, FileImage, Sparkles, RefreshCw, Loader2, ChevronDown, ChevronRight, ShoppingCart, TrendingUp, Store, Check, Eye, Trash2 } from "lucide-react";
import { GastoEndogenoSection } from "./GastoEndogenoSection";
import { useCommercialCount } from "@/hooks/useCommercialCount";
import { computeSalesProjection, type ProjectionResult } from "@/services/salesProjectionService";
import { fetchMaturationCurve, type MaturationCurve } from "@/services/maturationCurveService";
import { DEFAULT_EXPRESS_ADJUST_PCT, defaultCommercialFolder, fetchExpressAdjustPct } from "@/services/commercialSettingsService";
import { formatAdjustmentLabel, type ReportProjection } from "@/utils/reportData";
import type { ProjectionSettings } from "@/types/savedIsochrones";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Isochrone } from "@/types/isochrones";
import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import { useIsochroneAnalysis } from "@/hooks/useIsochroneAnalysis";
import { useIsochroneInsights } from "@/hooks/useIsochroneInsights";
import { useParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";
import { useCannibalization } from "@/hooks/useCannibalization";
import { useIsochroneReport } from "@/hooks/useIsochroneReport";
import { exportReportToPdf } from "@/utils/reportExportPdf";
import { exportReportToPptx } from "@/utils/reportExportPptx";
import { exportReportToPng } from "@/utils/reportExportPng";
import {
  deleteReportSlides,
  fetchReportSlides,
  fetchReportSlidesMeta,
  saveReportSlides,
  type StoredReportSlides,
} from "@/services/isochroneReportSlidesService";
import { ReportSlidesViewer } from "./ReportSlidesViewer";
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
  /**
   * Id de la isócrona GUARDADA. Sin él no se pueden cachear las láminas para
   * leaseflow: la tabla las referencia por `saved_isochrones.id`, así que una
   * isócrona que todavía no se guardó no tiene dónde colgarlas.
   */
  savedIsochroneId?: string | null;
  /** Ajustes de proyección recordados de esta ubicación. */
  projectionSettings?: ProjectionSettings | null;
  /** Persiste los ajustes para recuperarlos al volver a abrir la isócrona. */
  onProjectionSettingsChange?: (s: ProjectionSettings) => void;
  /** Fotos del mapa para el informe (isócrona, GSE, gasto, atractores). */
  onCaptureMapImages?: (
    iso: Isochrone,
    heat?: Partial<import("@/hooks/useHeatmapSettings").HeatmapSettings> | null,
    zoomOffset?: number,
    panOffset?: { x: number; y: number },
  ) => Promise<MapCaptureImages | null>;
  /** Recaptura solo la foto de atractores, al afinar su heatmap. */
  onCaptureAtractores?: (
    iso: Isochrone,
    heat?: Partial<import("@/hooks/useHeatmapSettings").HeatmapSettings> | null,
    zoomOffset?: number,
    panOffset?: { x: number; y: number },
  ) => Promise<string | null>;
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
  savedIsochroneId = null,
  projectionSettings = null,
  onProjectionSettingsChange,
  onCaptureMapImages,
  onCaptureAtractores,
}: AnalysisPanelProps) => {
  // Red con la que se compara. Por defecto Autoplanet: la primera de la lista
  // es Agroplanet por orden alfabético, no por ser la habitual.
  const [selectedFolderId, setSelectedFolderId] = useState<string>(
    () => defaultCommercialFolder(projectionFolders)?.id ?? "",
  );
  // Actualizar cuando cambian los folders disponibles
  useEffect(() => {
    if (projectionFolders.length > 0 && !projectionFolders.find(f => f.id === selectedFolderId)) {
      setSelectedFolderId(defaultCommercialFolder(projectionFolders)!.id);
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

  // Canibalización con locales propios: alimenta la proyección y el informe.
  const { cannibalization } = useCannibalization({
    folderId: projectionFolderId,
    isoFeature: isoFeatureActive,
    isoMinutes: selectedMin,
    totalPop: analysis?.totals.pop ?? 0,
    totalVehiculos: parqueForProjection?.vehiculos ?? 0,
    enabled: open,
  });

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
  // Qué botón abrió el diálogo de captura. Los dos formatos necesitan las
  // mismas fotos del mapa, así que comparten toda esa interacción y recién
  // se separan al momento de escribir el archivo.
  const [exportFormat, setExportFormat] = useState<"pptx" | "png">("pptx");
  // Metadatos de las láminas cacheadas: se consulta sin el contenido para no
  // arrastrar ~1 MB de base64 cada vez que se abre el panel.
  const [slidesMeta, setSlidesMeta] = useState<{ generatedAt: string; hasSlide2: boolean } | null>(null);
  const [slidesOpen, setSlidesOpen] = useState<StoredReportSlides | null>(null);
  const [slidesBusy, setSlidesBusy] = useState(false);
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
  // El castigo del formato Express es una definición comercial del admin, no
  // un resultado del modelo, así que se lee de la configuración de la carpeta.
  const [expressPct, setExpressPct] = useState(DEFAULT_EXPRESS_ADJUST_PCT);
  useEffect(() => {
    if (!projectionFolderId) { setExpressPct(DEFAULT_EXPRESS_ADJUST_PCT); return; }
    let cancelled = false;
    void fetchExpressAdjustPct(projectionFolderId).then((p) => {
      if (!cancelled) setExpressPct(p);
    });
    return () => { cancelled = true; };
  }, [projectionFolderId]);
  const [projLoading, setProjLoading] = useState(false);
  const [projError,   setProjError]   = useState<string | null>(null);

  // Reset projection cuando cambia la isócrona
  // Ajustes que reporta la sección (ajuste manual, tasas, rampa).
  const [projAdjust, setProjAdjust] = useState<ProjectionSettings | null>(null);

  /**
   * Hidrata la proyección desde lo guardado.
   *
   * Depender de `projectionSettings` a secas creaba un CICLO: cada guardado
   * —y se guarda en cada tecla del ajuste— vuelve desde la base como un objeto
   * nuevo, esto reseteaba `projResult` a una identidad nueva, y la sección de
   * proyección (que restaura sus controles cuando cambia `result`) pisaba lo
   * que el usuario estaba escribiendo con el valor del guardado ANTERIOR.
   * Escribiendo rápido, el campo saltaba a valores viejos: el comportamiento
   * errático del ajuste Exógeno.
   *
   * Se hidrata al cambiar de isócrona —ahí sí hay que traer lo suyo— y una
   * vez más si los ajustes llegan después, porque la carga de isócronas
   * guardadas es asíncrona. El eco de nuestro propio guardado ya no re-hidrata.
   */
  const hydratedIsoRef = useRef<{ isoId: string | null; hadSettings: boolean }>({
    isoId: null,
    hadSettings: false,
  });

  useEffect(() => {
    const isoId = isochrone?.id ?? null;
    const prev = hydratedIsoRef.current;
    const switching = prev.isoId !== isoId;
    const arrivedLate = !prev.hadSettings && projectionSettings != null;
    if (!switching && !arrivedLate) return;
    hydratedIsoRef.current = { isoId, hadSettings: projectionSettings != null };
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
  // Estado de las láminas cacheadas. Se recarga al cambiar de isócrona porque
  // leaseflow las borra al consumirlas: lo que había hace un rato puede ya no
  // estar, y mostrar "guardadas" cuando no lo están es peor que no mostrar nada.
  const refreshSlidesMeta = useCallback(async () => {
    if (!savedIsochroneId) { setSlidesMeta(null); return; }
    try {
      setSlidesMeta(await fetchReportSlidesMeta(savedIsochroneId));
    } catch {
      setSlidesMeta(null);
    }
  }, [savedIsochroneId]);

  useEffect(() => { void refreshSlidesMeta(); }, [refreshSlidesMeta]);

  const handleOpenSlides = useCallback(async () => {
    if (!savedIsochroneId) return;
    setSlidesBusy(true);
    try {
      const s = await fetchReportSlides(savedIsochroneId);
      if (!s) { setSlidesMeta(null); return; }
      setSlidesOpen(s);
    } finally {
      setSlidesBusy(false);
    }
  }, [savedIsochroneId]);

  const handleDeleteSlides = useCallback(async () => {
    if (!savedIsochroneId) return;
    setSlidesBusy(true);
    try {
      await deleteReportSlides(savedIsochroneId);
      setSlidesOpen(null);
      setSlidesMeta(null);
    } finally {
      setSlidesBusy(false);
    }
  }, [savedIsochroneId]);

  const projForReport: ReportProjection | null = useMemo(() => {
    if (!projResult) return null;
    // Express (castigo fijo de formato) y Exógeno (criterio manual del
    // analista) son independientes y se suman — ver ProjectionSection más
    // abajo, donde vive la misma cuenta para lo que se ve en pantalla.
    const exogenoPct = projAdjust?.adjustPct ?? 0;
    const rampEnabled = projAdjust?.rampEnabled ?? true;
    const isExpress = projAdjust?.isExpress ?? false;
    const expressAppliedPct = isExpress ? expressPct : 0;
    const adjustPct = expressAppliedPct + exogenoPct;
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
      expressAppliedPct,
      exogenoPct,
      usesMaturationCurve: !!curve && !curve.isFallback,
      maturationIsCustom: !!curve?.isCustom,
      maturationSampleSize: curve?.sampleSize ?? 0,
      rampEnabled,
      steadyStateUf: projResult.estimatedUf * f,
      nWithSales: projResult.nWithSales,
      nWithPredicted: projResult.nWithPredicted,
      usedPredictions: projResult.usedPredictions,
      diagnosticMsg: projResult.diagnosticMsg,
      // El ajuste manual `f` NO se aplica a las cifras de canibalización: son
      // una medición del territorio, no una proyección de venta. Solo `lostClp`
      // y `lostUf` lo llevan, porque sí son plata proyectada.
      cannibalization: projResult.cannibalization
        ? {
            popPct: projResult.cannibalization.popPct,
            areaPct: projResult.cannibalization.areaPct,
            vehiculosPct: projResult.cannibalization.vehiculosPct,
            overlapPop: projResult.cannibalization.overlapPop,
            overlapAreaKm2: projResult.cannibalization.overlapAreaKm2,
            overlapVehiculos: projResult.cannibalization.overlapVehiculos,
            lostUf: projResult.cannibalization.lostUf * f,
            lostClp: projResult.cannibalization.lostClp * f,
            overlapCount: projResult.cannibalization.overlaps.length,
            overlaps: projResult.cannibalization.overlaps,
            incomplete: projResult.cannibalization.incomplete,
          }
        : null,
      years: rows.map((r) => ({
        label: r.label, uf: r.uf * f, clp: r.clp * f,
        ratePct: r.ratePct, maturityPct: r.maturityPct, isBase: r.isBase,
      })),
      comparables: projResult.comparables.map((c) => ({
        name: c.name, ufPerMonth: c.ufPerMonth, isActual: c.isActual, weight: c.weight,
      })),
    };
  }, [projResult, projAdjust, curve, projectionFolders, selectedFolderId, expressPct]);

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
        // `?? projectionSettings?.heatSettings` es la red de seguridad: cualquier
        // llamador que arme el objeto sin esta clave —hubo uno— borraría la
        // calibración guardada de esta ubicación en vez de dejarla como estaba.
        heatSettings: adjust?.heatSettings ?? projectionSettings?.heatSettings ?? null,
        // Misma red de seguridad que heatSettings: un llamador que omita la
        // clave no debe borrar el encuadre calibrado de esta ubicación.
        captureZoomOffset:
          adjust?.captureZoomOffset ?? projectionSettings?.captureZoomOffset ?? null,
        capturePanOffset:
          adjust?.capturePanOffset ?? projectionSettings?.capturePanOffset ?? null,
        result: res,
        computedAt: res ? new Date().toISOString() : null,
      });
    },
    [onProjectionSettingsChange, projectionSettings],
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
        cannibalization: cannibalization
          ? {
              popPct: cannibalization.popPct,
              areaPct: cannibalization.areaPct,
              vehiculosPct: cannibalization.vehiculosPct,
              overlapPop: cannibalization.overlapPop,
              overlapAreaKm2: cannibalization.overlapAreaKm2,
              overlapVehiculos: cannibalization.overlapVehiculos,
              overlaps: cannibalization.overlaps.map((o) => ({ name: o.name, areaKm2: o.areaKm2 })),
              incomplete: cannibalization.incomplete,
            }
          : null,
      });
      setProjResult(r);
      persistProjection(projAdjust, r);
    } catch (e) {
      setProjError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjLoading(false);
    }
  }, [projectionFolderId, analysis, isoFeatureActive, parqueForProjection, persistProjection, projAdjust, cannibalization]);
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
                  expressPct={expressPct}
                  savedSettings={projectionSettings}
                  identityKey={`${savedIsochroneId ?? isochrone?.id ?? ""}|${selectedFolderId}`}
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
                onClick={() => { setExportFormat("pptx"); setPreviewOpen(true); }}
                disabled={!fullReport || exportingPptx}
                className="mt-1.5 w-full rounded-lg bg-brand-red/10 px-2 py-2 text-[11px] font-medium text-brand-red transition-colors hover:bg-brand-red/20 disabled:opacity-40"
              >
                {exportingPptx
                  ? <><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Generando…</>
                  : <><FileText className="mr-1 inline h-3 w-3" /> Informe directorio (2 láminas)</>}
              </button>
              <button
                onClick={() => { setExportFormat("png"); setPreviewOpen(true); }}
                disabled={!fullReport || exportingPptx || !savedIsochroneId}
                className="mt-1.5 w-full rounded-lg bg-brand-red/10 px-2 py-2 text-[11px] font-medium text-brand-red transition-colors hover:bg-brand-red/20 disabled:opacity-40"
                title={savedIsochroneId
                  ? "Genera las 2 láminas y las deja guardadas para que leaseflow las tome"
                  : "Guarda la isócrona primero: las láminas se asocian a una isócrona guardada"}
              >
                <FileImage className="mr-1 inline h-3 w-3" />
                {slidesMeta ? "Regenerar láminas para leaseflow" : "Guardar láminas para leaseflow"}
              </button>

              {!savedIsochroneId && (
                <div className="mt-1 text-[9px] leading-snug text-muted-foreground">
                  Guarda la isócrona para poder dejarle las láminas a leaseflow.
                </div>
              )}

              {slidesMeta && (
                <div className="mt-1.5 rounded-lg border border-green-500/25 bg-green-500/5 px-2 py-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-green-400">
                    <Check className="h-3 w-3 flex-shrink-0" />
                    <span className="flex-1 truncate">
                      {slidesMeta.hasSlide2 ? "2 láminas guardadas" : "1 lámina guardada"} ·{" "}
                      {new Date(slidesMeta.generatedAt).toLocaleDateString("es-CL")}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    <button
                      onClick={handleOpenSlides}
                      disabled={slidesBusy}
                      className="flex-1 rounded bg-surface-2/60 px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-surface-3 disabled:opacity-40"
                    >
                      {slidesBusy
                        ? <Loader2 className="mr-1 inline h-2.5 w-2.5 animate-spin" />
                        : <Eye className="mr-1 inline h-2.5 w-2.5" />}
                      Ver láminas
                    </button>
                    <button
                      onClick={handleDeleteSlides}
                      disabled={slidesBusy}
                      className="flex-1 rounded bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                    >
                      <Trash2 className="mr-1 inline h-2.5 w-2.5" /> Eliminar
                    </button>
                  </div>
                  <div className="mt-1 text-[9px] leading-snug text-muted-foreground">
                    leaseflow las elimina al tomarlas.
                  </div>
                </div>
              )}
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

      {slidesOpen && (
        <ReportSlidesViewer
          slides={slidesOpen}
          onClose={() => setSlidesOpen(null)}
          onDelete={handleDeleteSlides}
          deleting={slidesBusy}
        />
      )}

      <MapCapturePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onCapture={async (h, z, pOff) =>
          isochrone && onCaptureMapImages ? onCaptureMapImages(isochrone, h, z, pOff) : null
        }
        onCaptureAtractores={async (h, z, pOff) =>
          isochrone && onCaptureAtractores ? onCaptureAtractores(isochrone, h, z, pOff) : null
        }
        initialHeat={projAdjust?.heatSettings ?? projectionSettings?.heatSettings ?? null}
        initialZoomOffset={projAdjust?.captureZoomOffset ?? projectionSettings?.captureZoomOffset ?? 0}
        initialPanOffset={projAdjust?.capturePanOffset ?? projectionSettings?.capturePanOffset ?? null}
        onConfirm={async (imgs, heat, zoomOffset, panOffset) => {
          if (!fullReport) return;
          setExportingPptx(true);
          try {
            // Se guardan los ajustes con los que se generó ESTE informe, para
            // que el próximo parta de ahí en vez de recalibrar desde cero.
            const next: ProjectionSettings = {
              adjustPct: projAdjust?.adjustPct ?? 0,
              rateOverrides: projAdjust?.rateOverrides ?? [],
              rampEnabled: projAdjust?.rampEnabled ?? true,
              isExpress: projAdjust?.isExpress ?? false,
              heatSettings: {
                radius: heat.radius,
                blur: heat.blur,
                opacity: heat.opacity,
              },
              captureZoomOffset: zoomOffset,
              capturePanOffset: panOffset,
            };
            setProjAdjust(next);
            persistProjection(next, projResult);
            if (exportFormat === "png") {
              // No se descargan: quedan en la base para que leaseflow las
              // extraiga. El analista las revisa desde "Ver láminas".
              //
              // Sin isócrona GUARDADA no hay `isochrone_id` al cual asociar
              // las láminas: antes esto seguía igual con `savedIsochroneId!`
              // (undefined en runtime), la escritura fallaba en silencio, y
              // el informe quedaba generado pero jamás guardado ni visible
              // para Leaseflow. Ahora se avisa en vez de fallar callado.
              if (!savedIsochroneId) {
                alert("Esta isócrona no está guardada todavía. Guárdala primero para que el informe quede disponible para Leaseflow/Directorio.");
                return;
              }
              try {
                const laminas = await exportReportToPng(fullReport, projForReport, imgs);
                const saved = await saveReportSlides({
                  isochroneId: savedIsochroneId,
                  slide1: laminas[0]?.dataUrl ?? "",
                  slide2: laminas[1]?.dataUrl ?? null,
                });
                setSlidesMeta({ generatedAt: saved.generatedAt, hasSlide2: !!saved.slide2 });
              } catch (e) {
                console.error("[saveReportSlides]", e);
                alert(`No se pudo guardar el informe: ${e instanceof Error ? e.message : String(e)}`);
              }
            } else {
              await exportReportToPptx(fullReport, projForReport, imgs);
            }
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

/**
 * Input numérico con signo (Exógeno, tasas por año).
 *
 * `type="number"` + `parseInt`/`parseFloat` en cada tecla es errático para
 * valores negativos: al escribir "-" solo, el DOM reporta `e.target.value`
 * como "" (así es el comportamiento nativo de `type="number"` frente a un
 * valor intermedio inválido) → eso da NaN → el código caía a un valor por
 * defecto → y como el input es controlado, React repintaba ESE valor encima
 * de lo que se estaba escribiendo. El signo desaparecía en cada tecla.
 *
 * `type="text"` reporta el string tal cual, así que el signo y los dígitos
 * parciales sobreviven en pantalla hasta formar un número válido, que recién
 * ahí se commitea. `emptyValue` decide qué pasa si se borra todo el campo
 * (0 para un ajuste que siempre tiene valor, null para uno opcional).
 */
function SignedNumberInput({
  value, min, max, step = 1, emptyValue = 0, onCommit, className, title,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  emptyValue?: number | null;
  onCommit: (n: number | null) => void;
  className?: string;
  title?: string;
}) {
  const [text, setText] = useState(() => String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const allowsDecimals = step < 1;
  return (
    <input
      type="text"
      inputMode="decimal"
      title={title}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        const pattern = allowsDecimals ? /^-?\d*\.?\d*$/ : /^-?\d*$/;
        if (!pattern.test(raw)) return;
        setText(raw);
        if (raw === "-") return; // en progreso: podría ser el inicio de un negativo
        if (raw === "") { onCommit(emptyValue); return; }
        const n = allowsDecimals ? parseFloat(raw) : parseInt(raw, 10);
        if (Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)));
      }}
      onBlur={() => setText(String(value))}
      className={className}
    />
  );
}

/**
 * Columnas de similitud que se muestran en la tabla de comparables. De los 5
 * grupos de `SIMILARITY_GROUPS` se dejan afuera de la vista "Competencia":
 * ya se usa para elegir y rankear comparables, pero no se pidió como columna.
 */
const COMPARABLE_TABLE_GROUPS: Array<{ key: string; header: string; title: string }> = [
  { key: "parque",  header: "Parque",         title: "Parque automotriz" },
  { key: "nse",     header: "NSE",            title: "NSE y gasto endógeno" },
  { key: "mercado", header: "Población",      title: "Tamaño de mercado" },
  { key: "flujo",   header: "Com. compl.",    title: "Comercio complementario" },
];

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
  /** Ajuste que fija el botón Express, definido por el admin en la carpeta. */
  expressPct?:      number;
  savedSettings?:   ProjectionSettings | null;
  /**
   * Identidad de la ubicación+red que se está ajustando. Los controles se
   * restauran cuando cambia ESTO, no cuando cambia la identidad de `result`:
   * un resultado nuevo con los mismos ajustes (recalcular, o el eco de un
   * guardado) no debe pisar lo que el usuario está escribiendo.
   */
  identityKey?:     string;
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
  expressPct = DEFAULT_EXPRESS_ADJUST_PCT,
  savedSettings, identityKey = "", onSettingsChange, onRerun,
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
    // Solo al cambiar de ubicación/red. Antes dependía de `result`, pero su
    // identidad cambia también al recalcular y al volver el eco de un guardado
    // —y ahí esto revertía lo que el usuario estaba escribiendo—. La identidad
    // de la ubicación es lo que de verdad define "otros ajustes que restaurar".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  // Recuerda los ajustes de esta ubicación.
  const settingsKey = JSON.stringify({ adjustPct, rateOverrides, rampEnabled, isExpress });
  useEffect(() => {
    if (!onSettingsChange || !result) return;
    // El primer valor tras restaurar es el ya guardado: no reescribirlo.
    if (lastSavedKey.current === null) { lastSavedKey.current = settingsKey; return; }
    if (lastSavedKey.current === settingsKey) return;
    lastSavedKey.current = settingsKey;
    // `heatSettings` se arrastra tal cual: esta sección no lo edita, y omitirlo
    // hacía que `persistProjection` lo resolviera a null. O sea que cada vez que
    // el analista tocaba el ajuste manual o una tasa, borraba la calibración del
    // heatmap que había guardado para esta ubicación.
    onSettingsChange({
      adjustPct, rateOverrides, rampEnabled, isExpress,
      heatSettings: savedSettings?.heatSettings ?? null,
      captureZoomOffset: savedSettings?.captureZoomOffset ?? null,
      capturePanOffset: savedSettings?.capturePanOffset ?? null,
    });
  }, [settingsKey, adjustPct, rateOverrides, rampEnabled, isExpress, result, onSettingsChange, savedSettings]);

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

  // Express (castigo fijo de formato) y Exógeno (adjustPct, criterio manual
  // del analista sobre flujo de paso u otro factor que el modelo no ve) son
  // independientes y se SUMAN: activar Express ya no pisa lo que el analista
  // haya puesto en la barra, ni al revés.
  const expressAppliedPct = isExpress ? expressPct : 0;
  const exogenoAdjusted   = adjustPct !== 0;
  const totalPct = expressAppliedPct + adjustPct;
  const adjusted = totalPct !== 0;
  const factor   = 1 + totalPct / 100;
  const adj      = (v: number) => v * factor;
  const adjustmentLabel = formatAdjustmentLabel(isExpress, expressAppliedPct, adjustPct);

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
          {adjusted && adjustmentLabel && (
            <span className={[
              "rounded px-1 text-[9px] font-medium",
              totalPct > 0 ? "bg-green-400/15 text-green-300" : "bg-brand-orange/15 text-brand-orange",
            ].join(" ")}>
              {adjustmentLabel}
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
          con un castigo FIJO — independiente del ajuste Exógeno de más abajo,
          que sigue siendo criterio del analista y se suma, no se reemplaza.
        */}
        <button
          onClick={() => setIsExpress((v) => !v)}
          className={[
            "mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[10px] font-medium transition-colors",
            isExpress
              ? "border-brand-orange bg-brand-orange/20 text-brand-orange"
              : "border-border/50 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
          ].join(" ")}
          title={`Castigo fijo de ${expressPct}%, independiente del ajuste Exógeno`}
        >
          <Store className="h-3 w-3" />
          {isExpress ? `Local Express · ${expressPct}% aplicado` : "Marcar como local Express"}
        </button>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Diferencia Exógena
          </span>
          <div className="flex items-center gap-1.5">
            <SignedNumberInput
              value={adjustPct}
              min={-90}
              max={200}
              step={1}
              emptyValue={0}
              onCommit={(n) => setAdjustPct(n ?? 0)}
              className="h-7 w-16 rounded-md border border-border/50 bg-surface-3 px-1.5 text-right text-[11px] font-mono"
            />
            <span className="text-[11px] text-muted-foreground">%</span>
            <button
              onClick={() => setAdjustPct(0)}
              disabled={!exogenoAdjusted}
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
          Castiga o premia la estimación por gasto exógeno (flujo de paso) u otro
          factor que el modelo no ve (re-maduración tras un cierre, obras, contrato
          particular). Se suma al castigo fijo de Express si está marcado — no lo
          reemplaza. No altera el cálculo: es un criterio propio y queda declarado
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
            {adjusted && adjustmentLabel && (
              <span className="ml-1 normal-case text-brand-orange">
                · ajustada {adjustmentLabel}
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
                        <SignedNumberInput
                          value={yr.ratePct}
                          min={-50}
                          max={200}
                          step={0.5}
                          emptyValue={null}
                          onCommit={(n) => {
                            setRateOverrides((prev) => {
                              const next = [...prev];
                              next[i] = n;
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

      {/* Comparables — tabla agrupada por dimensión, para ajustar a criterio */}
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
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-surface-2/50 text-muted-foreground">
                  <th className="text-left font-medium px-2 py-1.5">Local</th>
                  <th className="text-right font-medium px-1.5 py-1.5">Venta real</th>
                  {COMPARABLE_TABLE_GROUPS.map((tg) => (
                    <th key={tg.key} className="px-1.5 py-1.5 font-medium" title={tg.title}>
                      {tg.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.comparables.map((c) => (
                  <tr key={c.poiId} className="border-t border-border/20 hover:bg-surface-2/30">
                    <td className="px-2 py-1.5 max-w-[92px] truncate text-foreground" title={c.name}>
                      {c.name}
                      {!c.isActual && (
                        <span className="ml-1 text-[8px] text-amber-400/70">pred.</span>
                      )}
                    </td>
                    <td className="px-1.5 py-1.5 text-right font-mono text-green-400 whitespace-nowrap">
                      {fmtUF(c.ufPerMonth)}
                    </td>
                    {COMPARABLE_TABLE_GROUPS.map((tg) => {
                      // Proyecciones guardadas antes de este cambio traen
                      // similarity pero no diffPct (se agregó después) — se
                      // degrada mostrando el % de similitud sin signo en vez
                      // de dejar todo en blanco. Antes de eso no hay ni
                      // similarity: ahí sí no hay nada que mostrar.
                      const g = c.groupScores?.find((x) => x.key === tg.key);
                      const hasSimilarity = !!g && Number.isFinite(g.similarity);
                      const hasDiff       = hasSimilarity && Number.isFinite(g!.diffPct);
                      const simPct  = hasSimilarity ? Math.round(g!.similarity * 100) : null;
                      const diffPct = hasDiff ? Math.round(g!.diffPct) : null;
                      return (
                        <td
                          key={tg.key}
                          className="px-1.5 py-1.5 text-center font-mono whitespace-nowrap"
                          title={
                            simPct == null
                              ? "Sin dato — recalcula la proyección para verlo"
                              : diffPct == null
                                ? `${tg.title}: ${simPct}% similar — recalcula la proyección para ver la diferencia con signo`
                                : `${tg.title}: el comparable es ${diffPct > 0 ? `${diffPct}% mayor` : diffPct < 0 ? `${Math.abs(diffPct)}% menor` : "prácticamente igual"} que la ubicación nueva (${simPct}% similar)`
                          }
                        >
                          {simPct == null ? (
                            <span className="text-muted-foreground/40">—</span>
                          ) : (
                            <span className={
                              simPct >= 80 ? "text-green-400"
                                : simPct >= 50 ? "text-amber-400"
                                : "text-red-400"
                            }>
                              {diffPct == null ? `${simPct}%` : diffPct === 0 ? "0%" : `${diffPct > 0 ? "+" : ""}${diffPct}%`}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
            Cada columna compara la ubicación nueva contra ese local en una dimensión
            (parque, NSE, población, comercio complementario). El % es la diferencia:
            "+" el comparable es mayor, "-" es menor. El color es qué tan parecidos son
            en esa dimensión, no el signo: verde = muy parecido, ámbar = parcial, rojo =
            distinto. Si el estimado no calza con lo que la tabla muestra —por ejemplo, se
            parece en parque pero no en comercio complementario—, ese es el criterio para
            corregir con el ajuste de más abajo.
          </p>
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
