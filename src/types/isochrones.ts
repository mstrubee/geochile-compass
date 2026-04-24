import type { Feature, Polygon, MultiPolygon } from "geojson";

export type IsoMode = "foot-walking" | "driving-car" | "cycling-regular";

export const ISO_MODE_LABEL: Record<IsoMode, string> = {
  "foot-walking": "Caminata",
  "driving-car": "Vehículo",
  "cycling-regular": "Bici",
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
