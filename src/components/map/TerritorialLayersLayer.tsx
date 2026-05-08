import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { TerritorialLayer } from "@/types/territorial";
import { useTerritorialFeatures } from "@/hooks/useTerritorialLayers";

interface Props {
  layers: TerritorialLayer[];
  visibleLayerIds: Set<string>;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const TerritorialLayersLayer = ({ layers, visibleLayerIds }: Props) => {
  const map = useMap();
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const visibleIds = useMemo(
    () => layers.filter((l) => visibleLayerIds.has(l.id)).map((l) => l.id),
    [layers, visibleLayerIds],
  );
  const features = useTerritorialFeatures(visibleIds);
  const groupsRef = useRef<Map<string, L.LayerGroup>>(new Map());

  useEffect(() => {
    const layerColorById = new Map(layers.map((l) => [l.id, l.color || "#F59E0B"]));
    const layerNameById = new Map(layers.map((l) => [l.id, l.name]));

    // remove groups for layers no longer visible
    groupsRef.current.forEach((g, id) => {
      if (!visibleLayerIds.has(id)) {
        g.remove();
        groupsRef.current.delete(id);
      }
    });

    // group features by layer
    const byLayer = new Map<string, typeof features>();
    features.forEach((f) => {
      if (!byLayer.has(f.layer_id)) byLayer.set(f.layer_id, []);
      byLayer.get(f.layer_id)!.push(f);
    });

    byLayer.forEach((feats, layerId) => {
      // refresh: remove old, add new
      const old = groupsRef.current.get(layerId);
      if (old) old.remove();
      const group = L.layerGroup().addTo(map);
      groupsRef.current.set(layerId, group);
      const color = layerColorById.get(layerId) || "#F59E0B";
      const layerName = layerNameById.get(layerId) || "";

      feats.forEach((f) => {
        try {
          const geom = f.geometry;
          if (!geom) return;
          if (geom.type === "Point" && f.lat != null && f.lng != null) {
            const m = L.circleMarker([f.lat, f.lng], {
              renderer: canvasRenderer,
              radius: 6,
              color: "#fff",
              weight: 1.5,
              fillColor: color,
              fillOpacity: 0.95,
            });
            m.bindPopup(
              `<div style="font-size:12px"><b>${escapeHtml(f.name || layerName)}</b></div>`,
            );
            m.addTo(group);
          } else {
            const gj = L.geoJSON(geom as GeoJSON.Geometry, {
              renderer: canvasRenderer,
              style: { color, weight: 2, fillColor: color, fillOpacity: 0.25 },
            });
            gj.bindPopup(
              `<div style="font-size:12px"><b>${escapeHtml(f.name || layerName)}</b></div>`,
            );
            gj.addTo(group);
          }
        } catch (e) {
          console.warn("Failed to render territorial feature", e);
        }
      });
    });
  }, [features, layers, visibleLayerIds, map, canvasRenderer]);

  useEffect(() => {
    return () => {
      groupsRef.current.forEach((g) => g.remove());
      groupsRef.current.clear();
    };
  }, []);

  return null;
};
