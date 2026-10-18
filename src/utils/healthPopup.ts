import type { HealthComunaCountRow } from "@/types/health";
import { fmtN, WARN } from "@/utils/healthScale";

/** Contenido del popup de una comuna (DOM con textContent: seguro contra XSS). Exportado para probarlo. */
export const buildComunaPopup = (row: HealthComunaCountRow | undefined, fallbackName: string, cut: string, filterText: string): HTMLElement => {
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
    add("Sin dato de la capa para esta comuna: no es lo mismo que 0.", "font-size:11px;color:#b45309;margin-top:4px");
  } else {
    add(`Establecimientos: ${fmtN(row.establishments)}${row.establishments === 0 ? " (cero verdadero)" : ""}`, "margin-top:4px");
    add(`Puesto ${row.rank} de 346 · ${row.region_name}`, "font-size:11px");
    if (row.imputed > 0) add(`${row.imputed} con clase imputada por tabla de diseño.`, "font-size:11px;color:#b45309");
    if (row.not_drawable > 0) add(`${row.not_drawable} sin ubicación dibujable (cuentan igual).`, "font-size:11px");
    if (row.marked_geo > 0) add(`${row.marked_geo} con ubicación marcada.`, "font-size:11px");
  }
  add(WARN.registry, "font-size:10px;opacity:.7;margin-top:4px");
  add(`CUT ${cut}`, "font-size:10px;opacity:.6");
  return el;
};
