import { useState } from "react";
import type { HealthAltaDef } from "@/types/health";
import type { LayerProvenanceRow, ThematicLayerRow } from "@/types/permits";
import type { CasenRegionRow, IsapreComunaRow, IsapreFilters, IsapreResumenRow, IsapreSexo, IsapreSinAltaRow } from "@/types/prevision";
import { ALTA_LABEL, fmtN } from "@/utils/healthScale";
import { legendEntries } from "@/utils/permitsScale";
import {
  casenByRegion, casenCounts, casenRangeText, CASEN_LEVEL_SEAL, countInexact, isapreFilterLabel, ISAPRE_LEVEL_SEAL, MIN_TRAMO_LABEL, QUESTIONS, QUESTION_STATE_TEXT,
  rangeText, SEXO_LABEL, SISTEMAS_SHOWN, SISTEMA_LABEL, totalRange, WARN_CASEN, WARN_ISAPRE,
} from "@/utils/previsionScale";
import { ClientReadyNotice } from "./HealthPanels";
import { ProjectsPanelShell, SourceBlock } from "./ProjectsPanelShell";

const sel = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";
type Notice = Pick<ThematicLayerRow, "client_ready" | "client_ready_note">;

/** Estado de cada pregunta de la fase con su nivel (regla 9). Las que no se pueden responder lo dicen, con el motivo. */
export const QuestionsBlock = ({ ids }: { ids: readonly string[] }) => (
  <div data-testid="prevision-questions" className="space-y-1 border-t pt-2">
    <p className="font-medium">Preguntas y su nivel</p>
    <ul className="space-y-1">
      {QUESTIONS.filter((q) => ids.includes(q.id)).map((q) => (
        <li key={q.id} data-testid={`question-${q.id}`}>
          <span className="font-medium">{q.id}</span> · {q.text}
          <br /><span className="text-muted-foreground">Nivel: {q.level}{q.seal ? ` · Sello: ${q.seal}` : ""}{q.state === "construida" ? "" : ` · ${QUESTION_STATE_TEXT[q.id]}`}</span>
        </li>
      ))}
    </ul>
  </div>
);

interface IsapreProps {
  layer: Notice;
  filters: IsapreFilters;
  onFilters: (f: IsapreFilters) => void;
  rows: IsapreComunaRow[] | undefined;
  breaks: number[];
  loading: boolean;
  error: string | null;
  resumen: IsapreResumenRow | undefined;
  resumenError: string | null;
  sinAlta: IsapreSinAltaRow | undefined;
  sinAltaError: string | null;
  sinAltaLoading: boolean;
  sinAltaDef: HealthAltaDef;
  onSinAltaDef: (d: HealthAltaDef) => void;
  sources: LayerProvenanceRow[];
  provenanceError: string | null;
  provenanceLoading: boolean;
  offset: number;
}

const dateText = (d: string | null | undefined) => d ?? "no la declara";

