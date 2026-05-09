import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { SavedPoi } from "@/types/pois";

interface Props {
  pois: SavedPoi[];
  visible: boolean;
  /** Si se pasa, suplanta el popup nativo y dispara este callback al click. */
  onPoiClick?: (poi: SavedPoi) => void;
  /** Modo selección: cuando está en true, el cursor cambia y el click llama a onPickPoi. */
  pickMode?: boolean;
  onPickPoi?: (poi: SavedPoi) => void;
}

export const SavedPoisLayer = ({ pois, visible, onPoiClick, pickMode, onPickPoi }: Props) => {
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
              iconSize: pickMode ? [36, 36] : [28, 28],
              iconAnchor: pickMode ? [18, 36] : [14, 28],
              popupAnchor: [0, -26],
              className: pickMode ? "saved-poi-icon saved-poi-pick" : "saved-poi-icon",
            }),
          })
        : L.circleMarker([p.lat, p.lng], {
            radius: pickMode ? 9 : 6,
            color: pickMode ? "#3b82f6" : "#fff",
            weight: pickMode ? 2.5 : 1.5,
            fillColor: color,
            fillOpacity: 0.95,
          });

      // Pick mode: solo handler de click, sin popup ni info default.
      if (pickMode && onPickPoi) {
        (marker as L.Marker | L.CircleMarker).on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onPickPoi(p);
        });
        marker.addTo(group);
        return;
      }

      // Modo normal — popup o callback custom.
      if (onPoiClick) {
        (marker as L.Marker | L.CircleMarker).on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onPoiClick(p);
        });
      } else {
        const desc = p.description ? `<br/>${escapeHtml(p.description)}` : "";
        const cat = p.category
          ? `<div style="opacity:.7;font-size:11px;margin-top:2px">${escapeHtml(
              p.category,
            )}</div>`
          : "";
        const salesRaw = (p.properties as Record<string, unknown> | null)?.sales;
        const sales =
          typeof salesRaw === "number" && Number.isFinite(salesRaw)
            ? `<div style="font-size:11px;margin-top:4px"><b>Ventas:</b> ${salesRaw.toLocaleString("es-CL")}</div>`
            : "";
        (marker as L.Marker | L.CircleMarker).bindPopup(
          `<div style="font-size:12px;min-width:140px"><b>${escapeHtml(
            p.name,
          )}</b>${desc}${cat}${sales}</div>`,
        );
      }
      marker.addTo(group);
    });

    return () => {
      group.remove();
    };
  }, [map, pois, visible, onPoiClick, pickMode, onPickPoi]);

  return null;
};

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isImageUrl = (v: string | null | undefined): string | null => {
  if (!v) return null;
  if (v.startsWith("data:image/")) return v;
  if (/^https?:\/\//i.test(v) && /\.(png|jpe?g|gif|svg|webp)(\?.*)?$/i.test(v)) return v;
  return null;
};
