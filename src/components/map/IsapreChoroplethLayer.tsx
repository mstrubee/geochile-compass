import { useEffect, useMemo, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, Path, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import type { IsapreComunaRow } from "@/types/prevision";
import { buildIsapreComunaPopup } from "@/utils/previsionPopup";
import { midpoint } from "@/utils/previsionScale";
import { classify } from "@/utils/permitsScale";

interface Props { rows: IsapreComunaRow[] | undefined; breaks: number[]; filterText: string }

const HIGHLIGHT: PathOptions = { weight: 2, color: "hsl(199 89% 70%)", fillOpacity: 0.85 };

/**
 * Beneficiarios Isapre por comuna. Une `/comunas.geojson` con `get_isapre_comuna()` por `codigo_comuna`.
 * El color sale del PUNTO MEDIO del rango publicado (la ventana de la comuna muestra el rango). 0 publicado = color propio; comuna sin fila = «sin dato», gris punteado.
 */
export const IsapreChoroplethLayer = ({ rows, breaks, filterText }: Props) => {
  const { ready, fc, nombresPorCodigo } = useComunasGeoIndex(true);
  const geoRef = useRef<LeafletGeoJSON | null>(null);
  const hoverRef = useRef<Layer | null>(null);
  const rowByCut = useMemo(() => new Map((rows ?? []).map((r) => [r.cut, r])), [rows]);
  const latest = useRef({ rowByCut, nombresPorCodigo, filterText });
  latest.current = { rowByCut, nombresPorCodigo, filterText };

  const cutOf = (f?: Feature<Geometry, ComunaProps>) => String(f?.properties?.codigo_comuna ?? f?.properties?.cod_comuna ?? "");
  const styleFor = (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
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
  }, [rowByCut, breaks, ready]);

  if (!ready || !fc) return null;

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const cut = cutOf(feature);
    layer.bindPopup(() => {
      const { rowByCut: byCut, nombresPorCodigo: names, filterText: ft } = latest.current;
      return buildIsapreComunaPopup(byCut.get(cut), names[cut] ?? "Comuna", cut, ft);
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
