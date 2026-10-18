import type { IsapreComunaRow, IsapreMetric, IsaprePenetracionRow } from "@/types/prevision";
import { POBLACION_LABEL } from "@/types/poblacion";
import { fmtN } from "@/utils/healthScale";
import { N_SCALE, PCT_SCALE, rangeClassNote } from "@/utils/isapreClasses";
import { FONASA_PENDING, PCT_APPROX_NOTE, WARN_ISAPRE, WARN_PENETRACION, pctIsApprox, pctRangeText, rangeText } from "@/utils/previsionScale";

/** Procedencia de las dos capturas que se muestran juntas: período de los datos y fecha de publicación (no son lo mismo). */
export interface PenetracionSources {
  isapre: { period_end: string | null; declared_date: string | null };
  censo: { period_end: string | null; declared_date: string | null };
}
/** Datos de 1b-2 para la ventana de la comuna. `row` undefined = no se pudo leer (error/cargando); `sexoSinInfo` = sexo «sin información»: no hay penetración. */
export interface PenetracionPopup { row: IsaprePenetracionRow | undefined; sexoSinInfo: boolean; sources: PenetracionSources; /** métrica activa: la nota de «rango en dos clases» es la de su escala */ metric?: IsapreMetric }

const SEAL = "Oficial con advertencia";
const when = (d: string | null | undefined) => d ?? "no la declara";

/** Contenido del popup de una comuna (DOM con textContent: seguro contra XSS). Exportado para probarlo. */
export const buildIsapreComunaPopup = (row: IsapreComunaRow | undefined, fallbackName: string, cut: string, filterText: string, pen?: PenetracionPopup): HTMLElement => {
  const el = document.createElement("div");
  el.style.minWidth = "200px";
  const add = (text: string, style = "", testId?: string) => {
    const d = document.createElement("div");
    d.textContent = text;
    d.setAttribute("style", style);
    if (testId) d.setAttribute("data-testid", testId);
    el.appendChild(d);
    return d;
  };
  add(row?.name ?? fallbackName, "font-weight:600");
  add(filterText, "font-size:11px;opacity:.8");
  const exact = !!row && (row.exact || row.n_lo === row.n_hi);
  const isapreText = row ? `${rangeText(row.n_lo, row.n_hi, row.exact)}${exact && row.n_lo === 0 ? " (cero publicado)" : ""}` : "sin dato (la comuna no figura en el archivo; no es lo mismo que 0)";
  if (!pen) {
    if (!row) add("La comuna no figura en el archivo: sin dato (no es lo mismo que 0).", "font-size:11px;color:#b45309;margin-top:4px");
    else {
      add(`Beneficiarios Isapre: ${isapreText}`, "margin-top:4px");
      const note = rangeClassNote(N_SCALE, row.n_lo, row.n_hi);
      if (note) add(note, "font-size:11px;color:#b45309", "popup-range-classes");
    }
  } else {
    // 1b-2: bloque «Previsión de salud». Nada de respaldo: lo que falta dice «sin dato».
    add("Previsión de salud", "font-weight:600;margin-top:6px", "popup-prevision-title");
    add(`Beneficiarios Isapre: ${isapreText}`, "", "popup-isapre");
    const nNote = pen.metric === "pct" || !row ? null : rangeClassNote(N_SCALE, row.n_lo, row.n_hi);
    if (nNote) add(nNote, "font-size:11px;color:#b45309", "popup-range-classes");
    const r = pen.row;
    add(`${POBLACION_LABEL}: ${pen.sexoSinInfo ? "sin dato (el Censo no tiene «sexo sin información»)" : r?.poblacion == null ? "sin dato" : fmtN(r.poblacion)}`, "", "popup-poblacion");
    const pctText = pen.sexoSinInfo ? "sin dato" : pctRangeText(r?.pct_lo, r?.pct_hi, r?.exact);
    add(`Penetración: ${pctText}`, "font-weight:600", "popup-penetracion");
    if (!pen.sexoSinInfo && pctIsApprox(r?.pct_lo, r?.pct_hi, r?.exact)) add(`(${PCT_APPROX_NOTE})`, "font-size:11px;opacity:.8", "popup-pct-approx");
    const pNote = pen.metric === "pct" && !pen.sexoSinInfo ? rangeClassNote(PCT_SCALE, r?.pct_lo, r?.pct_hi) : null;
    if (pNote) add(pNote, "font-size:11px;color:#b45309", "popup-range-classes");
    if ((r?.pct_hi ?? 0) > 100) add("Supera 100 %: se muestra tal cual. Puede reflejar diferencias de definición territorial (domicilio Isapre [NO COMPROBADO] frente a residencia censal) o de fecha entre las dos fuentes, o el efecto de poblaciones muy pequeñas; la causa no está comprobada.", "font-size:11px;color:#b45309", "popup-over100");
    add(FONASA_PENDING, "font-size:11px;opacity:.8", "popup-fonasa");
    add(`Sello: ${SEAL}`, "font-size:10px;margin-top:3px;font-weight:600", "popup-seal");
    add(`Fuentes: Superintendencia de Salud, cartera de beneficiarios Isapre (período hasta ${when(pen.sources.isapre.period_end)}; publicación ${when(pen.sources.isapre.declared_date)}) · INE, Censo 2024 (período hasta ${when(pen.sources.censo.period_end)}; publicación ${when(pen.sources.censo.declared_date)}).`, "font-size:10px;opacity:.7", "popup-fuentes");
    add(WARN_PENETRACION.asymmetry, "font-size:10px;opacity:.7");
  }
  if (row && !exact) add(`Hay ${row.suppressed_cells} celdas con conteos pequeños suprimidos: se da el rango que sale de lo publicado.`, "font-size:11px;color:#b45309");
  add(WARN_ISAPRE.scope, "font-size:10px;opacity:.7;margin-top:4px");
  add(WARN_ISAPRE.comuna, "font-size:10px;opacity:.7");
  add(`CUT ${cut}`, "font-size:10px;opacity:.6");
  return el;
};
