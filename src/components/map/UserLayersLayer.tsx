import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { UserLayer } from "@/types/userLayers";

interface Props {
  layers: UserLayer[];
  fitId: string | null;
  onFitDone: () => void;
}

export const UserLayersLayer = ({ layers, fitId, onFitDone }: Props) => {
  const map = useMap();
  const groupsRef = useRef<Map<string, L.GeoJSON>>(new Map());

  useEffect(() => {
    const groups = groupsRef.current;
    const seen = new Set<string>();

    layers.forEach((ul) => {
      seen.add(ul.id);
      let group = groups.get(ul.id);
      if (!group) {
        group = L.geoJSON(ul.data, {
          style: (feature) => {
            const p = (feature?.properties ?? {}) as Record<string, unknown>;
            const stroke = (p.stroke as string) || (p["stroke-color"] as string) || ul.color;
            const fill = (p.fill as string) || stroke;
            const weight = typeof p["stroke-width"] === "number" ? (p["stroke-width"] as number) : 2;
            const fillOpacity =
              typeof p["fill-opacity"] === "number" ? (p["fill-opacity"] as number) : 0.25;
            const strokeOpacity =
              typeof p["stroke-opacity"] === "number" ? (p["stroke-opacity"] as number) : 1;
            return { color: stroke, weight, opacity: strokeOpacity, fillColor: fill, fillOpacity };
          },
          pointToLayer: (feature, latlng) => {
            const p = (feature?.properties ?? {}) as Record<string, unknown>;
            const iconUrl = (p.icon as string) || (p["marker-symbol"] as string);
            if (typeof iconUrl === "string" && /^(https?:|data:)/i.test(iconUrl)) {
              const scale = typeof p["icon-scale"] === "number" ? (p["icon-scale"] as number) : 1;
              const size = Math.max(16, Math.round(32 * scale));
              const icon = L.icon({
                iconUrl,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
                popupAnchor: [0, -size / 2],
                className: "user-layer-icon",
              });
              return L.marker(latlng, { icon });
            }
            return L.circleMarker(latlng, {
              radius: 5,
              color: ul.color,
              weight: 2,
              fillColor: ul.color,
              fillOpacity: 0.7,
            });
          },
          onEachFeature: (feature, layer) => {
            const props = feature.properties ?? {};
            const name = props.name || props.Name || props.NAME || ul.name;
            const desc = props.description || props.Description || "";
            layer.bindPopup(
              `<strong>${name}</strong>${desc ? `<br/><span style="font-size:11px;opacity:.8">${desc}</span>` : ""}`
            );
          },
        });
        groups.set(ul.id, group);
      }
      if (ul.visible) {
        if (!map.hasLayer(group)) group.addTo(map);
      } else {
        if (map.hasLayer(group)) map.removeLayer(group);
      }
    });

    // Remove deleted
    groups.forEach((group, id) => {
      if (!seen.has(id)) {
        if (map.hasLayer(group)) map.removeLayer(group);
        groups.delete(id);
      }
    });
  }, [layers, map]);

  // Fit bounds when requested
  useEffect(() => {
    if (!fitId) return;
    const group = groupsRef.current.get(fitId);
    if (group) {
      const bounds = group.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    }
    onFitDone();
  }, [fitId, map, onFitDone]);

  // Cleanup all on unmount
  useEffect(() => {
    return () => {
      groupsRef.current.forEach((g) => {
        if (map.hasLayer(g)) map.removeLayer(g);
      });
      groupsRef.current.clear();
    };
  }, [map]);

  return null;
};
