import { useEffect, useMemo, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import { nameTooltip, useComunaHover } from "@/hooks/useComunaHover";
import type { HealthComunaCountRow } from "@/types/health";
import { buildComunaPopup } from "@/utils/healthPopup";
import { classify } from "@/utils/permitsScale";

interface Props { rows: HealthComunaCountRow[] | undefined; breaks: number[]; filterText: string }

/**
 * Establecimientos por comuna (capa derivada). Une `/comunas.geojson` con `get_health_comuna_counts()` por `codigo_comuna` (texto de 5 dígitos).
 * 0 = cero verdadero (color propio); comuna sin fila = «sin dato», gris con borde punteado: NUNCA se confunde con 0.
 */
export const HealthChoroplethLayer = ({ rows, breaks, filterText }: Props) => {
  const { ready, fc, nombresPorCodigo } = useComunasGeoIndex(true);
  const rowByCut = useMemo(() => new Map((rows ?? []).map((r) => [r.cut, r])), [rows]);
  const latest = useRef({ rowByCut, nombresPorCodigo, filterText });
  latest.current = { rowByCut, nombresPorCodigo, filterText };

  const cutOf = (f?: Feature<Geometry, ComunaProps>) => String(f?.properties?.codigo_comuna ?? f?.properties?.cod_comuna ?? "");
  const styleFor = (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
    const row = rowByCut.get(cutOf(feature));
    const c = classify(row ? row.establishments : null, "value", breaks);
    return { fillColor: c.color, fillOpacity: c.kind === "nodata" ? 0.4 : 0.72, color: "hsl(var(--border))", weight: 0.6, dashArray: c.kind === "nodata" ? "3 3" : undefined };
  };

  const hover = useComunaHover(styleFor as never);
  useEffect(() => {
    hover.restyle();     // datos nuevos: restila todo SIN perder el resaltado de la comuna bajo el puntero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowByCut, breaks, ready]);

  if (!ready || !fc) return null;

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const cut = cutOf(feature);
    hover.bind(layer, nameTooltip(() => latest.current.rowByCut.get(cut)?.name ?? latest.current.nombresPorCodigo[cut] ?? "Comuna"));
    layer.bindPopup(() => {
      const { rowByCut: byCut, nombresPorCodigo: names, filterText: ft } = latest.current;
      return buildComunaPopup(byCut.get(cut), names[cut] ?? "Comuna", cut, ft);
    });
  };

  return <GeoJSON key="health-choropleth" ref={hover.setRef} data={fc} style={hover.style as never} onEachFeature={onEachFeature} />;
};
