/**
 * Renders Google Map Tiles API as a Leaflet TileLayer.
 * Manages session token creation and renewal transparently.
 */
import { useEffect, useRef, useState } from "react";
import { TileLayer } from "react-leaflet";
import {
  createGoogleTileSession,
  basemapToGoogleMapType,
  buildGoogleTileUrl,
} from "@/services/googleMapsService";

const OSM_FALLBACK = {
  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  attribution: "© OpenStreetMap · © CARTO",
};

interface Props {
  basemap: "dark" | "light" | "satellite" | "hybrid";
  onSessionCreated?: () => void;
  onTileLoad?: () => void;
}

export const GoogleTileLayer = ({ basemap, onSessionCreated, onTileLoad }: Props) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY as string;
  const [tileUrl, setTileUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mapType = basemapToGoogleMapType(basemap);
  const prevMapType = useRef<string | null>(null);

  useEffect(() => {
    if (prevMapType.current === mapType && tileUrl && !error) return;
    prevMapType.current = mapType;
    setError(false);

    let cancelled = false;
    createGoogleTileSession(apiKey, mapType).then((session) => {
      if (cancelled) return;
      if (!session) { setError(true); return; }
      setTileUrl(buildGoogleTileUrl(session.session, apiKey));
      onSessionCreated?.();
    });
    return () => { cancelled = true; };
  }, [apiKey, mapType, error, tileUrl, onSessionCreated]);

  if (error || !tileUrl) {
    // Show OSM while loading or on error
    return (
      <TileLayer
        url={OSM_FALLBACK.url}
        attribution={OSM_FALLBACK.attribution}
        maxZoom={19}
      />
    );
  }

  return (
    <TileLayer
      key={tileUrl}
      url={tileUrl}
      attribution='© <a href="https://maps.google.com">Google</a>'
      maxZoom={20}
      eventHandlers={{
        tileload: () => onTileLoad?.(),
      }}
    />
  );
};
