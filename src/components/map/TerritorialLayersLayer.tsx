import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { TerritorialLayer } from "@/types/territorial";
import { useTerritorialFeatures } from "@/hooks/useTerritorialLayers";
import { useLayerStyles } from "@/hooks/useLayerStyles";

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
  const { getStyle, version: layerStylesVersion } = useLayerStyles();

  const visibleIds = useMemo(
    () => layers.filter((l) => visibleLayerIds.has(l.id)).map((l) => l.id),
    [layers, visibleLayerIds],
  );
  const showHeatmap = heatmap && visibleIds.length > 0;
  const features = useTerritorialFeatures(visibleIds);
  // __count y __styleVersion evitan re-render si no cambió nada
  const groupsRef = useRef<Map<string, L.LayerGroup & { __count?: number; __styleVersion?: number }>>(new Map());
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
    // Construir mapa id→estilo efectivo (DB + override local)
    const layerNameById = new Map(layers.map((l) => [l.id, l.name]));
    const layerStyleMap = new Map(
      layers.map((l) => [l.id, getStyle(l.id, l.color, l.icon)] as const),
    );

    // Eliminar grupos de capas que ya no son visibles (o todas si heatmap activo)
    groupsRef.current.forEach((g, id) => {
      if (showHeatmap || !visibleLayerIds.has(id)) {
        g.remove();
        groupsRef.current.delete(id);
      }
    });

    // En modo heatmap no renderizamos marcadores individuales
    if (showHeatmap) return;

    // Agrupar features por capa
    const byLayer = new Map<string, typeof features>();
    features.forEach((f) => {
      if (!byLayer.has(f.layer_id)) byLayer.set(f.layer_id, []);
      byLayer.get(f.layer_id)!.push(f);
    });

    // Helper: determina si el ícono es una URL, data-URI o emoji
    const isUrl = (s: string | null) =>
      !!s && (s.startsWith("http") || s.startsWith("/") || s.startsWith("data:"));

    byLayer.forEach((feats, layerId) => {
      const existing = groupsRef.current.get(layerId);
      // Saltar si ya está pintado con mismas features Y mismo versión de estilos
      if (
        existing &&
        existing.__count        === feats.length &&
        existing.__styleVersion === layerStylesVersion
      ) {
        return;
      }
      if (existing) existing.remove();

      const group = L.layerGroup().addTo(map) as L.LayerGroup & { __count?: number; __styleVersion?: number };
      group.__count        = feats.length;
      group.__styleVersion = layerStylesVersion;
      groupsRef.current.set(layerId, group);

      const eff       = layerStyleMap.get(layerId);
      const color     = eff?.color    ?? "#F59E0B";
      const layerIcon = eff?.icon     ?? null;
      const iconSize  = Math.max(12, Math.min(40, eff?.iconSize ?? 22));
      const layerName = layerNameById.get(layerId) || "";
      const half      = iconSize / 2;

      feats.forEach((f) => {
        try {
          const geom = f.geometry;
          if (!geom) return;
          if (geom.type === "Point" && f.lat != null && f.lng != null) {
            let marker: L.Marker | L.CircleMarker;

            if (layerIcon && isUrl(layerIcon)) {
              // URL / data-URI → ícono imagen con tamaño configurable
              marker = L.marker([f.lat, f.lng], {
                icon: L.icon({
                  iconUrl:     layerIcon,
                  iconSize:    [iconSize, iconSize],
                  iconAnchor:  [half, half],
                  popupAnchor: [0, -(half + 2)],
                }),
              });
            } else if (layerIcon) {
              // Emoji / texto → divIcon con tamaño configurable
              const fontSize = Math.max(9, Math.round(iconSize * 0.55));
              marker = L.marker([f.lat, f.lng], {
                icon: L.divIcon({
                  className: "",
                  html: `<div style="display:flex;align-items:center;justify-content:center;width:${iconSize}px;height:${iconSize}px;border-radius:50%;background:${escapeHtml(color)};border:2px solid rgba(255,255,255,0.8);font-size:${fontSize}px;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.35)">${escapeHtml(layerIcon)}</div>`,
                  iconSize:    [iconSize, iconSize],
                  iconAnchor:  [half, half],
                  popupAnchor: [0, -(half + 2)],
                }),
              });
            } else {
              // Círculo por defecto (canvas renderer, eficiente)
              const radius = Math.max(3, Math.round(iconSize / 2 - 2));
              marker = L.circleMarker([f.lat, f.lng], {
                renderer:    canvasRenderer,
                radius,
                color:       "#fff",
                weight:      1.5,
                fillColor:   color,
                fillOpacity: 0.95,
              });
            }

            marker.bindPopup(
              `<div style="font-size:12px"><b>${escapeHtml(f.name || layerName)}</b></div>`,
            );
            marker.addTo(group);
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
  }, [features, layers, visibleLayerIds, map, canvasRenderer, showHeatmap, getStyle, layerStylesVersion]);

  useEffect(() => {
    return () => {
      groupsRef.current.forEach((g) => g.remove());
      groupsRef.current.clear();
    };
  }, []);

  return null;
};
