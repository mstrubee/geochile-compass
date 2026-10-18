import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LayerProvenanceRow, ThematicLayerRow } from "@/types/permits";
import type { HealthComunaCountRow, HealthComunaTipoRow, HealthFilters, HealthSummaryRow, HealthTipoRow } from "@/types/health";
import {
  breakdownByTipo, CLASE_COLOR, CLASE_LABEL, countingText, filterLabel, fmtN, LEVEL_SEAL, rankComunas, totalImputed, totalMarked, totalNotDrawable, totalEstablishments, WARN,
} from "@/utils/healthScale";
import { legendEntries } from "@/utils/permitsScale";
import { HealthFichaDialog } from "./HealthFichaDialog";
import { HealthFiltersForm } from "./HealthFiltersForm";
import { ProjectsPanelShell, SourceBlock } from "./ProjectsPanelShell";

const tipoLabels = (tipos: HealthTipoRow[] | undefined) => Object.fromEntries((tipos ?? []).map((t) => [t.tipo_norm, t.tipo_label]));

/** «Qué se está contando»: junto a cada número, para que nadie lea el ranking como oferta. */
const Counting = ({ filters, tipos }: { filters: HealthFilters; tipos: HealthTipoRow[] | undefined }) => (
  <p data-testid="health-counting" className="rounded border px-2 py-1">{countingText(filters, tipoLabels(tipos))} <span className="text-muted-foreground">{WARN.counting}</span></p>
);

export const ClientReadyNotice = ({ layer }: { layer: Pick<ThematicLayerRow, "client_ready" | "client_ready_note"> }) =>
  layer.client_ready === false ? (
    <p role="status" data-testid="health-not-client-ready" className="rounded border border-amber-500 px-2 py-1 text-amber-700 dark:text-amber-400">
      {WARN.notClientReady}{layer.client_ready_note ? ` ${layer.client_ready_note}` : ""}
    </p>
  ) : null;

interface Common {
  layer: Pick<ThematicLayerRow, "client_ready" | "client_ready_note">;
  filters: HealthFilters;
  onFilters: (f: HealthFilters) => void;
  sources: LayerProvenanceRow[];
  provenanceError: string | null;
  provenanceLoading: boolean;
  summary: HealthSummaryRow[] | undefined;
  summaryError: string | null;
  tipos: HealthTipoRow[] | undefined;
  tiposError: string | null;
  onFichaOpen: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  offset: number;
}

const FichaButton = ({ open, onOpen, props }: { open: boolean; onOpen: (o: boolean) => void; props: Common }) => (
  <>
    <Button type="button" variant="outline" size="sm" className="h-7 w-full gap-1 text-xs" onClick={() => onOpen(true)}>
      <FileText className="h-3 w-3" />Ver definiciones y clasificación
    </Button>
    <HealthFichaDialog open={open} onClose={() => onOpen(false)} summary={props.summary} tipos={props.tipos} tiposError={props.tiposError} summaryError={props.summaryError} />
  </>
);

interface PointsProps extends Common { shown: number; totalMatching: number | null; imputedShown: number; markedShown: number }

export const HealthPointsPanel = (p: PointsProps) => {
  const [ficha, setFicha] = useState(false);
  const open = (o: boolean) => { setFicha(o); p.onFichaOpen(o); };
  const truncated = p.totalMatching != null && p.shown < p.totalMatching;
  const warnings = [
    WARN.registry, WARN.heterogeneity, p.filters.includeClosed ? WARN.closedShown : WARN.closedHidden, WARN.altaDefs, WARN.privateDef,
    ...(p.imputedShown > 0 ? [WARN.imputed(p.imputedShown, p.shown)] : []),
    ...(p.markedShown > 0 ? [WARN.marked(p.markedShown)] : []),
  ];
  return (
    <ProjectsPanelShell title="Establecimientos de salud" offset={p.offset} testId="health-points-panel">
      <ClientReadyNotice layer={p.layer} />
      <p data-testid="health-level-seal"><span className="font-medium">Nivel: </span>{LEVEL_SEAL.level} · <span className="font-medium">Sello: </span>{LEVEL_SEAL.seal}</p>
      <HealthFiltersForm filters={p.filters} onFilters={p.onFilters} tipos={p.tipos} />
      <Counting filters={p.filters} tipos={p.tipos} />
      <div data-testid="health-points-legend" className="space-y-1">
        <p className="font-medium">{p.loading ? "Cargando…" : `${fmtN(p.shown)} establecimientos en el mapa${p.totalMatching != null ? ` de ${fmtN(p.totalMatching)} con ubicación` : ""}`}</p>
        {p.error && <p role="alert" className="text-destructive">No se pudieron leer los datos: {p.error}</p>}
        {truncated && <p role="status" className="text-amber-700 dark:text-amber-400">Se muestran los primeros {fmtN(p.shown)}: acerque el mapa o filtre para ver el resto.</p>}
        <ul className="space-y-0.5">
          {(["ambulatorio", "hospitalario", "sin_clasificar"] as const).map((c) => (
            <li key={c} className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CLASE_COLOR[c] }} />{CLASE_LABEL[c]}</li>
          ))}
        </ul>
        <p>Punto grande = alta complejidad (definición ampliada). Relleno tenue = clase imputada por tabla. Borde rojo punteado = ubicación marcada. Gris hueco = cerrado.</p>
      </div>
      <SourceBlock title="Establecimientos de salud" sources={p.sources} error={p.provenanceError} loading={p.provenanceLoading} warnings={warnings} />
      <FichaButton open={ficha} onOpen={open} props={p} />
    </ProjectsPanelShell>
  );
};

