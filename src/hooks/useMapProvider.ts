/**
 * Manages the active cartographic provider (Google Maps / OSM), the server-side API quota
 * status (see apiQuotaService) and the auto-switch to OSM when the Google map quota is exhausted.
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useGoogleMapsKey } from "@/hooks/useGoogleMapsKey";
import { useApiQuotaStatus } from "@/hooks/useApiQuotaStatus";
import type { QuotaApi, QuotaApiStatus } from "@/services/apiQuotaService";

export type MapProvider = "google" | "osm";

export const THRESHOLD_WARN = 0.7;
export const THRESHOLD_CRITICAL = 0.9;

const PROVIDER_STORAGE_KEY = "geoplanet_map_provider_v1";

export interface UsageStat {
  api: QuotaApi;
  label: string;
  count: number;
  limit: number;
  pct: number;
}

const toStat = (a: QuotaApiStatus): UsageStat => ({
  api: a.api,
  label: a.label,
  count: a.used,
  limit: a.limit,
  pct: a.limit > 0 ? Math.min(1, a.used / a.limit) : 1,
});

export const useMapProvider = () => {
  // Clave cargada en runtime desde app_secrets (panel admin), con fallback a build.
  const googleKey = useGoogleMapsKey();
  const hasGoogleKey = !!googleKey;
  const { status } = useApiQuotaStatus();

  const [provider, setProviderState] = useState<MapProvider>(() => {
    try {
      const s = localStorage.getItem(PROVIDER_STORAGE_KEY) as MapProvider;
      if (s === "google" || s === "osm") return s;
    } catch { /* ignore */ }
    return "osm";
  });
  // Nota: NO forzamos OSM mientras la clave carga async. Si la preferencia es
  // "google" y aún no hay clave, GoogleTileLayer muestra OSM como fallback y el
  // botón Google queda deshabilitado; al llegar la clave (build o panel) Google
  // se activa solo, preservando la preferencia del usuario.

  const stats = (status?.apis ?? []).map(toStat);
  const mapStat = stats.find((s) => s.api === "maps_js");
  // Sin estado cargado aún no bloqueamos nada (el servidor igual rechaza cada llamada).
  const mapLimitReached = !!mapStat && mapStat.count >= mapStat.limit;

  /** Change the active provider with guard checks. */
  const setProvider = useCallback(
    (p: MapProvider) => {
      if (p === "google") {
        if (!hasGoogleKey) {
          toast.error("No se ha configurado una API Key de Google Maps.");
          return;
        }
        if (mapLimitReached) {
          toast.error(
            "El límite mensual de Google Maps ha sido alcanzado. Usando OpenStreetMap.",
          );
          return;
        }
      }
      setProviderState(p);
      try { localStorage.setItem(PROVIDER_STORAGE_KEY, p); } catch { /* ignore */ }
    },
    [hasGoogleKey, mapLimitReached],
  );

  // Auto-switch to OSM when the map quota is exhausted
  useEffect(() => {
    if (provider !== "google" || !mapLimitReached) return;
    setProviderState("osm");
    try { localStorage.setItem(PROVIDER_STORAGE_KEY, "osm"); } catch { /* ignore */ }
    toast.warning(
      "Se ha alcanzado el límite de consumo de Google Maps. Actualmente se está utilizando OpenStreetMap.",
      { duration: 8000 },
    );
  }, [mapLimitReached, provider]);

  const isLimitReached = (api: QuotaApi) => {
    const s = stats.find((x) => x.api === api);
    return !!s && s.count >= s.limit;
  };

  return {
    provider,
    setProvider,
    usage: {
      apis: stats,
      cycleStart: status ? new Date(status.period + "T00:00:00") : new Date(),
      cycleEnd: status ? new Date(status.period_end + "T00:00:00") : new Date(),
    },
    isLimitReached,
    hasGoogleKey,
  };
};
