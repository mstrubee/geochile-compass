import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { ChevronDown, ChevronUp, ExternalLink, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LayerProvenanceRow } from "@/types/permits";
import type { SeiaFacets, SeiaFilters, SeiaGeoStatus, SeiaProjectRow } from "@/types/seia";
import {
  activeFilterSummary, formatCount, formatDate, GEO_LABEL, KIND_BY_SOURCE, listTypologies, pointStyle,
} from "@/utils/seiaFilters";

interface Props {
  filters: SeiaFilters;
  onChange: (f: SeiaFilters) => void;
  facets: SeiaFacets | undefined;
  facetsError: string | null;
  provenance: LayerProvenanceRow[] | undefined;
  provenanceError: string | null;
  rows: SeiaProjectRow[] | undefined;
  loading: boolean;
  error: string | null;
  /** Aviso de los filtros iniciales (p. ej. una tipología configurada que no existe en los datos). */
  notice: string | null;
}

const selectCls = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";
const FRESHNESS: Record<string, { label: string; cls: string }> = {
  fresh: { label: "Al día", cls: "" },
  stale: { label: "Atrasada", cls: "border-amber-500 text-amber-700" },
  never_loaded: { label: "Sin cargar", cls: "border-amber-500 text-amber-700" },
};
const LEGEND: SeiaGeoStatus[] = ["inside", "near_border", "outside_declared", "comuna_unmatched"];

const Dot = ({ status }: { status: SeiaGeoStatus }) => {
  const s = pointStyle(status);
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 rounded-full"
      style={{ background: s.fillOpacity > 0.5 ? s.fillColor : "transparent", border: `2px ${s.dashArray ? "dashed" : "solid"} ${s.color === "#ffffff" ? "#9a3412" : s.color}` }}
    />
  );
};

