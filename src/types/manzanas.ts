import type { FeatureCollection, Polygon, Feature } from "geojson";
import type { NSE } from "@/data/communes";

export type ManzanaVariable = "density" | "nse" | "income" | "traffic";

export interface ManzanaParams {
  west: number;
  south: number;
  east: number;
  north: number;
  variable: ManzanaVariable;
  zoom: number;
}

export interface ManzanaProperties {
  id: string;
  density: number;
  nse: NSE;
  income: number;
  traffic: number;
  pop: number;
  hh: number;
  commune: string;
}

export type ManzanaSource = "INE Censo 2017" | "mock";

export interface ManzanaMetadata {
  total: number;
  bbox: [number, number, number, number];
  variable: ManzanaVariable;
  source: ManzanaSource;
}

export interface ManzanaFeatureCollection extends FeatureCollection<Polygon, ManzanaProperties> {
  metadata: ManzanaMetadata;
}

export type ManzanaFeature = Feature<Polygon, ManzanaProperties>;

export interface ManzanaService {
  fetchManzanas(params: ManzanaParams): Promise<ManzanaFeatureCollection>;
  isAvailable(): Promise<boolean>;
}
