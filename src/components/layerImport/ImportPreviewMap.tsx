import { useEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { boundsOf, type PreviewItem } from "@/utils/importWizard";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Dibuja la muestra del archivo y encuadra el mapa cuando cambia lo que se ve. */
const Layers = ({ items }: { items: readonly PreviewItem[] }) => {
  const map = useMap();

  // El diálogo se anima al abrirse: el mapa debe medirse otra vez cuando termina.
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [map]);

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const canvas = L.canvas({ padding: 0.5 });
    for (const it of items) {
      const popup = it.name ? `<div style="font-size:12px"><b>${escapeHtml(it.name)}</b></div>` : null;
      let layer: L.Layer;
      if (it.geometry.type === "Point") {
        const [lng, lat] = it.geometry.coordinates;
        layer = L.circleMarker([lat, lng], { renderer: canvas, radius: 4, color: "#fff", weight: 1, fillColor: it.color, fillOpacity: 0.95 });
      } else {
        layer = L.geoJSON(it.geometry, { style: { renderer: canvas, color: it.color, weight: 2, fillColor: it.color, fillOpacity: 0.2 } });
      }
      if (popup) layer.bindPopup(popup);
      layer.addTo(group);
    }
    const b = boundsOf(items);
    if (b) {
      const [w, s, e, n] = b;
      map.fitBounds(
        [
          [s, w],
          [n, e],
        ],
        { padding: [24, 24], maxZoom: 16, animate: false },
      );
    }
    return () => {
      group.remove();
    };
  }, [items, map]);

  return null;
};

/** Mapa de vista previa del asistente: lo que se importará, con el mismo mapa base que la app. */
export const ImportPreviewMap = ({ items }: { items: readonly PreviewItem[] }) => (
  <MapContainer center={[-33.45, -70.65]} zoom={5} className="h-full w-full rounded-lg" style={{ background: "#1b1d22" }} attributionControl={false}>
    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" subdomains="abcd" maxZoom={19} />
    <Layers items={items} />
  </MapContainer>
);