/** Controles, fuente y leyenda de «Proyectos SEIA». Siempre muestra qué es (y qué NO es) la capa, y qué filtro está activo. */
export const SeiaPanel = ({ filters, onChange, facets, facetsError, provenance, provenanceError, rows, loading, error, notice }: Props) => {
  const [open, setOpen] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!rootRef.current) return;
    L.DomEvent.disableClickPropagation(rootRef.current);
    L.DomEvent.disableScrollPropagation(rootRef.current);
  }, []);

  const set = (patch: Partial<SeiaFilters>) => onChange({ ...filters, ...patch });
  const typologies = listTypologies(facets?.typologies);
  const years: number[] = [];
  if (facets?.year_min != null && facets?.year_max != null) for (let y = facets.year_max; y >= facets.year_min; y--) years.push(y);
  const statuses = (facets?.statuses ?? []).filter((s): s is { value: string; n: number } => s.value != null);
  const sources = Object.keys(facets?.by_source ?? {});
  const summary = activeFilterSummary(filters);
  const shown = rows?.length ?? 0;
  const matching = rows?.[0]?.total_matching ?? 0;
  const truncated = matching > shown;

  const toggle = (list: string[] | null, v: string): string[] | null => {
    const cur = list ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    return next.length ? next : null;                  // desmarcar la última = sin filtro (todas); «ninguna» no existe en el panel
  };

  return (
    <div ref={rootRef} data-testid="seia-panel" className="rounded-lg border bg-background/95 text-foreground shadow-lg backdrop-blur">
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Proyectos SEIA
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 text-xs">
          <p data-testid="seia-scope-note" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
            Solo proyectos que <b>ingresan al SEIA</b>: no es un catastro de edificación. La «fecha de calificación» no es fecha de permiso ni de inicio de obras, y la inversión es la que <b>declara el titular</b>.
            La tipología «proyectos inmobiliarios» (h.1) incluye proyectos <b>no residenciales</b> (fábricas, centros comerciales): inmobiliario no es vivienda.
          </p>
          {notice && <p role="status" data-testid="seia-notice" className="rounded border border-sky-300 bg-sky-50 p-2 text-sky-900">{notice}</p>}
          {facetsError && <p role="alert" className="text-destructive">No se pudo leer el resumen de los datos: {facetsError}</p>}
          {facets && facets.total === 0 && <p role="status">Todavía no hay proyectos del SEIA cargados.</p>}

          {(provenanceError || (provenance && provenance.length > 0)) && (
            <div className="space-y-1" data-testid="seia-sources">
              {provenanceError && <p role="alert" className="text-destructive">No se pudo leer la procedencia: {provenanceError}</p>}
              {(provenance ?? []).map((p) => {
                const f = FRESHNESS[p.freshness_status] ?? FRESHNESS.fresh;
                return (
                  <div key={p.source_key} className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">{KIND_BY_SOURCE[p.source_key] ?? p.source_key}</span>{" "}
                    <span>capturada {formatDate(p.captured_at)}</span>{" "}
                    <Badge variant="outline" className={f.cls}>{f.label}</Badge>{" "}
                    {p.verification_status !== "comprobado" && <Badge variant="destructive" className="gap-1" data-testid="seia-unverified"><ShieldAlert className="h-3 w-3" />Fuente no verificada</Badge>}
                    <a className="underline" href={p.landing_url} target="_blank" rel="noopener noreferrer">e-SEIA<ExternalLink className="ml-0.5 inline h-3 w-3" /></a>
                  </div>
                );
              })}
              {provenance?.[0] && <p className="text-muted-foreground">{provenance[0].attribution}</p>}
            </div>
          )}

          <fieldset className="space-y-1">
            <legend className="font-medium">Tipología</legend>
            <label className="flex items-center gap-1">
              <input type="checkbox" aria-label="Todas las tipologías" checked={filters.typology == null} onChange={() => set({ typology: null })} />
              Todas
            </label>
            <div className="max-h-36 space-y-0.5 overflow-y-auto">
              {typologies.map((o) => (
                <label key={o.code} className="flex items-start gap-1" title={o.names.join("\n")}>
                  <input type="checkbox" aria-label={`Tipología ${o.code}`} checked={filters.typology?.includes(o.code) ?? false} onChange={() => set({ typology: toggle(filters.typology, o.code) })} />
                  <span>
                    <b>{o.code}</b> · {o.names[0] ?? "sin nombre"} ({formatCount(o.n)})
                    {o.names.length > 1 && <span className="text-muted-foreground"> · y {o.names.length - 1} {o.names.length === 2 ? "nombre más" : "nombres más"}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="font-medium">Presentado desde</span>
              <select aria-label="Año desde" className={selectCls} value={filters.yearFrom ?? ""} onChange={(e) => set({ yearFrom: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Cualquiera</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">hasta</span>
              <select aria-label="Año hasta" className={selectCls} value={filters.yearTo ?? ""} onChange={(e) => set({ yearTo: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Cualquiera</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>
          {(filters.yearFrom != null || filters.yearTo != null) && <p className="text-muted-foreground">El filtro de años usa la fecha de presentación; un proyecto sin fecha no aparece.</p>}

          {statuses.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">Estado de la evaluación{filters.statuses ? ` (${filters.statuses.length})` : ""}</summary>
              <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
                {statuses.map((s) => (
                  <label key={s.value} className="flex items-center gap-1">
                    <input type="checkbox" aria-label={`Estado ${s.value}`} checked={filters.statuses?.includes(s.value) ?? false} onChange={() => set({ statuses: toggle(filters.statuses, s.value) })} />
                    {s.value} ({formatCount(s.n)})
                  </label>
                ))}
              </div>
            </details>
          )}

          {sources.length > 1 && (
            <fieldset className="flex gap-3">
              <legend className="sr-only">Tipo de evaluación</legend>
              {sources.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="checkbox" aria-label={KIND_BY_SOURCE[k] ?? k} checked={filters.sourceKeys == null || filters.sourceKeys.includes(k)}
                    onChange={() => {
                      const cur = filters.sourceKeys ?? sources;
                      const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
                      set({ sourceKeys: next.length === 0 || next.length === sources.length ? null : next });
                    }} />
                  {KIND_BY_SOURCE[k] ?? k} ({formatCount(facets?.by_source[k] ?? 0)})
                </label>
              ))}
            </fieldset>
          )}

          <label className="flex items-center gap-1">
            <input type="checkbox" aria-label="Ocultar ubicaciones dudosas" checked={filters.hideFlagged} onChange={(e) => set({ hideFlagged: e.target.checked })} />
            Ocultar ubicaciones dudosas o sin validar
          </label>

          {summary.length > 0 && <p data-testid="seia-active-filters" className="text-muted-foreground">Filtros activos: {summary.join(" · ")}</p>}
          {error && <p role="alert" className="text-destructive">No se pudieron leer los proyectos: {error}</p>}
          {loading && <p role="status">Cargando…</p>}
          {!loading && !error && rows && (
            <div role="status" data-testid="seia-count">
              {shown === 0
                ? <>No hay proyectos en esta vista con estos filtros.{filters.typology && <> <button type="button" className="underline" onClick={() => set({ typology: null })}>Mostrar todas las tipologías</button></>}</>
                : truncated
                  ? <><b>Vista recortada:</b> se muestran los {formatCount(shown)} de mayor inversión declarada de {formatCount(matching)} que cumplen los filtros. Acerque el mapa o agregue filtros para ver el resto.</>
                  : <>{formatCount(shown)} {shown === 1 ? "proyecto" : "proyectos"} en esta vista.</>}
            </div>
          )}

          <div data-testid="seia-legend" className="space-y-1 border-t pt-2">
            {LEGEND.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <Dot status={s} />
                <span>{GEO_LABEL[s]}{facets?.geo_status[s] != null && <span className="text-muted-foreground"> · {formatCount(facets.geo_status[s] as number)} en toda la base</span>}</span>
              </div>
            ))}
            <p className="text-muted-foreground">Tamaño según la inversión declarada (sin dato: el más pequeño). Los puntos son los que informa el SEA; una ubicación dudosa se marca, no se corrige.</p>
            {facets && (facets.geo_status.no_geometry ?? 0) > 0 && <p className="text-muted-foreground">{formatCount(facets.geo_status.no_geometry as number)} proyectos no traen punto y no se pueden mostrar en el mapa.</p>}
          </div>
        </div>
      )}
    </div>
  );
};
