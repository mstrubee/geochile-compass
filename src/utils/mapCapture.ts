import type L from "leaflet";

export interface MapCaptureImages {
  isoOnly: string | null;
  gse: string | null;
  gasto: string | null;
  atractores: string | null;
}

export interface CaptureBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a que termine el paneo/zoom del mapa (con timeout de seguridad). */
const waitForMoveEnd = (map: L.Map, timeoutMs = 2000): Promise<void> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    map.once("moveend", () => {
      clearTimeout(timer);
      // Da tiempo a que tiles/capas GeoJSON terminen de pintar tras el reflow.
      setTimeout(finish, 350);
    });
  });

/** Encuadra el mapa en los bounds dados y espera a que se estabilice. */
export const fitMapToBounds = (map: L.Map, bounds: CaptureBounds): Promise<void> => {
  const p = waitForMoveEnd(map);
  map.fitBounds(
    [
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
    ],
    { animate: false, padding: [24, 24] },
  );
  return p;
};

/** Espera un par de frames + un margen fijo para que React/Leaflet terminen de pintar. */
const settleForCapture = async (): Promise<void> => {
  await nextFrame();
  await nextFrame();
  await wait(300);
};

/** Toma una foto PNG (dataURL) del contenedor del mapa. Devuelve null si falla (p.ej. CORS). */
const captureMapSnapshot = async (map: L.Map): Promise<string | null> => {
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(map.getContainer(), {
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: null,
      ignoreElements: (el) =>
        el.classList?.contains("leaflet-control-container") ||
        el.classList?.contains("leaflet-popup-pane"),
    });
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("[mapCapture] No se pudo capturar el mapa (posible bloqueo CORS):", err);
    return null;
  }
};

/** Espera a que la vista actual se asiente y toma la foto. */
export const captureAfterSettle = async (map: L.Map): Promise<string | null> => {
  await settleForCapture();
  return captureMapSnapshot(map);
};
