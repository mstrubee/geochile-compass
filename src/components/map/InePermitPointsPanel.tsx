import { useState } from "react";
import type { LayerProvenanceRow } from "@/types/permits";
import type { IneCoverageRow, IneVsMinvuRow, InePermitFilters, PermitPrecision, PermitUso } from "@/types/projects";
import {
  coverageWarning, fmtInt, MIN_PRECISION_OPTIONS, PRECISION_LABEL, USO_COLOR, USO_LABEL, WARN,
} from "@/utils/projectsScale";
import type { PermitView } from "./InePermitPointsLayer";
import { ProjectsPanelShell, SourceBlock } from "./ProjectsPanelShell";

interface Props {
  filters: InePermitFilters;
  onFilters: (f: InePermitFilters) => void;
  view: PermitView;
  onView: (v: PermitView) => void;
  coverage: IneCoverageRow[] | undefined;
  vsMinvu: IneVsMinvuRow[] | undefined;
  sources: LayerProvenanceRow[];
  provenanceError: string | null;
  provenanceLoading: boolean;
  loading: boolean;
  error: string | null;
  offset: number;
  zoom: number;
}

const sel = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** Controles, leyenda con advertencias y fuente de «Permisos georreferenciados (INE)». */
export const InePermitPointsPanel = (p: Props) => {
  const [showDiag, setShowDiag] = useState(false);
  const years = (p.coverage ?? []).map((c) => c.year);
  const selYears = p.filters.years ?? [];
  const from = selYears.length ? Math.min(...selYears) : years[years.length - 1];
  const to = selYears.length ? Math.max(...selYears) : years[years.length - 1];
  const uso = p.filters.uso ?? [1, 2, 3];
  const cov = (p.coverage ?? []).filter((c) => selYears.includes(c.year));
  const single = cov.length === 1 ? cov[0] : undefined;
  const excluded = cov.reduce((a, c) => a + (p.filters.minPrecision >= 2 ? c.precision_low + c.precision_none : p.filters.minPrecision === 1 ? c.precision_none : 0), 0);
  const setRange = (a: number, b: number) => p.onFilters({ ...p.filters, years: range(Math.min(a, b), Math.max(a, b)).filter((y) => years.includes(y)) });
  const toggleUso = (u: PermitUso) => {
    const next = uso.includes(u) ? uso.filter((x) => x !== u) : [...uso, u];
    p.onFilters({ ...p.filters, uso: next.length === 3 ? null : next });
  };
  const warnings = [
    WARN.yearOnly, WARN.noPermitNumber, WARN.recordNotPermit,
    single ? coverageWarning(single) : cov.length > 1 ? `Cobertura parcial: entre ${Math.min(...cov.map((c) => c.comunas))} y ${Math.max(...cov.map((c) => c.comunas))} de ${cov[0].comunas_total} comunas con datos por año.` : coverageWarning(undefined),
    ...(excluded > 0 ? [`Ubicación de precisión baja o sin dato excluida: ${fmtInt(excluded)} puntos en los años elegidos.`] : [WARN.lowPrecisionExcluded]),
  ];
  const diag = (p.vsMinvu ?? []).filter((r) => selYears.includes(r.year));
  return (
    <ProjectsPanelShell title="Permisos georreferenciados (INE)" offset={p.offset} testId="permit-points-panel">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className="font-medium">Desde</span>
          <select aria-label="Desde" className={sel} value={from ?? ""} onChange={(e) => setRange(Number(e.target.value), to ?? Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select></label>
        <label className="space-y-1"><span className="font-medium">Hasta</span>
          <select aria-label="Hasta" className={sel} value={to ?? ""} onChange={(e) => setRange(from ?? Number(e.target.value), Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select></label>
        <fieldset className="col-span-2 space-y-1"><legend className="font-medium">Destino</legend>
          {([1, 2, 3] as PermitUso[]).map((u) => (
            <label key={u} className="mr-3 inline-flex items-center gap-1">
              <input type="checkbox" checked={uso.includes(u)} onChange={() => toggleUso(u)} aria-label={USO_LABEL[u]} />
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: USO_COLOR[u] }} />{USO_LABEL[u]}
            </label>
          ))}
        </fieldset>
        <label className="col-span-2 space-y-1"><span className="font-medium">Precisión de la ubicación</span>
          <select aria-label="Precisión mínima" className={sel} value={p.filters.minPrecision} onChange={(e) => p.onFilters({ ...p.filters, minPrecision: Number(e.target.value) as PermitPrecision })}>
            {MIN_PRECISION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></label>
        <label className="col-span-2 space-y-1"><span className="font-medium">Vista</span>
          <select aria-label="Vista" className={sel} value={p.view} onChange={(e) => p.onView(e.target.value as PermitView)}>
            <option value="clusters">Agrupada por zona (se abre al acercar)</option>
            <option value="heat">Mapa de calor (por unidades)</option>
          </select></label>
      </div>

      <div data-testid="permit-points-legend" className="space-y-1">
        <p className="font-medium">{p.loading ? "Cargando…" : "Unidades autorizadas por zona"} · zoom {Math.round(p.zoom)}</p>
        {p.error && <p role="alert" className="text-destructive">No se pudieron leer los datos: {p.error}</p>}
        <p>Círculo = suma de unidades (más grande, más unidades). Con zoom ≥ 13 cada punto se colorea por destino; <b>cuanto más tenue, menos precisa la ubicación</b>
          ({([3, 2, 1, 0] as PermitPrecision[]).map((k) => PRECISION_LABEL[k]).join(" · ")}). Borde rojo punteado = fuera de su comuna declarada.</p>
      </div>

      <button type="button" className="underline" onClick={() => setShowDiag((v) => !v)} aria-expanded={showDiag}>Cuadre con MINVU (diagnóstico)</button>
      {showDiag && (
        <div data-testid="permit-points-diag" className="space-y-1">
          {diag.length === 0 ? <p role="status">Sin datos de MINVU para comparar en los años elegidos.</p> : (
            <table className="w-full text-[11px]">
              <thead><tr className="text-left"><th>Año</th><th>INE hab.+mixto</th><th>MINVU (mismas comunas)</th><th>Razón</th></tr></thead>
              <tbody>{diag.map((r) => <tr key={r.year}><td>{r.year}</td><td>{fmtInt(r.ine_housing_units)}</td><td>{fmtInt(r.minvu_units_same_comunas)}</td><td>{r.ratio ?? "—"}</td></tr>)}</tbody>
            </table>
          )}
          <p className="text-muted-foreground">Es un diagnóstico, no un error: el INE cubre solo parte de las comunas, «mixto» mezcla vivienda con otros usos, MINVU 2025 es preliminar y cambió la agrupación de registros entre 2019 y 2020.</p>
        </div>
      )}

      <SourceBlock title="Permisos georreferenciados (INE)" sources={p.sources} error={p.provenanceError} loading={p.provenanceLoading} warnings={warnings} />
    </ProjectsPanelShell>
  );
};
