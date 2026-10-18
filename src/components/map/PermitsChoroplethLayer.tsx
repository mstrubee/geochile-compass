import { useEffect, useMemo, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import { nameTooltip, useComunaHover } from "@/hooks/useComunaHover";
import type { PermitChoroplethRow, PermitSelection } from "@/types/permits";
import { classify, displayValue, formatPermitValue, METRIC_LABEL, periodLabel } from "@/utils/permitsScale";

interface Props {
  rows: PermitChoroplethRow[] | undefined;
  selection: PermitSelection;
  breaks: number[];
  onSelectComuna: (cut: string, name: string) => void;
}

/**
 * Coropleta por comuna de "Permisos de edificación". Une el GeoJSON estático (`/comunas.geojson`, por
 * `codigo_comuna`, SIEMPRE texto de 5 dígitos) con las filas de `get_permit_choropleth()`.
 * Una comuna sin fila o sin valor se pinta como "sin dato" (gris con borde punteado): NUNCA como 0.
 */
export const PermitsChoroplethLayer = ({ rows, selection, breaks, onSelectComuna }: Props) => {
  const { ready, fc, nombresPorCodigo } = useComunasGeoIndex(true);
  const rowByCut = useMemo(() => new Map((rows ?? []).map((r) => [r.comuna_cut, r])), [rows]);

  // Los popups se construyen al abrirse: leen SIEMPRE lo último vía ref (no quedan con datos viejos).
  const latest = useRef({ rowByCut, selection, nombresPorCodigo, onSelectComuna });
  latest.current = { rowByCut, selection, nombresPorCodigo, onSelectComuna };

  const cutOf = (f?: Feature<Geometry, ComunaProps>) => String(f?.properties?.codigo_comuna ?? f?.properties?.cod_comuna ?? "");

  const styleFor = (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
    const row = rowByCut.get(cutOf(feature));
    const c = classify(displayValue(row, selection.display), selection.display, breaks);
    return {
      fillColor: c.color,
      fillOpacity: c.kind === "nodata" ? 0.4 : 0.72,
      color: "hsl(var(--border))",
      weight: 0.6,
      dashArray: c.kind === "nodata" ? "3 3" : undefined,
    };
  };

  const hover = useComunaHover(styleFor as never);
  useEffect(() => {
    hover.restyle();     // datos o selección nuevos: restila todo SIN perder el resaltado de la comuna bajo el puntero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowByCut, selection.display, selection.metric, breaks, ready]);

  if (!ready || !fc) return null;

  const popupFor = (cut: string): HTMLElement => {
    const { rowByCut: byCut, selection: sel, nombresPorCodigo: names, onSelectComuna: onSelect } = latest.current;
    const row = byCut.get(cut);
    const name = row?.comuna_name ?? names[cut] ?? "Comuna";
    const el = document.createElement("div");
    el.style.minWidth = "190px";
    const add = (text: string, style = "") => {
      const d = document.createElement("div");
      d.textContent = text;
      d.setAttribute("style", style);
      el.appendChild(d);
      return d;
    };
    add(name, "font-weight:600");
    add(`${METRIC_LABEL[sel.metric]} · ${periodLabel(sel)}`, "font-size:11px;opacity:.8");
    add(`Valor: ${formatPermitValue(row?.value, sel.metric, "value")}`, "margin-top:4px");
    if (row?.prev_value != null) add(`Mismo período del año anterior: ${formatPermitValue(row.prev_value, sel.metric, "value")}`, "font-size:11px");
    add(`Variación interanual: ${formatPermitValue(row?.yoy_pct, sel.metric, "yoy")}`, "font-size:11px");
    if (row?.value == null) add("Sin dato para este período: no es lo mismo que 0.", "font-size:11px;color:#b45309;margin-top:2px");
    if (row?.is_provisional) add("Cifra preliminar (aún no definitiva).", "font-size:11px;color:#b45309");
    add(`CUT ${cut}`, "font-size:10px;opacity:.6;margin-top:2px");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Ver serie y fuente";
    btn.setAttribute("style", "margin-top:6px;font-size:12px;text-decoration:underline;color:hsl(199 89% 38%);cursor:pointer;background:none;border:0;padding:0");
    btn.addEventListener("click", () => onSelect(cut, name));
    el.appendChild(btn);
    return el;
  };

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const cut = cutOf(feature);
    hover.bind(layer, nameTooltip(() => latest.current.rowByCut.get(cut)?.comuna_name ?? latest.current.nombresPorCodigo[cut] ?? "Comuna"));
    layer.bindPopup(() => popupFor(cut));
  };

  return (
    <GeoJSON
      key="permits-choropleth"
      ref={hover.setRef}
      data={fc}
      style={hover.style as never}
      onEachFeature={onEachFeature}
    />
  );
};
