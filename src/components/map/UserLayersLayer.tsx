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
          style: () => ({
            color: ul.color,
            weight: 2,
            fillColor: ul.color,
            fillOpacity: 0.25,
          }),
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, {
              radius: 5,
              color: ul.color,
              weight: 2,
              fillColor: ul.color,
              fillOpacity: 0.7,
            }),
          onEachFeature: (feature, layer) => {
            const props = feature.properties ?? {};
            const name = props.name || props.Name || props.NAME || ul.name;
            layer.bindPopup(`<strong>${name}</strong>`);
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
