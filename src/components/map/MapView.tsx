import { useEffect } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { CommuneLayer } from "./CommuneLayer";
import { TrafficLayer } from "./TrafficLayer";

// Fix default Leaflet marker icon paths (when bundled)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const BASEMAPS = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap · © CARTO",
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap · © CARTO",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — World Imagery",
  },
};

const MouseTracker = ({ onMouseMove }: { onMouseMove: (c: { lat: number; lng: number }) => void }) => {
  useMapEvents({
    mousemove: (e) => onMouseMove({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
};

const InvalidateOnResize = () => {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [map]);
  return null;
};

interface MapViewProps {
  basemap: "dark" | "light" | "satellite";
  onMouseMove: (c: { lat: number; lng: number }) => void;
  layers: import("@/types/layers").LayerState;
}

export const MapView = ({ basemap, onMouseMove, layers }: MapViewProps) => {
  const tile = BASEMAPS[basemap];
  return (
    <MapContainer
      center={[-33.46, -70.65]}
      zoom={12}
      zoomControl={false}
      className="h-full w-full"
      attributionControl
    >
      <TileLayer
        key={basemap}
        url={tile.url}
        attribution={tile.attribution}
        maxZoom={19}
      />
      <ZoomControlTopRight />
      <MouseTracker onMouseMove={onMouseMove} />
      <InvalidateOnResize />
      <CommuneLayer visible={layers.communes} />
      <TrafficLayer visible={layers.traffic} />
    </MapContainer>
  );
};

const ZoomControlTopRight = () => {
  const map = useMap();
  useEffect(() => {
    const ctrl = L.control.zoom({ position: "topright" });
    ctrl.addTo(map);
    return () => {
      ctrl.remove();
    };
  }, [map]);
  return null;
};
