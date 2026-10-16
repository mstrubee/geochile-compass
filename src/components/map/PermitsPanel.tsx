import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LayerProvenanceRow, PermitChoroplethRow, PermitMetric, PermitSelection } from "@/types/permits";
import { findSource, availableYears, monthRange, monthYears, monthsOfYear, normalizeSelection, sourceKeyFor } from "@/utils/permitsPeriods";
import {
  DESTINATION_LABEL, legendEntries, METRIC_LABEL, MODE_LABEL, MONTH_LABEL, periodLabel,
} from "@/utils/permitsScale";

interface Props {
  selection: PermitSelection;
  onChange: (s: PermitSelection) => void;
  provenance: LayerProvenanceRow[] | undefined;
  provenanceError: string | null;
  loading: boolean;
  error: string | null;
  rows: PermitChoroplethRow[] | undefined;
  breaks: number[];
  /** CUT con dato pero sin polígono en el mapa (p. ej. 12202 Antártica). */
  missingPolygons: string[];
}

const fmtDate = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("-") : null);

const selectCls = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

/** Controles + leyenda de "Permisos de edificación". Siempre muestra fuente, último período y estado de verificación. */
export const PermitsPanel = ({ selection, onChange, provenance, provenanceError, loading, error, rows, breaks, missingPolygons }: Props) => {
  const [open, setOpen] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!rootRef.current) return;
    L.DomEvent.disableClickPropagation(rootRef.current);
    L.DomEvent.disableScrollPropagation(rootRef.current);
  }, []);

  const annual = findSource(provenance, "minvu_cedoc_permisos_anual");
  const monthly = findSource(provenance, "minvu_cedoc_permisos_mensual");
  const source = findSource(provenance, sourceKeyFor(selection.mode));
  const years = availableYears(annual);
  const mRange = monthRange(monthly);
  const mYears = monthYears(mRange).filter((y) => monthsOfYear(mRange, y, selection.mode === "ytd" ? "ytd" : "month").length > 0);
  const months = selection.mode === "year" ? [] : monthsOfYear(mRange, selection.year, selection.mode);
  const set = (patch: Partial<PermitSelection>) => onChange(normalizeSelection({ ...selection, ...patch }, provenance));

  const metricChoice: PermitMetric | "yoy" = selection.display === "yoy" ? "yoy" : selection.metric;
  const entries = legendEntries(selection.display, selection.metric, breaks);
  const anyProvisional = (rows ?? []).some((r) => r.is_provisional);
  const noData = (rows ?? []).filter((r) => (selection.display === "yoy" ? r.yoy_pct : r.value) == null).length;
  const verified = source?.verification_status === "comprobado";

  return (
    <div
      ref={rootRef}
      data-testid="permits-panel"
      className="absolute bottom-8 right-3 z-[1000] w-72 max-h-[70vh] overflow-y-auto rounded-lg border bg-background/95 text-foreground shadow-lg backdrop-blur"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Permisos de edificación
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 text-xs">
          {provenanceError && <p role="alert" className="text-destructive">No se pudo leer la procedencia de los datos: {provenanceError}</p>}
          {provenance && provenance.length > 0 && !years.length && !mRange && (
            <p role="status">Todavía no hay datos cargados para esta capa.</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 space-y-1">
              <span className="font-medium">Período</span>
              <select aria-label="Período" className={selectCls} value={selection.mode} onChange={(e) => set({ mode: e.target.value as PermitSelection["mode"] })}>
                {(["year", "ytd", "month"] as const).map((m) => (
                  <option key={m} value={m} disabled={m === "year" ? years.length === 0 : mYears.length === 0}>{MODE_LABEL[m]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">Año</span>
              <select aria-label="Año" className={selectCls} value={selection.year} onChange={(e) => set({ year: Number(e.target.value) })}>
                {(selection.mode === "year" ? years : mYears).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            {selection.mode !== "year" && (
              <label className="space-y-1">
                <span className="font-medium">{selection.mode === "ytd" ? "Hasta" : "Mes"}</span>
                <select aria-label="Mes" className={selectCls} value={selection.month ?? ""} onChange={(e) => set({ month: Number(e.target.value) })}>
                  {months.map((m) => <option key={m} value={m}>{MONTH_LABEL[m]}</option>)}
                </select>
              </label>
            )}
            <label className="col-span-2 space-y-1">
              <span className="font-medium">Métrica</span>
              <select
                aria-label="Métrica"
                className={selectCls}
                value={metricChoice}
                onChange={(e) => {
                  const v = e.target.value as PermitMetric | "yoy";
                  if (v === "yoy") set({ display: "yoy" });
                  else set({ display: "value", metric: v });
                }}
              >
                <option value="units">{METRIC_LABEL.units}</option>
                <option value="area_m2">{METRIC_LABEL.area_m2}</option>
                <option value="yoy">Variación interanual (%)</option>
              </select>
            </label>
            {selection.display === "yoy" && (
              <label className="col-span-2 space-y-1">
                <span className="font-medium">Variación de</span>
                <select aria-label="Variación de" className={selectCls} value={selection.metric} onChange={(e) => set({ metric: e.target.value as PermitMetric })}>
                  <option value="units">Unidades</option>
                  <option value="area_m2">Superficie (m²)</option>
                </select>
              </label>
            )}
            <label className="col-span-2 space-y-1">
              <span className="font-medium">Tipo de vivienda</span>
              <select aria-label="Tipo de vivienda" className={selectCls} value={selection.destination} onChange={(e) => set({ destination: e.target.value as PermitSelection["destination"] })}>
                {Object.entries(DESTINATION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>

          <div>
            <p className="mb-1 font-medium">{loading ? "Cargando…" : `${selection.display === "yoy" ? "Variación interanual" : METRIC_LABEL[selection.metric]} · ${periodLabel(selection)}`}</p>
            {error && <p role="alert" className="text-destructive">No se pudieron leer los datos: {error}</p>}
            <ul data-testid="permits-legend" className="space-y-1">
              {entries.map((e) => (
                <li key={e.label} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-5 shrink-0 rounded-sm border"
                    style={{ background: e.color, borderStyle: e.kind === "nodata" ? "dashed" : "solid" }}
                  />
                  <span>{e.label}</span>
                </li>
              ))}
            </ul>
            {noData > 0 && (
              <p className="mt-1 text-muted-foreground">{noData} comuna(s) sin {selection.display === "yoy" ? "variación calculable" : "dato"} en este período. Sin dato no es lo mismo que 0.</p>
            )}
            {selection.display === "yoy" && (
              <p className="mt-1 text-muted-foreground">Compara con el mismo período del año anterior; solo se calcula si ambos períodos están completos.</p>
            )}
            {missingPolygons.length > 0 && (
              <p className="mt-1 text-muted-foreground">Sin polígono en el mapa (tiene dato): {missingPolygons.join(", ")}.</p>
            )}
          </div>

          <div data-testid="permits-source" className="space-y-1 border-t pt-2">
            {source ? (
              <>
                <div className="flex flex-wrap items-center gap-1">
                  {verified ? (
                    <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" />Fuente verificada</Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1" data-testid="badge-unverified"><ShieldAlert className="h-3 w-3" />Fuente no verificada</Badge>
                  )}
                  {source.freshness_status === "stale" && (
                    <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700" data-testid="badge-stale">
                      <AlertTriangle className="h-3 w-3" />Sin período nuevo desde el {fmtDate(source.overdue_since)}
                    </Badge>
                  )}
                  {source.freshness_status === "never_loaded" && <Badge variant="outline">Sin datos cargados</Badge>}
                </div>
                <p>
                  <span className="font-medium">Fuente: </span>
                  <a className="underline" href={source.landing_url} target="_blank" rel="noopener noreferrer">
                    {source.publisher}<ExternalLink className="ml-0.5 inline h-3 w-3" />
                  </a>
                </p>
                <p><span className="font-medium">Último período publicado: </span>{fmtDate(source.period_end) ?? "—"}</p>
                <p><span className="font-medium">Capturado: </span>{fmtDate(source.captured_at) ?? "—"} · <span className="font-medium">Fecha declarada por el origen: </span>{fmtDate(source.declared_date) ?? "no declarada"}</p>
                {source.scope_note && <p className="text-muted-foreground">{source.scope_note}</p>}
                {anyProvisional && source.quality_note && (
                  <p className="text-amber-700" data-testid="permits-quality-note">Cifras preliminares (desde {(source.definitive_until ?? 0) + 1}): {source.quality_note}</p>
                )}
                <p className="text-muted-foreground">{source.attribution}{source.license_label ? ` · Licencia: ${source.license_label}` : ""}</p>
              </>
            ) : (
              !provenanceError && <p role="status">No hay una fuente publicada para este período.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
