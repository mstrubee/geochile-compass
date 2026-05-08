import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { TerritorialLayer } from "@/types/territorial";
import { useTerritorialFeatures } from "@/hooks/useTerritorialLayers";

interface Props {
  layers: TerritorialLayer[];
  visibleLayerIds: Set<string>;
  heatmap?: boolean;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const TerritorialLayersLayer = ({ layers, visibleLayerIds, heatmap = false }: Props) => {
  const map = useMap();
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  
  const visibleIds = useMemo(
    () => layers.filter((l) => visibleLayerIds.has(l.id)).map((l) => l.id),
    [layers, visibleLayerIds],
  );
  const showHeatmap = heatmap && visibleIds.length > 0;
  const features = useTerritorialFeatures(visibleIds);
  const groupsRef = useRef<Map<string, L.LayerGroup>>(new Map());
  const heatLayerRef = useRef<L.Layer | null>(null);

  // Nota: deliberadamente NO se hace fitBounds al activar capas, para preservar
  // el zoom/centro actual del usuario. Si se quiere centrar, hay que usar una
  // acción explícita ("Centrar capa").

  useEffect(() => {
    // Remove heat layer if heatmap disabled or no features
    if (heatLayerRef.current) {
      heatLayerRef.current.remove();
      heatLayerRef.current = null;
    }
    if (!showHeatmap) return;

    // layer_id -> group_id, para detectar superposición de grupos por celda
    const groupByLayer = new Map(layers.map((l) => [l.id, l.group_id]));

    type RawPt = { lat: number; lng: number; groupId: string };
    const raw: RawPt[] = [];
    features.forEach((f) => {
      const groupId = groupByLayer.get(f.layer_id) || f.layer_id;
      if (f.lat != null && f.lng != null) {
        raw.push({ lat: f.lat, lng: f.lng, groupId });
      } else if (f.geometry && (f.geometry as GeoJSON.Geometry).type === "Point") {
        const coords = (f.geometry as GeoJSON.Point).coordinates;
        if (coords && coords.length >= 2)
          raw.push({ lat: coords[1], lng: coords[0], groupId });
      }
    });
    if (!raw.length) return;

    // Discretizar en grilla (~0.002° ≈ radio del heatmap a zoom medio).
    const CELL = 0.002;
    const cellKey = (lat: number, lng: number) =>
      `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
    const cellGroups = new Map<string, Set<string>>();
    raw.forEach((p) => {
      const k = cellKey(p.lat, p.lng);
      let s = cellGroups.get(k);
      if (!s) {
        s = new Set();
        cellGroups.set(k, s);
      }
      s.add(p.groupId);
    });

    // Bonus por superposición de grupos en la celda.
    const BONUS = 0.75;
    const points: Array<[number, number, number]> = raw.map((p) => {
      const nGroups = cellGroups.get(cellKey(p.lat, p.lng))?.size || 1;
      const weight = 1 + (nGroups - 1) * BONUS;
      return [p.lat, p.lng, weight];
    });

    const heat = (L as unknown as {
      heatLayer: (pts: Array<[number, number, number]>, opts: Record<string, unknown>) => L.Layer;
    }).heatLayer(points, {
      radius: 25,
      blur: 18,
      maxZoom: 17,
      minOpacity: 0.35,
      // Evita saturar el gradiente apenas hay solapamiento de grupos.
      max: 4,
      gradient: {
        0.0: "#2563eb",
        0.3: "#22d3ee",
        0.5: "#84cc16",
        0.7: "#facc15",
        0.85: "#f97316",
        1.0: "#dc2626",
      },
    });
    heat.addTo(map);
    heatLayerRef.current = heat;
  }, [features, layers, showHeatmap, map]);

  useEffect(() => {
    const layerColorById = new Map(layers.map((l) => [l.id, l.color || "#F59E0B"]));
    const layerNameById = new Map(layers.map((l) => [l.id, l.name]));

    // remove groups for layers no longer visible (or all, if heatmap is on)
    groupsRef.current.forEach((g, id) => {
      if (showHeatmap || !visibleLayerIds.has(id)) {
        g.remove();
        groupsRef.current.delete(id);
      }
    });

    // In heatmap mode, do not render individual point/geometry markers
    if (showHeatmap) return;

    // group features by layer
    const byLayer = new Map<string, typeof features>();
    features.forEach((f) => {
      if (!byLayer.has(f.layer_id)) byLayer.set(f.layer_id, []);
      byLayer.get(f.layer_id)!.push(f);
    });

    byLayer.forEach((feats, layerId) => {
      // Si la capa ya está pintada con la misma cantidad de features, no recrear.
      const existing = groupsRef.current.get(layerId);
      if (existing && (existing as L.LayerGroup & { __count?: number }).__count === feats.length) {
        return;
      }
      if (existing) existing.remove();
      const group = L.layerGroup().addTo(map) as L.LayerGroup & { __count?: number };
      group.__count = feats.length;
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
              style: { renderer: canvasRenderer, color, weight: 2, fillColor: color, fillOpacity: 0.25 },
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
  }, [features, layers, visibleLayerIds, map, canvasRenderer, showHeatmap]);

  useEffect(() => {
    return () => {
      groupsRef.current.forEach((g) => g.remove());
      groupsRef.current.clear();
    };
  }, []);

  return null;
};
