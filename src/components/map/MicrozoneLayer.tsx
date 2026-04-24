import { useEffect, useMemo, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { Microzone, MicrozoneSubmode } from "@/types/microzones";

interface Props {
  microzones: Microzone[];
  /** true cuando el modo "microzone" está activo */
  active: boolean;
  submode: MicrozoneSubmode;
  /** Vértices del polígono en construcción (en draft) */
  draftVertices: Array<{ lat: number; lng: number }>;
  onAddVertex: (c: { lat: number; lng: number }) => void;
  onClosePolygon: () => void;
  onBufferClick: (c: { lat: number; lng: number }) => void;
  fitId: string | null;
  onFitDone: () => void;
}

const microGeoJsonStyle = (color: string, visible: boolean): L.PathOptions => ({
  color,
  weight: 2,
  opacity: visible ? 0.95 : 0,
  fillColor: color,
  fillOpacity: visible ? 0.18 : 0,
});

export const MicrozoneLayer = ({
  microzones,
  active,
  submode,
  draftVertices,
  onAddVertex,
  onClosePolygon,
  onBufferClick,
  fitId,
  onFitDone,
}: Props) => {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);

  // Capa principal (microzonas guardadas)
  useEffect(() => {
    const lg = L.layerGroup().addTo(map);
    layerRef.current = lg;
    return () => {
      lg.remove();
      layerRef.current = null;
    };
  }, [map]);

  // Capa de borrador
  useEffect(() => {
    const lg = L.layerGroup().addTo(map);
    draftLayerRef.current = lg;
    return () => {
      lg.remove();
      draftLayerRef.current = null;
    };
  }, [map]);

  // Render de microzonas
  useEffect(() => {
    const lg = layerRef.current;
    if (!lg) return;
    lg.clearLayers();
    microzones.forEach((mz) => {
      try {
        const layer = L.geoJSON(mz.geometry as Feature<Polygon | MultiPolygon>, {
          style: microGeoJsonStyle(mz.color, mz.visible),
        });
        if (mz.visible) {
          const popupHtml = `<div style="font-family: system-ui; font-size: 12px;">
            <strong>${mz.name}</strong><br/>
            ${mz.stats ? `Área: ${mz.stats.area_km2.toFixed(2)} km²<br/>Manzanas: ${mz.stats.manzanaCount}<br/>Población: ${mz.stats.pop.toLocaleString("es-CL")}` : ""}
          </div>`;
          layer.bindPopup(popupHtml);
        }
        lg.addLayer(layer);
      } catch (e) {
        console.warn("Microzone render failed", e);
      }
    });
  }, [microzones]);

  // Render del borrador (polígono en construcción)
  useEffect(() => {
    const lg = draftLayerRef.current;
    if (!lg) return;
    lg.clearLayers();
    if (!active || submode !== "polygon" || draftVertices.length === 0) return;
    const latlngs = draftVertices.map((v) => L.latLng(v.lat, v.lng));
    // Vértices como círculos
    latlngs.forEach((ll) => {
      L.circleMarker(ll, {
        radius: 4,
        color: "#8B5CF6",
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 1,
      }).addTo(lg);
    });
    if (latlngs.length === 1) return;
    if (latlngs.length === 2) {
      L.polyline(latlngs, { color: "#8B5CF6", weight: 2, dashArray: "4 4" }).addTo(lg);
    } else {
      // Cerrar visualmente
      L.polygon(latlngs, {
        color: "#8B5CF6",
        weight: 2,
        dashArray: "4 4",
        fillColor: "#8B5CF6",
        fillOpacity: 0.1,
      }).addTo(lg);
    }
  }, [draftVertices, active, submode]);

  // Eventos del mapa
  useMapEvents({
    click: (e) => {
      if (!active) return;
      const c = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (submode === "polygon") onAddVertex(c);
      else if (submode === "buffer") onBufferClick(c);
      // voronoi se calcula sin clic
    },
    dblclick: (e) => {
      if (!active || submode !== "polygon") return;
      L.DomEvent.preventDefault(e.originalEvent);
      onClosePolygon();
    },
  });

  // Desactivar zoom con doble clic en modo polígono para no estorbar
  useEffect(() => {
    if (active && submode === "polygon") {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
    return () => {
      map.doubleClickZoom.enable();
    };
  }, [active, submode, map]);

  // Fit a microzona seleccionada
  const visibleKey = useMemo(() => microzones.map((m) => m.id).join(","), [microzones]);
  useEffect(() => {
    if (!fitId) return;
    const mz = microzones.find((m) => m.id === fitId);
    if (!mz) return;
    try {
      const layer = L.geoJSON(mz.geometry);
      const b = layer.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [40, 40] });
    } catch (e) {
      console.warn("fit microzone failed", e);
    }
    onFitDone();
  }, [fitId, microzones, map, onFitDone, visibleKey]);

  return null;
};
