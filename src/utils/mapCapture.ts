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

/**
 * Espera a que un valor leído desde `ref.current` deje de ser `prevValue`
 * (es decir, a que termine un fetch async disparado por un cambio de estado),
 * con un timeout de seguridad. Usado para esperar datos de capas (GSE/gasto)
 * que se cargan de forma asíncrona (debounce + red) tras activarlas.
 */
export const waitForRefChange = async <T,>(
  ref: { current: T },
  prevValue: T,
  timeoutMs = 6500,
  intervalMs = 120,
): Promise<{ changed: boolean; elapsedMs: number }> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (ref.current !== prevValue) return { changed: true, elapsedMs: Date.now() - start };
    await wait(intervalMs);
  }
  return { changed: false, elapsedMs: Date.now() - start };
};

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

/**
 * Encuadra el mapa en los bounds dados y espera a que se estabilice.
 *
 * `zoomOffset` corre el zoom resultante: negativo aleja, positivo acerca. El
 * encuadre debe rehacerse ANTES DE CADA foto, no una sola vez al principio:
 * el contenedor del mapa cambia de tamaño al aparecer leyendas de algunas
 * capas, y a igual zoom un contenedor distinto abarca otra superficie — por
 * eso la foto de atractores salía a otra escala que las demás.
 */
export const fitMapToBounds = (
  map: L.Map,
  bounds: CaptureBounds,
  zoomOffset = 0,
): Promise<void> => {
  const p = waitForMoveEnd(map);
  map.invalidateSize({ animate: false });
  const latLng: [[number, number], [number, number]] = [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ];
  map.fitBounds(latLng, { animate: false, padding: [24, 24] });
  if (zoomOffset !== 0) {
    map.setZoom(map.getZoom() + zoomOffset, { animate: false });
  }
  return p;
};

/** Espera un par de frames + un margen fijo para que React/Leaflet terminen de pintar. */
const settleForCapture = async (): Promise<void> => {
  await nextFrame();
  await nextFrame();
  await wait(450);
};

/** Espera a que todas las tiles visibles hayan terminado de cargar. */
const waitForTiles = async (container: HTMLElement, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tiles = Array.from(container.querySelectorAll<HTMLImageElement>("img.leaflet-tile"));
    if (tiles.length > 0 && tiles.every((t) => t.complete && t.naturalWidth > 0)) return;
    await wait(150);
  }
};

/**
 * Opacidad acumulada del elemento y sus ancestros hasta `stopAt` (excluido).
 *
 * Un tile ya cargado se considera opaco aunque su opacidad propia sea 0: la
 * animación de fade-in de Leaflet depende de requestAnimationFrame y puede
 * quedar a medias (pestaña en segundo plano, rAF limitado), lo que dejaría
 * el mapa base fuera de la foto pese a estar cargado.
 */
const cumulativeOpacity = (el: HTMLElement, stopAt: HTMLElement): number => {
  const isLoadedTile =
    el instanceof HTMLImageElement && el.classList.contains("leaflet-tile-loaded");
  let opacity = 1;
  let node: HTMLElement | null = el;
  while (node && node !== stopAt) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return 0;
    if (!(node === el && isLoadedTile)) {
      const o = parseFloat(style.opacity);
      if (!Number.isNaN(o)) opacity *= o;
    }
    node = node.parentElement;
  }
  return opacity;
};

/**
 * Elementos rasterizables del mapa (tiles `<img>` y canvas de capas vectoriales
 * / heatmaps), en orden de pintado: paneles ordenados por z-index, y dentro de
 * cada panel en orden del DOM.
 */
const collectDrawables = (container: HTMLElement): HTMLElement[] => {
  const mapPane = container.querySelector<HTMLElement>(".leaflet-map-pane");
  if (!mapPane) return [];

  const panes = Array.from(mapPane.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el.classList.contains("leaflet-pane") &&
      // Los popups no forman parte del informe.
      !el.classList.contains("leaflet-popup-pane"),
  );

  const withZ = panes.map((pane, domIndex) => {
    const z = parseInt(getComputedStyle(pane).zIndex, 10);
    return { pane, domIndex, z: Number.isNaN(z) ? 0 : z };
  });
  withZ.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.domIndex - b.domIndex));

  const out: HTMLElement[] = [];
  for (const { pane } of withZ) {
    out.push(
      ...Array.from(pane.querySelectorAll<HTMLElement>("img, canvas")),
    );
  }
  return out;
};

/**
 * Compone una foto del mapa dibujando cada tile/canvas en la posición real que
 * ocupa en pantalla (`getBoundingClientRect`, que ya incluye los transforms CSS
 * de Leaflet). Se hace a mano en vez de usar html2canvas porque este último no
 * reproduce de forma fiable los `translate3d` de los paneles de Leaflet, lo que
 * desalineaba las capas vectoriales respecto al mapa base.
 */
const composeMapSnapshot = (map: L.Map): string | null => {
  const container = map.getContainer();
  const cRect = container.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cRect.width * dpr);
  canvas.height = Math.round(cRect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  const bg = getComputedStyle(container).backgroundColor;
  ctx.fillStyle = bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#0b1120";
  ctx.fillRect(0, 0, cRect.width, cRect.height);

  for (const el of collectDrawables(container)) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    // Descarta lo que quedó completamente fuera del viewport del mapa.
    if (
      rect.right < cRect.left || rect.left > cRect.right ||
      rect.bottom < cRect.top || rect.top > cRect.bottom
    ) continue;

    const alpha = cumulativeOpacity(el, container);
    if (alpha <= 0) continue;

    if (el instanceof HTMLImageElement && (!el.complete || el.naturalWidth === 0)) continue;

    ctx.globalAlpha = alpha;
    try {
      ctx.drawImage(
        el as CanvasImageSource,
        rect.left - cRect.left,
        rect.top - cRect.top,
        rect.width,
        rect.height,
      );
    } catch {
      // Un elemento aislado que no se pueda dibujar no debe abortar la foto.
    }
  }
  ctx.globalAlpha = 1;

  try {
    return canvas.toDataURL("image/png");
  } catch (err) {
    // Canvas "tainted": alguna tile se sirvió sin cabeceras CORS.
    console.warn("[mapCapture] Canvas bloqueado por CORS al exportar:", err);
    return null;
  }
};

/** Espera a que la vista actual se asiente y toma la foto. */
export const captureAfterSettle = async (map: L.Map): Promise<string | null> => {
  await settleForCapture();
  await waitForTiles(map.getContainer());
  await nextFrame();
  return composeMapSnapshot(map);
};
