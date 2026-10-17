import type { LayerProvenanceRow } from "@/types/permits";
import type { SeiaFilters, SeiaSummaryRow } from "@/types/projects";
import { fmtInt, SEIA_DOUBTFUL, stateColor, WARN } from "@/utils/projectsScale";
import { ProjectsPanelShell, SourceBlock } from "./ProjectsPanelShell";

interface Props {
  filters: SeiaFilters;
  onFilters: (f: SeiaFilters) => void;
  summary: SeiaSummaryRow[] | undefined;
  sources: LayerProvenanceRow[];
  provenanceError: string | null;
  provenanceLoading: boolean;
  loading: boolean;
  error: string | null;
  shown: number;
  offset: number;
}

const sel = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

export const SeiaProjectsPanel = (p: Props) => {
  const states = [...new Map((p.summary ?? []).map((r) => [r.status_declared, 0])).keys()].sort();
  const chosen = p.filters.states ?? states;
  const forms = p.filters.forms ?? ["EIA", "DIA"];
  const inState = (r: SeiaSummaryRow) => chosen.includes(r.status_declared) && forms.includes(r.service_layer === 1 ? "EIA" : "DIA");
  const doubtful = (p.summary ?? []).filter((r) => inState(r) && SEIA_DOUBTFUL.has(r.geo_status)).reduce((a, r) => a + r.projects, 0);
  const total = (p.summary ?? []).filter(inState).reduce((a, r) => a + r.projects, 0);
  const toggleState = (s: string) => {
    const next = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s];
    p.onFilters({ ...p.filters, states: next });
  };
  const toggleForm = (f: "EIA" | "DIA") => {
    const next = forms.includes(f) ? forms.filter((x) => x !== f) : [...forms, f];
    p.onFilters({ ...p.filters, forms: next.length === 2 ? null : (next as Array<"EIA" | "DIA">) });
  };
  const thisYear = new Date().getFullYear();
  const warnings = [
    WARN.seiaScope, WARN.seiaQualified, WARN.seiaInvestment, WARN.seiaTypology, WARN.seiaCoarse,
    ...(doubtful > 0 ? [`${fmtInt(doubtful)} de ${fmtInt(total)} proyectos tienen ubicación dudosa (fuera de su comuna declarada o con la comuna sin cruzar); se dibujan con borde rojo y su punto es el original de la fuente.`] : []),
  ];
  return (
    <ProjectsPanelShell title="Proyectos SEIA (inmobiliarios y urbanos)" offset={p.offset} testId="seia-panel">
      <div className="grid grid-cols-2 gap-2">
        <fieldset className="col-span-2 space-y-1"><legend className="font-medium">Tipo de evaluación</legend>
          {(["EIA", "DIA"] as const).map((f) => (
            <label key={f} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" aria-label={f} checked={forms.includes(f)} onChange={() => toggleForm(f)} />{f}</label>
          ))}
        </fieldset>
        <fieldset className="col-span-2 space-y-1"><legend className="font-medium">Estado de evaluación</legend>
          {states.length === 0 && <p role="status">Sin proyectos cargados.</p>}
          {states.map((s) => (
            <label key={s} className="mr-2 inline-flex items-center gap-1">
              <input type="checkbox" aria-label={s} checked={chosen.includes(s)} onChange={() => toggleState(s)} />
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: stateColor(s) }} />{s}
            </label>
          ))}
        </fieldset>
        <label className="space-y-1"><span className="font-medium">Presentado desde</span>
          <select aria-label="Presentado desde" className={sel} value={p.filters.yearFrom ?? ""} onChange={(e) => p.onFilters({ ...p.filters, yearFrom: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Todos</option>{Array.from({ length: thisYear - 1996 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="space-y-1"><span className="font-medium">hasta</span>
          <select aria-label="Presentado hasta" className={sel} value={p.filters.yearTo ?? ""} onChange={(e) => p.onFilters({ ...p.filters, yearTo: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Todos</option>{Array.from({ length: thisYear - 1996 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      </div>
      <div data-testid="seia-legend" className="space-y-1">
        <p className="font-medium">{p.loading ? "Cargando…" : `${fmtInt(p.shown)} proyectos en el mapa`}</p>
        {p.error && <p role="alert" className="text-destructive">No se pudieron leer los datos: {p.error}</p>}
        <p>Color = estado de evaluación. Borde rojo punteado = ubicación dudosa o aproximada (coordenadas redondeadas a grado entero). Círculo azul punteado = corrección propuesta (no oficial).</p>
      </div>
      <SourceBlock title="Proyectos SEIA" sources={p.sources} error={p.provenanceError} loading={p.provenanceLoading} warnings={warnings} />
    </ProjectsPanelShell>
  );
};
