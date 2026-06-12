/**
 * Manages the active cartographic provider (Google Maps / OSM),
 * usage tracking, auto-switch on quota exhaustion, and alert thresholds.
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { loadUsage, incrementUsage as _inc, type UsageData } from "@/services/googleMapsService";

export type MapProvider = "google" | "osm";

/** Monthly limits (configurable). */
export const PROVIDER_LIMITS = {
  sessions: 25_000,   // ~$175/mo at $7/1000 — within $200 free credit
  tiles: 200_000,     // informational (not billed separately)
  geocoding: 35_000,  // ~$175/mo at $5/1000
  places: 60_000,     // ~$170/mo at $2.83/1000
} as const;

export const THRESHOLD_WARN = 0.7;
export const THRESHOLD_CRITICAL = 0.9;

const PROVIDER_STORAGE_KEY = "geoplanet_map_provider_v1";

export const useMapProvider = () => {
  const hasGoogleKey = !!(import.meta.env.VITE_GOOGLE_MAPS_KEY as string);

  const [provider, setProviderState] = useState<MapProvider>(() => {
    if (!hasGoogleKey) return "osm";
    try {
      const s = localStorage.getItem(PROVIDER_STORAGE_KEY) as MapProvider;
      if (s === "google" || s === "osm") return s;
    } catch { /* ignore */ }
    return "osm";
  });

  const [usage, setUsage] = useState<UsageData>(loadUsage);

  const refreshUsage = useCallback(() => setUsage(loadUsage()), []);

  /** Increment a usage counter and refresh the local state. */
  const trackUsage = useCallback(
    (service: keyof Omit<UsageData, "cycleStart">, count = 1) => {
      _inc(service, count);
      refreshUsage();
    },
    [refreshUsage],
  );

  /** Change the active provider with guard checks. */
  const setProvider = useCallback(
    (p: MapProvider) => {
      if (p === "google") {
        if (!hasGoogleKey) {
          toast.error("No se ha configurado una API Key de Google Maps.");
          return;
        }
        const sessionPct = usage.sessions / PROVIDER_LIMITS.sessions;
        if (sessionPct >= 1) {
          toast.error(
            "El límite mensual de Google Maps ha sido alcanzado. Usando OpenStreetMap.",
          );
          return;
        }
      }
      setProviderState(p);
      try { localStorage.setItem(PROVIDER_STORAGE_KEY, p); } catch { /* ignore */ }
    },
    [hasGoogleKey, usage.sessions],
  );

  // Auto-switch to OSM when session quota exhausted
  useEffect(() => {
    if (provider !== "google") return;
    if (usage.sessions / PROVIDER_LIMITS.sessions >= 1) {
      setProviderState("osm");
      try { localStorage.setItem(PROVIDER_STORAGE_KEY, "osm"); } catch { /* ignore */ }
      toast.warning(
        "Se ha alcanzado el límite de consumo de Google Maps. Actualmente se está utilizando OpenStreetMap.",
        { duration: 8000 },
      );
    }
  }, [usage.sessions, provider]);

  // Enriched usage with percentages
  const enriched = {
    sessions: {
      count: usage.sessions,
      limit: PROVIDER_LIMITS.sessions,
      pct: Math.min(1, usage.sessions / PROVIDER_LIMITS.sessions),
    },
    tiles: {
      count: usage.tiles,
      limit: PROVIDER_LIMITS.tiles,
      pct: Math.min(1, usage.tiles / PROVIDER_LIMITS.tiles),
    },
    geocoding: {
      count: usage.geocoding,
      limit: PROVIDER_LIMITS.geocoding,
      pct: Math.min(1, usage.geocoding / PROVIDER_LIMITS.geocoding),
    },
    places: {
      count: usage.places,
      limit: PROVIDER_LIMITS.places,
      pct: Math.min(1, usage.places / PROVIDER_LIMITS.places),
    },
    cycleStart: new Date(usage.cycleStart + "T00:00:00"),
  };

  const isLimitReached = (service: keyof typeof PROVIDER_LIMITS) =>
    usage[service as keyof Omit<UsageData, "cycleStart">] >= PROVIDER_LIMITS[service];

  return {
    provider,
    setProvider,
    usage: enriched,
    trackUsage,
    refreshUsage,
    isLimitReached,
    hasGoogleKey,
  };
};
