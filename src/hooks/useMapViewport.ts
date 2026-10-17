import { useEffect, useRef, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type { Bounds } from "@/types/projects";
import { roundBounds } from "@/utils/projectsScale";

/** Caja visible y zoom del mapa (dentro del MapContainer), con un pequeño retraso para no consultar en cada fotograma del arrastre. */
export const useMapViewport = (enabled = true, delayMs = 250): { bounds: Bounds | null; zoom: number } => {
  const map = useMap();
  const read = () => {
    const b = map.getBounds();
    return { bounds: roundBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }), zoom: map.getZoom() };
  };
  const [state, setState] = useState<{ bounds: Bounds | null; zoom: number }>(() => (enabled ? read() : { bounds: null, zoom: map.getZoom() }));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const schedule = () => {
    if (!enabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(read()), delayMs);
  };
  useMapEvents({ moveend: schedule, zoomend: schedule });
  useEffect(() => {
    if (enabled) setState(read());
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return state;
};
