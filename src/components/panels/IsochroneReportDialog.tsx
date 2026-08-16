import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  FileSpreadsheet,
  FileText,
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  PieChart,
} from "lucide-react";
import { DialogDescription } from "@/components/ui/dialog";
import type { Isochrone } from "@/types/isochrones";
import { ISO_MODE_LABEL } from "@/types/isochrones";
import type { ManzanaFeatureCollection } from "@/types/manzanas";
import type { GseFeatureCollection } from "@/types/gse";
import { useIsochroneReport } from "@/hooks/useIsochroneReport";
import { useParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";
import { pickBandFeature } from "@/utils/isochroneAnalysis";
import {
  DEFAULT_COMMERCE_CATEGORIES,
  buildFreeTextCategory,
  type CommerceCategory,
} from "@/services/commerceService";
import { exportReportToXlsx } from "@/utils/reportExportXlsx";
import { exportReportToPdf } from "@/utils/reportExportPdf";
import type { MapCaptureImages } from "@/utils/mapCapture";

interface Props {
  open: boolean;
  onClose: () => void;
  isochrone: Isochrone | null;
  savedName?: string | null;
  manzanas?: ManzanaFeatureCollection | null;
  gse?: GseFeatureCollection | null;
  /** Genera las fotos de mapa (isócrona sola, GSE, gasto endógeno) para embeber en el PDF. */
  onCaptureMapImages?: (iso: Isochrone) => Promise<MapCaptureImages | null>;
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const fmtCLP = (n: number) => `$${fmt(n)}`;
/** Misma paleta que la capa "GSE por manzana" del mapa (ver GSE_COLORS). */
const NSE_BAR_COLOR: Record<string, string> = {
  ABC1: "bg-[#1e40af]",
  C1: "bg-[#3b82f6]",
  C2: "bg-[#0ea5e9]",
  C3: "bg-[#eab308]",
  D: "bg-[#f97316]",
  E: "bg-[#dc2626]",
};

const NSE_SOURCE_LABEL: Record<string, string> = {
  gse: "Manzanas GSE (Censo 2024), por hogares",
  manzanas: "Manzanas INE (Censo 2017), por población",
  comuna: "Estimación comunal — no refleja la variación interna del área",
};

export const IsochroneReportDialog = ({
  open,
  onClose,
  isochrone,
  savedName = null,
  manzanas = null,
  gse = null,
  onCaptureMapImages,
}: Props) => {
  // Parque de la banda mayor: es la que rotula la página económica del informe.
  const largestBand = useMemo(
    () => (isochrone ? pickBandFeature(isochrone.features) : null),
    [isochrone],
  );
  const { stats: parqueStats } = useParqueIsochroneStats(largestBand, open);

  const {
    report,
    commerceLoading,
    fetchCommerce,
    commerceErrors,
  } = useIsochroneReport({ isochrone, isoName: savedName, manzanas, gse, parqueStats });

  const [exportingPdf, setExportingPdf] = useState(false);
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(DEFAULT_COMMERCE_CATEGORIES.map((c) => c.id)),
  );
  const [customCategories, setCustomCategories] = useState<CommerceCategory[]>([]);
  const [freeTextDraft, setFreeTextDraft] = useState("");
  const [pointsExpanded, setPointsExpanded] = useState(false);
  const [commerceExpanded, setCommerceExpanded] = useState(false);

  // Reset al abrir/cambiar de iso
  useEffect(() => {
    if (open) {
      setTab(0);
      setSelected(new Set(DEFAULT_COMMERCE_CATEGORIES.map((c) => c.id)));
      setCustomCategories([]);
      setFreeTextDraft("");
      setPointsExpanded(false);
      setCommerceExpanded(false);
    }
  }, [open, isochrone?.id]);

  const allCategories = useMemo<CommerceCategory[]>(
    () => [...DEFAULT_COMMERCE_CATEGORIES, ...customCategories],
    [customCategories],
  );

  const toggleCat = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addCustom = () => {
    const t = freeTextDraft.trim();
    if (!t) return;
    const cat = buildFreeTextCategory(t);
    if (allCategories.some((c) => c.id === cat.id)) {
      setFreeTextDraft("");
      return;
    }
    setCustomCategories((prev) => [...prev, cat]);
    setSelected((prev) => new Set(prev).add(cat.id));
    setFreeTextDraft("");
  };

  const handleExportPdf = async () => {
    if (!report) return;
    setExportingPdf(true);
    try {
      const mapImages =
        isochrone && onCaptureMapImages ? await onCaptureMapImages(isochrone) : null;
      exportReportToPdf(report, mapImages);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleSearchCommerce = () => {
    const cats = allCategories.filter((c) => selected.has(c.id));
    if (cats.length === 0) return;
    void fetchCommerce(cats);
  };

  const band =
    report?.bands[Math.min(tab, (report?.bands.length ?? 1) - 1)] ?? null;
  const bandsList = report?.bands ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border/60 px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              style={isochrone ? { background: `${isochrone.color}1f`, color: isochrone.color } : undefined}
            >
              <PieChart className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <DialogTitle className="text-base font-semibold leading-tight tracking-tight">
                Informe de isócrona
              </DialogTitle>
              {isochrone && (
                <DialogDescription className="mt-1 text-xs">
                  {ISO_MODE_LABEL[isochrone.mode]} · {isochrone.minutes.join("/")} min
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        {!report || !band ? (
          <div className="flex h-72 items-center justify-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Construyendo informe…
          </div>
        ) : (
          <div className="flex max-h-[calc(92vh-110px)] flex-col">
            {/* Tabs por banda */}
            {bandsList.length > 1 && (
              <div className="px-5 pt-3">
                <div className="inline-flex rounded-lg bg-surface-2/60 p-0.5">
                  {bandsList.map((b, i) => (
                    <button
                      key={b.bandSeconds}
                      onClick={() => setTab(i)}
                      className={[
                        "rounded-md px-3 py-1.5 text-[12px] font-medium transition-all",
                        tab === i
                          ? "bg-surface-3 text-foreground shadow-apple-sm"
                          : "text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      {b.bandMinutes} min
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
              {/* KPIs */}
              <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3">
                <Card value={fmt(band.totals.pop)} label="Personas" />
                <Card value={fmt(band.totals.hh)} label="Hogares" />
                <Card value={fmtCLP(band.totals.incomeAvgPerHh)} label="Ingreso prom./hogar" />
                <Card value={`${band.area_km2.toFixed(2)} km²`} label="Área" />
                <Card value={fmt(band.density.popPerKm2)} label="Densidad hab/km²" />
                <Card value={fmtCLP(band.totals.incomeTotal)} label="Ingreso total/mes" />
              </div>

              <div className="mb-4 rounded-md bg-surface-2/40 px-3 py-1.5 text-[10px] text-muted-foreground">
                Fuente población:{" "}
                <span className="font-medium text-foreground">
                  {band.totals.source === "manzanas"
                    ? "Manzanas (Censo)"
                    : "Estimado por comuna proporcional al área"}
                </span>
                {band.totals.source !== "manzanas" && (
                  <span> · Activa la capa "Manzanas" para mayor precisión.</span>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Comunas */}
                <Section title={`Comunas involucradas (${band.communes.length})`}>
                  {band.communes.length === 0 ? (
                    <Empty text="Sin comunas cubiertas." />
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-border/30">
                      <div className="grid grid-cols-[1fr_46px_46px_60px] bg-surface-2/60 text-[10px] font-medium text-muted-foreground">
                        <div className="px-2 py-1.5">Comuna</div>
                        <div className="px-2 py-1.5 text-right">% iso</div>
                        <div className="px-2 py-1.5 text-right">NSE</div>
                        <div className="px-2 py-1.5 text-right">Personas</div>
                      </div>
                      {band.communes.map((c) => (
                        <div
                          key={c.name}
                          className="grid grid-cols-[1fr_46px_46px_60px] border-t border-border/30 text-[11px]"
                        >
                          <div className="truncate px-2 py-1.5">{c.name}</div>
                          <div className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                            {(c.areaShareInIso * 100).toFixed(0)}%
                          </div>
                          <div className="px-2 py-1.5 text-right text-muted-foreground">
                            {c.nse ?? "—"}
                          </div>
                          <div className="px-2 py-1.5 text-right font-mono">
                            {fmt(c.popInIso)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* NSE */}
                <Section
                  title={band.nseSource === "gse" ? "Distribución GSE" : "Distribución NSE"}
                >
                  {band.nseDistribution.length === 0 ? (
                    <Empty text="Sin datos NSE." />
                  ) : (
                    <div className="rounded-lg border border-border/30 bg-surface-2/40 p-3">
                      <div className="mb-2 text-[10px] text-muted-foreground">
                        {NSE_SOURCE_LABEL[band.nseSource]}
                      </div>
                      {band.nseDistribution.map((n) => (
                        <div key={n.label} className="mb-2 flex items-center gap-2 last:mb-0">
                          <span className="w-9 flex-shrink-0 font-mono text-[11px]">
                            {n.label}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className={["h-full transition-all duration-500", NSE_BAR_COLOR[n.label] ?? "bg-primary"].join(" ")}
                              style={{ width: `${n.pct}%` }}
                            />
                          </div>
                          <span className="w-8 text-right font-mono text-[10px] text-text-muted">
                            {n.pct}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>

              {/* Puntos territoriales */}
              <div className="mt-4">
                <Section
                  title={`Capas territoriales · ${band.pointsTotal} puntos`}
                  trailing={
                    band.pointsDetail.length > 0 && (
                      <button
                        onClick={() => setPointsExpanded((v) => !v)}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        {pointsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {pointsExpanded ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                    )
                  }
                >
                  {band.pointsByGroup.length === 0 ? (
                    <Empty text="Sin puntos territoriales en el área." />
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-border/30">
                      {band.pointsByGroup.map((g) => (
                        <div key={g.groupId} className="border-b border-border/30 px-3 py-2 last:border-b-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: g.color ?? "#888" }}
                              />
                              <span className="text-[12px] font-medium">{g.groupName}</span>
                            </div>
                            <span className="font-mono text-[12px]">{g.count}</span>
                          </div>
                          {g.layers.length > 0 && (
                            <div className="ml-4 mt-1 space-y-0.5">
                              {g.layers.map((l) => (
                                <div
                                  key={l.layerId}
                                  className="flex items-center justify-between text-[10px] text-muted-foreground"
                                >
                                  <span className="truncate">{l.layerName}</span>
                                  <span className="ml-2 font-mono">{l.count}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {pointsExpanded && band.pointsDetail.length > 0 && (
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/30">
                      <div className="grid grid-cols-[1fr_1fr_1fr_70px_70px] bg-surface-2/60 text-[10px] font-medium text-muted-foreground">
                        <div className="px-2 py-1.5">Grupo</div>
                        <div className="px-2 py-1.5">Capa</div>
                        <div className="px-2 py-1.5">Nombre</div>
                        <div className="px-2 py-1.5 text-right">Lat</div>
                        <div className="px-2 py-1.5 text-right">Lng</div>
                      </div>
                      {band.pointsDetail.slice(0, 500).map((p) => (
                        <div
                          key={p.featureId}
                          className="grid grid-cols-[1fr_1fr_1fr_70px_70px] border-t border-border/30 text-[10px]"
                        >
                          <div className="truncate px-2 py-1">{p.groupName}</div>
                          <div className="truncate px-2 py-1">{p.layerName}</div>
                          <div className="truncate px-2 py-1">{p.name ?? "—"}</div>
                          <div className="px-2 py-1 text-right font-mono">{p.lat.toFixed(4)}</div>
                          <div className="px-2 py-1 text-right font-mono">{p.lng.toFixed(4)}</div>
                        </div>
                      ))}
                      {band.pointsDetail.length > 500 && (
                        <div className="px-3 py-2 text-center text-[10px] text-muted-foreground">
                          +{band.pointsDetail.length - 500} más en el detalle exportado.
                        </div>
                      )}
                    </div>
                  )}
                </Section>
              </div>

              {/* Comercios */}
              <div className="mt-4">
                <Section
                  title="Comercios (OpenStreetMap)"
                  trailing={
                    band.commerceItemsInBand.length > 0 && (
                      <button
                        onClick={() => setCommerceExpanded((v) => !v)}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        {commerceExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {commerceExpanded ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                    )
                  }
                >
                  <div className="rounded-lg border border-border/30 bg-surface-2/40 p-3">
                    <div className="mb-2 text-[11px] text-muted-foreground">
                      Selecciona qué tipos de comercios buscar dentro de la isócrona.
                      Los datos vienen de OpenStreetMap (Overpass).
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {allCategories.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => toggleCat(c.id)}
                          className={[
                            "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                            selected.has(c.id)
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/40 bg-surface-3/50 text-muted-foreground hover:bg-surface-3",
                          ].join(" ")}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <div className="mb-2 flex gap-1.5">
                      <Input
                        value={freeTextDraft}
                        onChange={(e) => setFreeTextDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addCustom()}
                        placeholder="Agregar otra (e.g. banco, colegio)"
                        className="h-7 text-[11px]"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={addCustom}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <Button
                      onClick={handleSearchCommerce}
                      disabled={commerceLoading || selected.size === 0}
                      size="sm"
                      className="h-7 text-[11px]"
                    >
                      {commerceLoading ? (
                        <>
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                          Buscando…
                        </>
                      ) : (
                        "Buscar comercios"
                      )}
                    </Button>
                  </div>

                  {/* Resultados */}
                  {band.commerceCountsByCategory.length > 0 && (
                    <div className="mt-2 overflow-hidden rounded-lg border border-border/30">
                      {band.commerceCountsByCategory.map((c) => (
                        <div
                          key={c.id}
                          className="grid grid-cols-[1fr_60px] border-t border-border/30 text-[11px] first:border-t-0"
                        >
                          <div className="truncate px-3 py-1.5">{c.label}</div>
                          <div className="px-3 py-1.5 text-right font-mono">{c.count}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {Object.keys(commerceErrors).length > 0 && (
                    <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-[10px] text-destructive">
                      {Object.entries(commerceErrors).map(([id, msg]) => (
                        <div key={id}>
                          {id}: {msg}
                        </div>
                      ))}
                    </div>
                  )}

                  {commerceExpanded && band.commerceItemsInBand.length > 0 && (
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/30">
                      <div className="grid grid-cols-[1fr_1fr_1.4fr_70px_70px] bg-surface-2/60 text-[10px] font-medium text-muted-foreground">
                        <div className="px-2 py-1.5">Categoría</div>
                        <div className="px-2 py-1.5">Nombre</div>
                        <div className="px-2 py-1.5">Dirección</div>
                        <div className="px-2 py-1.5 text-right">Lat</div>
                        <div className="px-2 py-1.5 text-right">Lng</div>
                      </div>
                      {band.commerceItemsInBand.slice(0, 500).map((c) => (
                        <div
                          key={c.osmId + c.categoryId}
                          className="grid grid-cols-[1fr_1fr_1.4fr_70px_70px] border-t border-border/30 text-[10px]"
                        >
                          <div className="truncate px-2 py-1">{c.categoryLabel}</div>
                          <div className="truncate px-2 py-1">{c.name}</div>
                          <div className="truncate px-2 py-1 text-muted-foreground">
                            {c.address ?? "—"}
                          </div>
                          <div className="px-2 py-1 text-right font-mono">{c.lat.toFixed(4)}</div>
                          <div className="px-2 py-1 text-right font-mono">{c.lng.toFixed(4)}</div>
                        </div>
                      ))}
                      {band.commerceItemsInBand.length > 500 && (
                        <div className="px-3 py-2 text-center text-[10px] text-muted-foreground">
                          +{band.commerceItemsInBand.length - 500} más en el detalle exportado.
                        </div>
                      )}
                    </div>
                  )}
                </Section>
              </div>

              {/* Parque automotor (solo si la capa está activa) */}
              <ParqueSection
                isoFeature={isochrone?.features?.[tab] ?? isochrone?.features?.[0] ?? null}
              />
            </div>

            {/* Footer con exportaciones */}
            <div className="flex items-center justify-between border-t border-border/40 bg-surface-2/40 px-5 py-3">
              <div className="text-[10px] text-muted-foreground">
                Generado: {new Date(report.generatedAt).toLocaleString("es-CL")}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Cerrar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportReportToXlsx(report)}
                >
                  <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                  Excel
                </Button>
                <Button size="sm" onClick={handleExportPdf} disabled={exportingPdf}>
                  {exportingPdf ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {exportingPdf ? "Generando…" : "PDF"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Card = ({ value, label }: { value: string; label: string }) => (
  <div className="rounded-xl bg-surface-2/60 px-3 py-2.5">
    <div className="text-[16px] font-semibold leading-none tracking-tight">{value}</div>
    <div className="mt-1.5 text-[11px] text-muted-foreground">{label}</div>
  </div>
);

const Section = ({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) => (
  <div>
    <div className="mb-2 flex items-center justify-between px-1">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      {trailing}
    </div>
    {children}
  </div>
);

const Empty = ({ text }: { text: string }) => (
  <div className="rounded-lg bg-surface-2/40 px-3 py-3 text-center text-[11px] text-muted-foreground">
    {text}
  </div>
);

const ParqueSection = ({
  isoFeature,
}: {
  isoFeature: import("geojson").Feature<
    import("geojson").Polygon | import("geojson").MultiPolygon,
    unknown
  > | null;
}) => {
  const { stats, loading, enabled } = useParqueIsochroneStats(isoFeature);
  if (!enabled) return null;
  return (
    <div className="mt-4">
      <Section title="Parque automotor en isócrona">
        <div className="rounded-lg border border-border/30 bg-surface-2/40 p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Calculando…
            </div>
          ) : !stats || stats.vehiculos <= 0 ? (
            <Empty text="Sin vehículos en el área." />
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                <Card value={`~${fmt(stats.vehiculos)}`} label="Vehículos (±5%)" />
                <Card value={`${stats.edad_media.toFixed(1)} años`} label="Edad media" />
                <Card
                  value={`${stats.edad_p25.toFixed(0)} / ${stats.edad_p75.toFixed(0)}`}
                  label="P25 / P75 (años)"
                />
              </div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                Ranking marcas
              </div>
              <div className="overflow-hidden rounded-lg border border-border/30">
                <div className="grid grid-cols-[24px_1fr_70px_60px] bg-surface-2/60 text-[10px] font-medium text-muted-foreground">
                  <div className="px-2 py-1.5">#</div>
                  <div className="px-2 py-1.5">Marca</div>
                  <div className="px-2 py-1.5 text-right">Vehículos</div>
                  <div className="px-2 py-1.5 text-right">%</div>
                </div>
                {stats.ranking_marcas.map((m, i) => (
                  <div
                    key={m.marca}
                    className="grid grid-cols-[24px_1fr_70px_60px] border-t border-border/30 text-[11px]"
                  >
                    <div className="px-2 py-1.5 font-mono text-muted-foreground">{i + 1}</div>
                    <div className="truncate px-2 py-1.5">{m.marca}</div>
                    <div className="px-2 py-1.5 text-right font-mono">{fmt(m.count)}</div>
                    <div className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                      {m.pct.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground">
                Estimación ponderada por área de hexágonos (~500 m). Margen ±5%.
              </div>
            </>
          )}
        </div>
      </Section>
    </div>
  );
};
