import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { IsoMode } from "./isochrones";

export interface IsochroneFolder {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Ajustes de la proyección hechos por el analista para una ubicación.
 * Se recuerdan porque son criterio sobre ESE punto: rehacerlos de memoria
 * cada vez que se vuelve a abrir invita a que no coincidan.
 */
export interface ProjectionSettings {
  /** Castigo/premio manual en %. */
  adjustPct: number;
  /** Tasa por año; null en una posición = usar la de la curva. */
  rateOverrides: (number | null)[];
  /** false = la ubicación ya está en régimen (traslado, no apertura). */
  rampEnabled: boolean;
}

export interface SavedIsochrone {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  mode: IsoMode;
  minutes: number[];
  center_lat: number;
  center_lng: number;
  color: string | null;
  features: Feature<Polygon | MultiPolygon, { value: number }>[];
  source_poi_id: string | null;
  source_lat: number | null;
  source_lng: number | null;
  notes: string | null;
  /** Ajustes de la proyección de venta para esta ubicación. */
  projection_settings: ProjectionSettings | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SaveIsochronePayload {
  name: string;
  folder_id: string | null;
  mode: IsoMode;
  minutes: number[];
  center_lat: number;
  center_lng: number;
  color: string | null;
  features: SavedIsochrone["features"];
  source_poi_id?: string | null;
  source_lat?: number | null;
  source_lng?: number | null;
  notes?: string | null;
}
