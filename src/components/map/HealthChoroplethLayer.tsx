import { useEffect, useMemo, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, Path, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import type { HealthComunaCountRow } from "@/types/health";
import { buildComunaPopup } from "@/utils/healthPopup";
import { classify } from "@/utils/permitsScale";

interface Props { rows: HealthComunaCountRow[] | undefined; breaks: number[]; filterText: string }

const HIGHLIGHT: PathOptions = { weight: 2, color: "hsl(199 89% 70%)", fillOpacity: 0.85 };

/**
 * Establecimientos por comuna (capa derivada). Une `/comunas.geojson` con `get_health_comuna_counts()` por `codigo_comuna` (texto de 5 dígitos).
 * 0 = cero verdadero (color propio); comuna sin fila = «sin dato», gris con borde punteado: NUNCA se confunde con 0.
 */
export const HealthChoroplethLayer = ({ rows, breaks, filterText }: Props) => {
  const { ready, fc, nombresPorCodigo } = useComunasGeoIndex(true);
  const geoRef = useRef<LeafletGeoJSON | null>(null);
  const hoverRef = useRef<Layer | null>(null);
  const rowByCut = useMemo(() => new Map((rows ?? []).map((r) => [r.cut, r])), [rows]);
  const latest = useRef({ rowByCut, nombresPorCodigo, filterText });
  latest.current = { rowByCut, nombresPorCodigo, filterText };

  const cutOf = (f?: Feature<Geometry, ComunaProps>) => String(f?.properties?.codigo_comuna ?? f?.properties?.cod_comuna ?? "");
  const styleFor = (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
    const row = rowByCut.get(cutOf(feature));
    const c = classify(row ? row.establishments : null, "value", breaks);
    return { fillColor: c.color, fillOpacity: c.kind === "nodata" ? 0.4 : 0.72, color: "hsl(var(--border))", weight: 0.6, dashArray: c.kind === "nodata" ? "3 3" : undefined };
  };

  useEffect(() => {
    if (geoRef.current) {
      geoRef.current.setStyle(styleFor);
      hoverRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowByCut, breaks, ready]);

  if (!ready || !fc) return null;

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const cut = cutOf(feature);
    layer.bindPopup(() => {
      const { rowByCut: byCut, nombresPorCodigo: names, filterText: ft } = latest.current;
      return buildComunaPopup(byCut.get(cut), names[cut] ?? "Comuna", cut, ft);
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

  return <GeoJSON key="health-choropleth" ref={(r) => { geoRef.current = r as unknown as LeafletGeoJSON | null; }} data={fc} style={styleFor} onEachFeature={onEachFeature} />;
};
