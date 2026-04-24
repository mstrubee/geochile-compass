import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { SavedPoi } from "@/types/pois";

interface Props {
  pois: SavedPoi[];
  visible: boolean;
}

export const SavedPoisLayer = ({ pois, visible }: Props) => {
  const map = useMap();

  useEffect(() => {
    if (!visible || !pois.length) return;
    const group = L.featureGroup().addTo(map);

    pois.forEach((p) => {
      const color = p.color || "#34D399";
      const iconUrl = isImageUrl(p.icon);
      const marker: L.Layer = iconUrl
        ? L.marker([p.lat, p.lng], {
            icon: L.icon({
              iconUrl,
              iconSize: [28, 28],
              iconAnchor: [14, 28],
              popupAnchor: [0, -26],
              className: "saved-poi-icon",
            }),
          })
        : L.circleMarker([p.lat, p.lng], {
            radius: 6,
            color: "#fff",
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.95,
          });
      const desc = p.description ? `<br/>${escapeHtml(p.description)}` : "";
      const cat = p.category
        ? `<div style="opacity:.7;font-size:11px;margin-top:2px">${escapeHtml(
            p.category,
          )}</div>`
        : "";
      (marker as L.Marker | L.CircleMarker).bindPopup(
        `<div style="font-size:12px;min-width:140px"><b>${escapeHtml(
          p.name,
        )}</b>${desc}${cat}</div>`,
      );
      marker.addTo(group);
    });

    return () => {
      group.remove();
    };
  }, [map, pois, visible]);

  return null;
};

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
