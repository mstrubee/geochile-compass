import { useEffect } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { CommuneLayer } from "./CommuneLayer";
import { TrafficLayer } from "./TrafficLayer";
import { NSELayer } from "./NSELayer";
import { ManzanaLayer } from "./ManzanaLayer";
import { UserLayersLayer } from "./UserLayersLayer";
import { IsochroneLayer } from "./IsochroneLayer";
import { SavedPoisLayer } from "./SavedPoisLayer";
import { MicrozoneLayer } from "./MicrozoneLayer";
import type { ManzanaFeatureCollection, ManzanaVariable } from "@/types/manzanas";
import type { UserLayer } from "@/types/userLayers";
import type { Isochrone } from "@/types/isochrones";
import type { SavedPoi } from "@/types/pois";
import type { Microzone, MicrozoneSubmode } from "@/types/microzones";

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

const ClickHandler = ({ onClick }: { onClick: (c: { lat: number; lng: number }) => void }) => {
  useMapEvents({
    click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }),
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
  nseFilter: import("@/data/communes").NSE | null;
  trafficFilter: import("@/utils/traffic").TrafficLevel | null;
  manzanaData: ManzanaFeatureCollection | null;
  manzanaVariable: ManzanaVariable;
  onManzanaViewportChange: (bbox: [number, number, number, number], zoom: number) => void;
  userLayers: UserLayer[];
  fitUserLayerId: string | null;
  onFitUserLayerDone: () => void;
  isochrones: Isochrone[];
  fitIsochroneId: string | null;
  onFitIsochroneDone: () => void;
  isoMode: boolean;
  onMapClick: (c: { lat: number; lng: number }) => void;
  savedPois: SavedPoi[];
  savedPoisVisible: boolean;
  // Microzonas
  microzones: Microzone[];
  microActive: boolean;
  microSubmode: MicrozoneSubmode;
  microDraftVertices: Array<{ lat: number; lng: number }>;
  onMicroAddVertex: (c: { lat: number; lng: number }) => void;
  onMicroClosePolygon: () => void;
  onMicroBufferClick: (c: { lat: number; lng: number }) => void;
  fitMicrozoneId: string | null;
  onFitMicrozoneDone: () => void;
}

export const MapView = ({
  basemap,
  onMouseMove,
  layers,
  nseFilter,
  trafficFilter,
  manzanaData,
  manzanaVariable,
  onManzanaViewportChange,
  userLayers,
  fitUserLayerId,
  onFitUserLayerDone,
  isochrones,
  fitIsochroneId,
  onFitIsochroneDone,
  isoMode,
  onMapClick,
  savedPois,
  savedPoisVisible,
  microzones,
  microActive,
  microSubmode,
  microDraftVertices,
  onMicroAddVertex,
  onMicroClosePolygon,
  onMicroBufferClick,
  fitMicrozoneId,
  onFitMicrozoneDone,
}: MapViewProps) => {
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
      {isoMode && <ClickHandler onClick={onMapClick} />}
      <InvalidateOnResize />
      <ManzanaLayer
        visible={layers.manzanas}
        data={manzanaData}
        variable={manzanaVariable}
        onViewportChange={onManzanaViewportChange}
      />
      <CommuneLayer visible={layers.communes} />
      <NSELayer visible={layers.nse} nseFilter={nseFilter} trafficFilter={trafficFilter} />
      <TrafficLayer visible={layers.traffic} nseFilter={nseFilter} trafficFilter={trafficFilter} />
      <UserLayersLayer
        layers={userLayers}
        fitId={fitUserLayerId}
        onFitDone={onFitUserLayerDone}
      />
      <IsochroneLayer
        isochrones={isochrones}
        fitId={fitIsochroneId}
        onFitDone={onFitIsochroneDone}
      />
      <SavedPoisLayer pois={savedPois} visible={savedPoisVisible} />
      <MicrozoneLayer
        microzones={microzones}
        active={microActive}
        submode={microSubmode}
        draftVertices={microDraftVertices}
        onAddVertex={onMicroAddVertex}
        onClosePolygon={onMicroClosePolygon}
        onBufferClick={onMicroBufferClick}
        fitId={fitMicrozoneId}
        onFitDone={onFitMicrozoneDone}
      />
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
