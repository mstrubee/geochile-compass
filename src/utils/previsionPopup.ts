import type { IsapreComunaRow } from "@/types/prevision";
import { WARN_ISAPRE, rangeText } from "@/utils/previsionScale";

/** Contenido del popup de una comuna (DOM con textContent: seguro contra XSS). Exportado para probarlo. */
export const buildIsapreComunaPopup = (row: IsapreComunaRow | undefined, fallbackName: string, cut: string, filterText: string): HTMLElement => {
  const el = document.createElement("div");
  el.style.minWidth = "200px";
  const add = (text: string, style = "") => {
    const d = document.createElement("div");
    d.textContent = text;
    d.setAttribute("style", style);
    el.appendChild(d);
  };
  add(row?.name ?? fallbackName, "font-weight:600");
  add(filterText, "font-size:11px;opacity:.8");
  if (!row) {
    add("La comuna no figura en el archivo: sin dato (no es lo mismo que 0).", "font-size:11px;color:#b45309;margin-top:4px");
  } else {
    const exact = row.exact || row.n_lo === row.n_hi;
    add(`Beneficiarios Isapre: ${rangeText(row.n_lo, row.n_hi, row.exact)}${exact && row.n_lo === 0 ? " (cero publicado)" : ""}`, "margin-top:4px");
    if (!exact) add(`Hay ${row.suppressed_cells} celdas con conteos pequeños suprimidos: se da el rango que sale de lo publicado.`, "font-size:11px;color:#b45309");
  }
  add(WARN_ISAPRE.scope, "font-size:10px;opacity:.7;margin-top:4px");
  add(WARN_ISAPRE.comuna, "font-size:10px;opacity:.7");
  add(`CUT ${cut}`, "font-size:10px;opacity:.6");
  return el;
};