export const IsapreChoroplethPanel = (p: IsapreProps) => {
  const range = totalRange(p.rows);
  const inexact = countInexact(p.rows);
  const legend = legendEntries("value", "units", p.breaks);
  const warnings = [WARN_ISAPRE.scope, WARN_ISAPRE.provisional, WARN_ISAPRE.comuna, WARN_ISAPRE.period, WARN_ISAPRE.suppression(p.resumen?.suppress_below ?? 5), WARN_ISAPRE.color, WARN_ISAPRE.zero, WARN_ISAPRE.noAccess];
  const s = p.sinAlta;
  return (
    <ProjectsPanelShell title="Isapre: beneficiarios por comuna" offset={p.offset} testId="isapre-choropleth-panel">
      <ClientReadyNotice layer={p.layer} />
      <p data-testid="prevision-level-seal"><span className="font-medium">Nivel: </span>{ISAPRE_LEVEL_SEAL.level} · <span className="font-medium">Sello: </span>{ISAPRE_LEVEL_SEAL.seal}</p>
      <div className="grid grid-cols-2 gap-2" data-testid="isapre-filters">
        <label className="space-y-1"><span className="font-medium">Edad</span>
          <select aria-label="Edad" className={sel} value={p.filters.minTramo} onChange={(e) => p.onFilters({ ...p.filters, minTramo: Number(e.target.value) === 12 ? 12 : 0 })}>
            {Object.entries(MIN_TRAMO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="space-y-1"><span className="font-medium">Sexo</span>
          <select aria-label="Sexo" className={sel} value={p.filters.sexo ?? ""} onChange={(e) => p.onFilters({ ...p.filters, sexo: (e.target.value || null) as IsapreSexo | null })}>
            <option value="">Ambos</option>
            {(Object.keys(SEXO_LABEL) as IsapreSexo[]).map((k) => <option key={k} value={k}>{SEXO_LABEL[k]}</option>)}</select></label>
        <label className="col-span-2 space-y-1"><span className="font-medium">Comunas</span>
          <select aria-label="Solo comunas sin alta complejidad" className={sel} value={p.filters.sinAlta ?? ""} onChange={(e) => p.onFilters({ ...p.filters, sinAlta: (e.target.value || null) as HealthAltaDef | null })}>
            <option value="">Todas</option>
            <option value="hospital">Solo sin {ALTA_LABEL.hospital.toLowerCase()} en la comuna</option>
            <option value="ampliada">Solo sin {ALTA_LABEL.ampliada.toLowerCase()} en la comuna</option></select></label>
      </div>
      <div data-testid="isapre-legend" className="space-y-1">
        <p className="font-medium">{p.loading ? "Cargando…" : `${fmtN(range.lo)}${range.lo === range.hi ? "" : ` a ${fmtN(range.hi)}`} beneficiarios en ${fmtN((p.rows ?? []).length)} comunas`}</p>
        <p>{isapreFilterLabel(p.filters)}</p>
        {inexact > 0 && <p role="status" data-testid="isapre-inexact">{fmtN(inexact)} comunas se muestran como rango por conteos pequeños suprimidos.</p>}
        {p.error && <p role="alert" className="text-destructive">No se pudieron leer los datos: {p.error}</p>}
        <ul className="space-y-0.5">
          {legend.map((e) => (
            <li key={`${e.kind}-${e.label}`} className="flex items-center gap-1">
              <span aria-hidden className="inline-block h-3 w-4 border" style={{ background: e.color, borderStyle: e.kind === "nodata" ? "dashed" : "solid" }} />{e.label}
            </li>
          ))}
        </ul>
      </div>
      <div data-testid="isapre-sin-alta" className="space-y-1 border-t pt-2">
        <p className="font-medium">1b-1 · 60 años o más en comunas sin alta complejidad</p>
        <label className="space-y-1"><span className="sr-only">Definición de alta complejidad</span>
          <select aria-label="Definición de alta complejidad (1b-1)" className={sel} value={p.sinAltaDef} onChange={(e) => p.onSinAltaDef(e.target.value as HealthAltaDef)}>
            <option value="hospital">{ALTA_LABEL.hospital}</option><option value="ampliada">{ALTA_LABEL.ampliada}</option></select></label>
        {p.sinAltaLoading && <p role="status">Calculando…</p>}
        {p.sinAltaError && <p role="alert" className="text-destructive">No se pudo calcular: {p.sinAltaError}</p>}
        {s && (
          <>
            <p data-testid="isapre-sin-alta-value"><span className="text-base font-semibold tabular-nums">{fmtN(s.benef_exacto)}</span> beneficiarios Isapre de 60 años o más en {fmtN(s.comunas_con_dato)} comunas.</p>
            <p className="text-muted-foreground">Calculado con los conteos completos del archivo. Lo publicado, con supresión, da {rangeText(s.benef_pub_lo, s.benef_pub_hi, false)}.{!s.consistente && " ¡El agregado cae FUERA del rango publicado: no usar!"}</p>
            <p className="text-muted-foreground">Comunas sin alta complejidad según el registro: {fmtN(s.comunas_sin_alta)} ({fmtN(s.comunas_sin_alta - s.comunas_con_dato)} sin fila en el archivo Isapre). Total del país con la misma edad: {fmtN(s.benef_total_pais)}.</p>
          </>
        )}
      </div>
      {p.resumen && (
        <details data-testid="isapre-resumen" className="space-y-1 border-t pt-2">
          <summary className="cursor-pointer font-medium">Cómo se leen estos números</summary>
          <p>Período: {dateText(p.resumen.period_start)} a {dateText(p.resumen.period_end)} · Publicación declarada: {dateText(p.resumen.declared_date)} · Extracción: {dateText(p.resumen.extraction_date)}.</p>
          <p>De {fmtN(p.resumen.cells)} celdas (comuna × sexo × tramo), {fmtN(p.resumen.zeros_published)} son ceros publicados; {fmtN(p.resumen.suppressed_primary)} se suprimieron por tener entre 1 y {p.resumen.suppress_below - 1} personas y {fmtN(p.resumen.suppressed_complementary)} más para que no se pudiera deducir la suprimida restando.</p>
          <p>{fmtN(p.resumen.groups_total_suppressed)} de {fmtN(p.resumen.groups)} totales de grupo no se publican.</p>
        </details>
      )}
      {p.resumenError && <p role="alert" className="text-destructive">No se pudo leer el resumen: {p.resumenError}</p>}
      <QuestionsBlock ids={["1b-1", "1b-2", "1b-5"]} />
      <SourceBlock title="Isapre: beneficiarios por comuna" sources={p.sources} error={p.provenanceError} loading={p.provenanceLoading} warnings={warnings} />
    </ProjectsPanelShell>
  );
};

interface CasenProps {
  layer: Notice;
  rows: CasenRegionRow[] | undefined;
  loading: boolean;
  error: string | null;
  sources: LayerProvenanceRow[];
  provenanceError: string | null;
  provenanceLoading: boolean;
  offset: number;
}

export const CasenRegionPanel = (p: CasenProps) => {
  const [all, setAll] = useState(false);
  const regions = casenByRegion(p.rows);
  const counts = casenCounts(p.rows);
  const shown = all ? (Object.keys(SISTEMA_LABEL) as (keyof typeof SISTEMA_LABEL)[]) : SISTEMAS_SHOWN;
  const warnings = [WARN_CASEN.estimate, WARN_CASEN.method, WARN_CASEN.notPublishable, WARN_CASEN.noSum, WARN_CASEN.license];
  return (
    <ProjectsPanelShell title="Previsión regional (CASEN, estimada)" offset={p.offset} testId="casen-region-panel">
      <ClientReadyNotice layer={p.layer} />
      <p data-testid="prevision-level-seal"><span className="font-medium">Nivel: </span>{CASEN_LEVEL_SEAL.level} · <span className="font-medium">Sello: </span>{CASEN_LEVEL_SEAL.seal}</p>
      <p>{WARN_CASEN.estimate}</p>
      <label className="inline-flex items-center gap-1">
        <input type="checkbox" aria-label="Mostrar todos los sistemas" checked={all} onChange={(e) => setAll(e.target.checked)} />Mostrar todos los sistemas
      </label>
      <div data-testid="casen-regions" className="space-y-2">
        {p.loading && <p role="status">Cargando…</p>}
        {p.error && <p role="alert" className="text-destructive">No se pudieron leer los datos: {p.error}</p>}
        {!p.loading && !p.error && regions.length === 0 && <p role="status">Todavía no hay estimaciones cargadas.</p>}
        {counts.total > 0 && <p data-testid="casen-counts">{counts.publishable} de {counts.total} estimaciones tienen valor publicable.</p>}
        {regions.map((r) => (
          <div key={r.region_cut} data-testid={`casen-${r.region_cut}`} className="border-t pt-1">
            <p className="font-medium">{r.region_name}</p>
            <ul className="space-y-0.5">
              {shown.map((s) => {
                const e = r.bySistema[s];
                return e ? <li key={s} data-testid={`casen-${r.region_cut}-${s}`}>{SISTEMA_LABEL[s]}: <span className={e.publishable ? "tabular-nums" : "text-muted-foreground"}>{casenRangeText(e)}</span></li> : null;
              })}
            </ul>
          </div>
        ))}
      </div>
      <QuestionsBlock ids={["1b-3", "1b-4"]} />
      <SourceBlock title="Previsión regional (CASEN, estimada)" sources={p.sources} error={p.provenanceError} loading={p.provenanceLoading} warnings={warnings} />
    </ProjectsPanelShell>
  );
};