interface ChoroProps extends Common {
  rows: HealthComunaCountRow[] | undefined;
  breaks: number[];
  missingPolygons: number;
  onPick: (cut: string) => void;
  selected: { cut: string; name: string } | null;
  breakdown: HealthComunaTipoRow[] | undefined;
  breakdownError: string | null;
}

const sel = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

export const HealthChoroplethPanel = (p: ChoroProps) => {
  const [ficha, setFicha] = useState(false);
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [region, setRegion] = useState<string>("");
  const open = (o: boolean) => { setFicha(o); p.onFichaOpen(o); };
  const regions = [...new Map((p.rows ?? []).map((r) => [r.region_cut, r.region_name])).entries()].sort(([a], [b]) => a.localeCompare(b));
  const ranking = rankComunas(p.rows, order, 10, region || null);
  const total = totalEstablishments(p.rows);
  const imputed = totalImputed(p.rows);
  const notDrawable = totalNotDrawable(p.rows);
  const marked = totalMarked(p.rows);
  const legend = legendEntries("value", "units", p.breaks);
  const warnings = [
    WARN.registry, WARN.heterogeneity, p.filters.includeClosed ? WARN.closedShown : WARN.closedHidden, WARN.altaDefs, WARN.privateDef, WARN.zeroTrue,
    ...(imputed > 0 ? [WARN.imputed(imputed, total)] : []),
    ...(notDrawable > 0 ? [WARN.notDrawn(notDrawable)] : []),
    ...(marked > 0 ? [WARN.marked(marked)] : []),
    ...(p.missingPolygons > 0 ? [WARN.noPolygon] : []),
  ];
  return (
    <ProjectsPanelShell title="Establecimientos por comuna" offset={p.offset} testId="health-choropleth-panel">
      <ClientReadyNotice layer={p.layer} />
      <p data-testid="health-level-seal"><span className="font-medium">Nivel: </span>{LEVEL_SEAL.level} · <span className="font-medium">Sello: </span>{LEVEL_SEAL.seal}</p>
      <HealthFiltersForm filters={p.filters} onFilters={p.onFilters} tipos={p.tipos} />
      <Counting filters={p.filters} tipos={p.tipos} />
      <div data-testid="health-choropleth-legend" className="space-y-1">
        <p className="font-medium">{p.loading ? "Cargando…" : `${fmtN(total)} establecimientos · ${filterLabel(p.filters)}`}</p>
        {p.error && <p role="alert" className="text-destructive">No se pudieron leer los datos: {p.error}</p>}
        <ul className="space-y-0.5">
          {legend.map((e) => (
            <li key={`${e.kind}-${e.label}`} className="flex items-center gap-1">
              <span aria-hidden className="inline-block h-3 w-4 border" style={{ background: e.color, borderStyle: e.kind === "nodata" ? "dashed" : "solid" }} />{e.label}
            </li>
          ))}
        </ul>
      </div>
      <div data-testid="health-ranking" className="space-y-1 border-t pt-2">
        <p className="font-medium">Ranking de comunas</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="sr-only">Orden del ranking</span>
            <select aria-label="Orden del ranking" className={sel} value={order} onChange={(e) => setOrder(e.target.value as "desc" | "asc")}>
              <option value="desc">Las que más tienen</option><option value="asc">Las que menos tienen (incluye 0)</option></select></label>
          <label className="space-y-1"><span className="sr-only">Región</span>
            <select aria-label="Región del ranking" className={sel} value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Todo el país</option>{regions.map(([cut, name]) => <option key={cut} value={cut}>{name}</option>)}</select></label>
        </div>
        {!p.loading && !p.error && ranking.length === 0 && <p role="status">Sin comunas para mostrar.</p>}
        <ol className="space-y-0.5">
          {ranking.map((r) => (
            <li key={r.cut} className="flex items-baseline justify-between gap-2">
              <button type="button" className="truncate text-left underline" onClick={() => p.onPick(r.cut)}>{r.name}</button>
              <span className="tabular-nums" data-testid={`rank-${r.cut}`}>{fmtN(r.n)}{r.n === 0 ? " (0 verdadero)" : ""}</span>
            </li>
          ))}
        </ol>
      </div>
      {p.selected && (
        <div data-testid="health-breakdown" className="space-y-1 border-t pt-2">
          <p className="font-medium">Qué hay en {p.selected.name} (por tipo, todos los ámbitos)</p>
          {p.breakdownError && <p role="alert" className="text-destructive">No se pudo leer el desglose: {p.breakdownError}</p>}
          {!p.breakdownError && !p.breakdown && <p role="status">Cargando…</p>}
          {p.breakdown && (
            <table className="w-full">
              <thead><tr className="text-left"><th>Tipo</th><th className="text-right">Vigentes</th><th className="text-right">Cerrados</th></tr></thead>
              <tbody>
                {breakdownByTipo(p.breakdown).map((r) => (
                  <tr key={r.tipo} className="border-t align-top">
                    <td>{r.tipo}{r.ambitos.some((a) => a !== "Establecimiento de Salud") ? <span className="text-muted-foreground"> ({r.ambitos.filter((a) => a !== "Establecimiento de Salud").join(", ") || "sin ámbito"})</span> : null}</td>
                    <td className="text-right tabular-nums">{fmtN(r.vigentes)}</td><td className="text-right tabular-nums">{fmtN(r.cerrados)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <SourceBlock title="Establecimientos por comuna" sources={p.sources} error={p.provenanceError} loading={p.provenanceLoading} warnings={warnings} />
      <FichaButton open={ficha} onOpen={open} props={p} />
    </ProjectsPanelShell>
  );
};
