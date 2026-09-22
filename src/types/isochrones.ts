import type { Feature, Polygon, MultiPolygon } from "geojson";

/**
 * "custom-zone" es una isócrona sin ruteo: el polígono lo dibuja el analista
 * a mano (microzona) en vez de salir de una isócrona de tiempo de viaje. Vive
 * en el mismo tipo para poder guardarla/analizarla con el mismo pipeline.
 */
export type IsoMode = "foot-walking" | "driving-car" | "cycling-regular" | "custom-zone";

export const ISO_MODE_LABEL: Record<IsoMode, string> = {
  "foot-walking": "Caminata",
  "driving-car": "Vehículo",
  "cycling-regular": "Bici",
  "custom-zone": "Zona dibujada",
};

export interface Isochrone {
  id: string;
  mode: IsoMode;
  minutes: number[];
  center: { lat: number; lng: number };
  color: string;
  visible: boolean;
  createdAt: number;
  features: Feature<Polygon | MultiPolygon, { value: number }>[];
}
