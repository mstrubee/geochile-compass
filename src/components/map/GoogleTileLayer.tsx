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
  incrementUsage,
} from "@/services/googleMapsService";

const OSM_FALLBACK = {
  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  attribution: "© OpenStreetMap · © CARTO",
};

interface Props {
  basemap: "dark" | "light" | "satellite" | "hybrid";
  onSessionCreated?: () => void;
}

export const GoogleTileLayer = ({ basemap, onSessionCreated }: Props) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY as string;
  const [tileUrl, setTileUrl] = useState<string | null>(null);
  const mapType = basemapToGoogleMapType(basemap);

  // Solo se re-ejecuta cuando cambia el tipo de mapa o la key — sin loops
  useEffect(() => {
    let cancelled = false;
    setTileUrl(null); // Muestra OSM mientras carga la sesión nueva
    createGoogleTileSession(apiKey, mapType).then((session) => {
      if (cancelled) return;
      if (!session) return; // Mantiene OSM como fallback
      setTileUrl(buildGoogleTileUrl(session.session, apiKey));
      onSessionCreated?.();
    });
    return () => { cancelled = true; };
  }, [apiKey, mapType]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tileUrl) {
    return (
      <TileLayer
        url={OSM_FALLBACK.url}
        attribution={OSM_FALLBACK.attribution}
        maxZoom={19}
        crossOrigin="anonymous"
      />
    );
  }

  return (
    <TileLayer
      key={mapType}
      url={tileUrl}
      attribution='© <a href="https://maps.google.com">Google</a>'
      maxZoom={20}
      crossOrigin="anonymous"
      eventHandlers={{
        // Contar tiles directo en localStorage — sin setState, sin re-renders
        tileload: () => incrementUsage("tiles"),
      }}
    />
  );
};
