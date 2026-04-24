import { useEffect } from "react";
import { GeoJSON, useMap, useMapEvents } from "react-leaflet";
import type { Layer } from "leaflet";
import type { Feature } from "geojson";
import type {
  ManzanaFeatureCollection,
  ManzanaProperties,
  ManzanaVariable,
} from "@/types/manzanas";
import { colorForManzana, VARIABLE_LABEL } from "@/utils/colorScales";
import { NSE_LABELS } from "@/data/communes";
import { fmtNum, fmtCLP, fmtDensity } from "@/utils/formatters";

interface ManzanaLayerProps {
  visible: boolean;
  data: ManzanaFeatureCollection | null;
  variable: ManzanaVariable;
  onViewportChange: (bbox: [number, number, number, number], zoom: number) => void;
}

export const ManzanaLayer = ({ visible, data, variable, onViewportChange }: ManzanaLayerProps) => {
  const map = useMap();

  // Push initial viewport once mounted
  useEffect(() => {
    if (typeof onViewportChange !== "function") return;
    const b = map.getBounds();
    onViewportChange(
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      map.getZoom()
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useMapEvents({
    moveend: () => {
      if (typeof onViewportChange !== "function") return;
      const b = map.getBounds();
      onViewportChange(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        map.getZoom()
      );
    },
    zoomend: () => {
      if (typeof onViewportChange !== "function") return;
      const b = map.getBounds();
      onViewportChange(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        map.getZoom()
      );
    },
  });

  if (!visible || !data) return null;

  const styleFn = (feature?: Feature) => {
    const p = feature?.properties as ManzanaProperties | undefined;
    if (!p) return {};
    const color = colorForManzana(variable, p);
    return {
      color,
      weight: 0.4,
      fillColor: color,
      fillOpacity: 0.55,
    };
  };

  const onEachFeature = (feature: Feature, layer: Layer) => {
    const p = feature.properties as ManzanaProperties;
    const html = `
      <div style="min-width:170px">
        <div style="font-weight:600;color:hsl(199 89% 60%);margin-bottom:4px;font-size:12px">
          Manzana · ${p.commune}
        </div>
        <div style="display:grid;grid-template-columns:auto auto;gap:2px 8px;font-size:10px">
          <span style="color:hsl(215 19% 50%)">Variable</span><span style="font-family:monospace">${VARIABLE_LABEL[variable]}</span>
          <span style="color:hsl(215 19% 50%)">Densidad</span><span style="font-family:monospace">${fmtDensity(p.density)}</span>
          <span style="color:hsl(215 19% 50%)">NSE</span><span style="font-family:monospace">${NSE_LABELS[p.nse]}</span>
          <span style="color:hsl(215 19% 50%)">Ingreso</span><span style="font-family:monospace">${fmtCLP(p.income)}</span>
          <span style="color:hsl(215 19% 50%)">Tráfico</span><span style="font-family:monospace">${p.traffic}/100</span>
          <span style="color:hsl(215 19% 50%)">Población</span><span style="font-family:monospace">${fmtNum(p.pop)}</span>
          <span style="color:hsl(215 19% 50%)">Hogares</span><span style="font-family:monospace">${fmtNum(p.hh)}</span>
        </div>
      </div>`;
    layer.bindPopup(html);
  };

  // Key forces re-render when data or variable changes
  const key = `${data.metadata.bbox.join(",")}|${variable}|${data.features.length}`;

  return (
    <GeoJSON
      key={key}
      data={data}
      style={styleFn}
      onEachFeature={onEachFeature}
    />
  );

  // Suppress unused
  void Popup;
};
