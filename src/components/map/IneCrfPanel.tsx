import type { LayerProvenanceRow } from "@/types/permits";
import type { CrfCoverageRow } from "@/types/projects";
import { SEQUENTIAL } from "@/utils/permitsScale";
import { coverageWarning, fmtInt, WARN } from "@/utils/projectsScale";
import { CRF_POLYGON_MIN_ZOOM } from "./IneCrfLayer";
import { ProjectsPanelShell, SourceBlock } from "./ProjectsPanelShell";

interface Props {
  years: number[] | null;
  onYears: (y: number[] | null) => void;
  coverage: CrfCoverageRow[] | undefined;
  sources: LayerProvenanceRow[];
  provenanceError: string | null;
  provenanceLoading: boolean;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  offset: number;
  zoom: number;
}

const sel = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

export const IneCrfPanel = (p: Props) => {
  const all = (p.coverage ?? []).map((c) => c.year);
  const sel_ = p.years ?? [];
  const from = sel_.length ? Math.min(...sel_) : all[all.length - 1];
  const to = sel_.length ? Math.max(...sel_) : all[all.length - 1];
  const cov = (p.coverage ?? []).filter((c) => sel_.includes(c.year));
  const repaired = cov.reduce((a, c) => a + c.repaired, 0);
  const set = (a: number, b: number) => p.onYears(range(Math.min(a, b), Math.max(a, b)).filter((y) => all.includes(y)));
  const warnings = [
    "Solo hay año de emisión del certificado (sin fecha).",
    WARN.crfNotPermit,
    cov.length === 1 ? coverageWarning(cov[0]) : cov.length > 1 ? `Cobertura parcial: entre ${Math.min(...cov.map((c) => c.comunas))} y ${Math.max(...cov.map((c) => c.comunas))} de ${cov[0].comunas_total} comunas con datos por año.` : coverageWarning(undefined),
    ...(repaired > 0 ? [`${fmtInt(repaired)} polígonos tenían geometría inválida y se repararon (se conserva la original); se dibujan con borde rojo.`] : []),
  ];
  return (
    <ProjectsPanelShell title="Recepciones finales (INE)" offset={p.offset} testId="crf-panel">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className="font-medium">Desde</span>
          <select aria-label="Desde" className={sel} value={from ?? ""} onChange={(e) => set(Number(e.target.value), to ?? Number(e.target.value))}>
            {all.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="space-y-1"><span className="font-medium">Hasta</span>
          <select aria-label="Hasta" className={sel} value={to ?? ""} onChange={(e) => set(from ?? Number(e.target.value), Number(e.target.value))}>
            {all.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      </div>
      <div data-testid="crf-legend" className="space-y-1">
        <p className="font-medium">{p.loading ? "Cargando…" : "Viviendas de los certificados de recepción final"} · zoom {Math.round(p.zoom)}</p>
        {p.error && <p role="alert" className="text-destructive">No se pudieron leer los datos: {p.error}</p>}
        <div className="flex items-center gap-1" aria-hidden>{SEQUENTIAL.map((c) => <span key={c} className="inline-block h-3 w-6 border" style={{ background: c }} />)}<span className="ml-1">menos → más viviendas</span></div>
        {p.zoom < CRF_POLYGON_MIN_ZOOM
          ? <p>Se muestran burbujas por comuna. Acerque el mapa (zoom ≥ {CRF_POLYGON_MIN_ZOOM}) para ver cada obra como polígono.</p>
          : <p>Cada polígono es la huella de una obra terminada.</p>}
        {p.truncated && <p role="status" className="text-amber-700">Hay más polígonos en esta zona que los que se dibujan: acerque el mapa.</p>}
      </div>
      <SourceBlock title="Recepciones finales (INE)" sources={p.sources} error={p.provenanceError} loading={p.provenanceLoading} warnings={warnings} />
    </ProjectsPanelShell>
  );
};
