import { useEffect, useMemo, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import { nameTooltip, useComunaHover } from "@/hooks/useComunaHover";
import type { IsapreComunaRow, IsapreMetric, IsaprePenetracionRow } from "@/types/prevision";
import { classify, N_SCALE, PCT_SCALE } from "@/utils/isapreClasses";
import { buildIsapreComunaPopup, type PenetracionSources } from "@/utils/previsionPopup";
import { midpoint, pctMid } from "@/utils/previsionScale";

/** Borde de comuna: explícito (un gris medio visible sobre los mapas Oscuro, Claro y Satélite); no depende de una variable CSS dentro de un atributo SVG. */
export const BORDER_COLOR = "#6b7280";
export const BORDER_WEIGHT = 0.8;

interface Props {
  rows: IsapreComunaRow[] | undefined;
  filterText: string;
  /** «n»: beneficiarios; «pct»: penetración. Las dos usan clases discretas de la misma familia de color (viridis de 7 clases, relleno 0,7). */
  metric?: IsapreMetric;
  /** Filas de get_isapre_penetracion() de TODAS las comunas (la ventana las usa siempre) y las que se pintan (tras el filtro «sin alta»). */
  penRows?: IsaprePenetracionRow[];
  penShown?: IsaprePenetracionRow[];
  sexoSinInfo?: boolean;
  sources?: PenetracionSources;
}

/**
 * Beneficiarios Isapre por comuna. Une `/comunas.geojson` con `get_isapre_comuna()` por `codigo_comuna`.
 * El color sale del PUNTO MEDIO del rango publicado (la ventana de la comuna muestra el rango). 0 publicado = color propio; comuna sin fila = «sin dato», gris punteado.
 * Con la métrica «pct» (1b-2) el color sale del punto medio del rango de penetración. En las dos métricas: clases discretas (isapreClasses.ts), relleno 0,7, borde visible, sin dato gris punteado.
 */
export const IsapreChoroplethLayer = ({ rows, filterText, metric = "n", penRows, penShown, sexoSinInfo = false, sources }: Props) => {
  const { ready, fc, nombresPorCodigo } = useComunasGeoIndex(true);
  const rowByCut = useMemo(() => new Map((rows ?? []).map((r) => [r.cut, r])), [rows]);
  const penByCut = useMemo(() => new Map((penRows ?? []).map((r) => [r.cut, r])), [penRows]);
  const penShownByCut = useMemo(() => new Map((penShown ?? []).map((r) => [r.cut, r])), [penShown]);
  const latest = useRef({ rowByCut, nombresPorCodigo, filterText, penByCut, sexoSinInfo, sources, metric });
  latest.current = { rowByCut, nombresPorCodigo, filterText, penByCut, sexoSinInfo, sources, metric };

  const cutOf = (f?: Feature<Geometry, ComunaProps>) => String(f?.properties?.codigo_comuna ?? f?.properties?.cod_comuna ?? "");
  const styleFor = (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
    const cut = cutOf(feature);
    const c = metric === "pct"
      ? classify(PCT_SCALE, pctMid(penShownByCut.get(cut) ?? { pct_lo: null, pct_hi: null }))
      : classify(N_SCALE, rowByCut.get(cut) ? midpoint(rowByCut.get(cut)!) : null);
    return { fillColor: c.color, fillOpacity: c.fillOpacity, color: BORDER_COLOR, weight: BORDER_WEIGHT, dashArray: c.dashed ? "3 3" : undefined };
  };

  const hover = useComunaHover(styleFor as never);
  useEffect(() => {
    hover.restyle();     // datos o métrica nuevos: restila todo SIN perder el resaltado de la comuna bajo el puntero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowByCut, ready, metric, penShownByCut]);

  if (!ready || !fc) return null;

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const cut = cutOf(feature);
    hover.bind(layer, nameTooltip(() => latest.current.rowByCut.get(cut)?.name ?? latest.current.nombresPorCodigo[cut] ?? "Comuna"));
    layer.bindPopup(() => {
      const { rowByCut: byCut, nombresPorCodigo: names, filterText: ft, penByCut: pens, sexoSinInfo: si, sources: src, metric: m } = latest.current;
      const pen = src ? { row: pens.get(cut), sexoSinInfo: si, sources: src, metric: m } : undefined;
      return buildIsapreComunaPopup(byCut.get(cut), names[cut] ?? "Comuna", cut, ft, pen);
    });
  };

  return <GeoJSON key="isapre-choropleth" ref={hover.setRef} data={fc} style={hover.style as never} onEachFeature={onEachFeature} />;
};
