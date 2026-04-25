import { useEffect } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { CommuneLayer } from "./CommuneLayer";
import { ChileCommunesLayer } from "./ChileCommunesLayer";
import { CommuneOutlineLayer } from "./CommuneOutlineLayer";
import { TrafficLayer } from "./TrafficLayer";
import { GseLayer } from "./GseLayer";
import { ManzanaLayer } from "./ManzanaLayer";
import { UserLayersLayer } from "./UserLayersLayer";
import { IsochroneLayer } from "./IsochroneLayer";
import { SavedPoisLayer } from "./SavedPoisLayer";
import { MicrozoneLayer } from "./MicrozoneLayer";
import type { ManzanaFeatureCollection, ManzanaVariable } from "@/types/manzanas";
import type { GseFeatureCollection, GseVariable } from "@/types/gse";
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
    overlay: null as string | null,
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "© OpenStreetMap · © CARTO",
    overlay: null as string | null,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — World Imagery",
    overlay: null as string | null,
  },
  hybrid: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — World Imagery & Transportation",
    // Overlay con calles (jerarquía vial) + etiquetas
    overlay: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
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

const ViewportTracker = ({
  onChange,
}: {
  onChange: (bbox: [number, number, number, number], zoom: number) => void;
}) => {
  const map = useMap();
  useEffect(() => {
    const emit = () => {
      const b = map.getBounds();
      onChange(
        [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()],
        map.getZoom(),
      );
    };
    emit();
    map.on("moveend", emit);
    map.on("zoomend", emit);
    return () => {
      map.off("moveend", emit);
      map.off("zoomend", emit);
    };
  }, [map, onChange]);
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

const FlyToTarget = ({
  target,
}: {
  target: { id: number; lat: number; lng: number; bbox: [number, number, number, number] | null } | null;
}) => {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    if (target.bbox) {
      const [south, north, west, east] = target.bbox;
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { padding: [40, 40], maxZoom: 17 },
      );
    } else {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
    }
  }, [target, map]);
  return null;
};

interface MapViewProps {
  basemap: "dark" | "light" | "satellite" | "hybrid";
  onMouseMove: (c: { lat: number; lng: number }) => void;
  layers: import("@/types/layers").LayerState;
  nseFilter: import("@/data/communes").NSE | null;
  trafficFilter: import("@/utils/traffic").TrafficLevel | null;
  manzanaData: ManzanaFeatureCollection | null;
  manzanaVariable: ManzanaVariable;
  onManzanaViewportChange: (bbox: [number, number, number, number], zoom: number) => void;
  densityData: ManzanaFeatureCollection | null;
  onDensityViewportChange: (bbox: [number, number, number, number], zoom: number) => void;
  gseData: GseFeatureCollection | null;
  gseVariable: GseVariable;
  onGseViewportChange: (bbox: [number, number, number, number], zoom: number) => void;
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
  flyTarget: {
    id: number;
    lat: number;
    lng: number;
    bbox: [number, number, number, number] | null;
  } | null;
  onViewportChange?: (bbox: [number, number, number, number], zoom: number) => void;
  openCommunePopupFor?: string | null;
  onCommunePopupOpened?: () => void;
  onAddCommuneToCompare?: (c: import("@/data/communes").Commune) => void;
  outlinedCommuneNames?: string[];
  highlightedCommuneName?: string | null;
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
  densityData,
  onDensityViewportChange,
  gseData,
  gseVariable,
  onGseViewportChange,
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
  flyTarget,
  onViewportChange,
  openCommunePopupFor,
  onCommunePopupOpened,
  onAddCommuneToCompare,
  outlinedCommuneNames = [],
  highlightedCommuneName = null,
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
      {tile.overlay && (
        <TileLayer
          key={`${basemap}-overlay`}
          url={tile.overlay}
          maxZoom={19}
          zIndex={250}
        />
      )}
      <ZoomControlTopRight />
      <MouseTracker onMouseMove={onMouseMove} />
      {isoMode && <ClickHandler onClick={onMapClick} />}
      <InvalidateOnResize />
      <FlyToTarget target={flyTarget} />
      {onViewportChange && <ViewportTracker onChange={onViewportChange} />}
      <ManzanaLayer
        visible={layers.manzanas}
        data={manzanaData}
        variable={manzanaVariable}
        onViewportChange={onManzanaViewportChange}
      />
      <ManzanaLayer
        visible={layers.density}
        data={densityData}
        variable="density"
        onViewportChange={onDensityViewportChange}
      />
      <CommuneLayer
        visible={layers.communes}
        openPopupFor={openCommunePopupFor}
        onPopupOpened={onCommunePopupOpened}
        onAddToCompare={onAddCommuneToCompare}
      />
      <ChileCommunesLayer visible={layers.communesGeo} />
      <CommuneOutlineLayer
        names={outlinedCommuneNames}
        highlightName={highlightedCommuneName}
      />
      <GseLayer
        visible={layers.nse}
        data={gseData}
        variable={gseVariable}
        onViewportChange={onGseViewportChange}
        showCommuneFallback
      />
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
