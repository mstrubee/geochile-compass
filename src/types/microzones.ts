import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { NSE } from "@/data/communes";

export type MicrozoneSubmode = "polygon" | "buffer" | "voronoi";

export interface MicrozoneStats {
  area_km2: number;
  perimeter_km: number;
  manzanaCount: number;
  pop: number;
  hh: number;
  nseDistribution: Partial<Record<NSE, number>>; // population por NSE
  dominantNse: NSE | null;
}

export interface Microzone {
  id: string;
  name: string;
  kind: MicrozoneSubmode;
  color: string;
  visible: boolean;
  createdAt: number;
  /** Polígono o MultiPolígono que delimita la microzona en GeoJSON */
  geometry: Feature<Polygon | MultiPolygon, Record<string, unknown>>;
  stats: MicrozoneStats | null;
}

export const MICRO_PALETTE = [
  "#8B5CF6", "#EC4899", "#F59E0B", "#10B981",
  "#3B82F6", "#EF4444", "#14B8A6", "#F97316",
];
