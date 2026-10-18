import { useEffect, useMemo, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, Path, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import type { IsapreComunaRow, IsapreMetric, IsaprePenetracionRow } from "@/types/prevision";
import { buildIsapreComunaPopup, type PenetracionSources } from "@/utils/previsionPopup";
import { midpoint, PCT_FILL_OPACITY, PCT_NODATA_COLOR, pctColor, pctMid, type PctDomain } from "@/utils/previsionScale";
import { classify } from "@/utils/permitsScale";

interface Props {
  rows: IsapreComunaRow[] | undefined;
  breaks: number[];
  filterText: string;
  /** «n»: beneficiarios (escala por cuantiles, como siempre). «pct»: penetración, degradado continuo blanco → azul al 50 %. */
  metric?: IsapreMetric;
  /** Filas de get_isapre_penetracion() de TODAS las comunas (la ventana las usa siempre) y las que se pintan (tras el filtro «sin alta»). */
  penRows?: IsaprePenetracionRow[];
  penShown?: IsaprePenetracionRow[];
  domain?: PctDomain | null;
  sexoSinInfo?: boolean;
  sources?: PenetracionSources;
}

const HIGHLIGHT: PathOptions = { weight: 2, color: "hsl(199 89% 70%)", fillOpacity: 0.85 };

/**
 * Beneficiarios Isapre por comuna. Une `/comunas.geojson` con `get_isapre_comuna()` por `codigo_comuna`.
 * El color sale del PUNTO MEDIO del rango publicado (la ventana de la comuna muestra el rango). 0 publicado = color propio; comuna sin fila = «sin dato», gris punteado.
 * Con la métrica «pct» (1b-2) el color es un degradado continuo de blanco (menor %) a azul profundo sobre el punto medio del rango de penetración, con relleno al 50 %; sin dato, gris punteado.
 */
export const IsapreChoroplethLayer = ({ rows, breaks, filterText, metric = "n", penRows, penShown, domain, sexoSinInfo = false, sources }: Props) => {
  const { ready, fc, nombresPorCodigo } = useComunasGeoIndex(true);
  const geoRef = useRef<LeafletGeoJSON | null>(null);
  const hoverRef = useRef<Layer | null>(null);
  const rowByCut = useMemo(() => new Map((rows ?? []).map((r) => [r.cut, r])), [rows]);
  const penByCut = useMemo(() => new Map((penRows ?? []).map((r) => [r.cut, r])), [penRows]);
  const penShownByCut = useMemo(() => new Map((penShown ?? []).map((r) => [r.cut, r])), [penShown]);
  const latest = useRef({ rowByCut, nombresPorCodigo, filterText, penByCut, sexoSinInfo, sources });
  latest.current = { rowByCut, nombresPorCodigo, filterText, penByCut, sexoSinInfo, sources };

  const cutOf = (f?: Feature<Geometry, ComunaProps>) => String(f?.properties?.codigo_comuna ?? f?.properties?.cod_comuna ?? "");
  const styleFor = (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
    if (metric === "pct") {
      const mid = pctMid(penShownByCut.get(cutOf(feature)) ?? { pct_lo: null, pct_hi: null });
      if (mid == null || !domain) return { fillColor: PCT_NODATA_COLOR, fillOpacity: 0.4, color: "hsl(var(--border))", weight: 0.6, dashArray: "3 3" };
      return { fillColor: pctColor(mid, domain.max), fillOpacity: PCT_FILL_OPACITY, color: "hsl(var(--border))", weight: 0.6 };
    }
    const row = rowByCut.get(cutOf(feature));
    const c = classify(row ? midpoint(row) : null, "value", breaks);
    return { fillColor: c.color, fillOpacity: c.kind === "nodata" ? 0.4 : 0.72, color: "hsl(var(--border))", weight: 0.6, dashArray: c.kind === "nodata" ? "3 3" : undefined };
  };

  useEffect(() => {
    if (geoRef.current) {
      geoRef.current.setStyle(styleFor);
      hoverRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowByCut, breaks, ready, metric, penShownByCut, domain]);

  if (!ready || !fc) return null;

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const cut = cutOf(feature);
    layer.bindPopup(() => {
      const { rowByCut: byCut, nombresPorCodigo: names, filterText: ft, penByCut: pens, sexoSinInfo: si, sources: src } = latest.current;
      const pen = src ? { row: pens.get(cut), sexoSinInfo: si, sources: src } : undefined;
      return buildIsapreComunaPopup(byCut.get(cut), names[cut] ?? "Comuna", cut, ft, pen);
    });
    layer.on({
      mouseover: (e) => {
        const next = e.target as Path;
        const prev = hoverRef.current as Path | null;
        if (prev && prev !== next) geoRef.current?.resetStyle(prev as never);
        next.setStyle(HIGHLIGHT);
        next.bringToFront();
        hoverRef.current = next;
      },
    });
  };

  return <GeoJSON key="isapre-choropleth" ref={(r) => { geoRef.current = r as unknown as LeafletGeoJSON | null; }} data={fc} style={styleFor} onEachFeature={onEachFeature} />;
};
