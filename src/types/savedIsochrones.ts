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
  /**
   * Local de formato Express. Fija el ajuste en -20%: el formato vende menos
   * que uno estándar y la superficie todavía no es una variable del modelo,
   * así que se corrige por fuera hasta que lo sea.
   */
  isExpress?: boolean;
  /**
   * Resultado de la proyección ya corrida. Se guarda para no obligar a
   * recalcular al reabrir la isócrona: correr el predictor consulta toda la
   * red y sus features, y el resultado no cambia salvo que cambien esos datos.
   */
  result?: unknown | null;
  /** Cuándo se corrió, para saber qué tan vigente es. */
  computedAt?: string | null;
  /**
   * Ajustes del heatmap de atractores usados en la última exportación.
   * Se calibran para la escala de la foto, no para la vista en vivo, así que
   * rehacerlos en cada informe es trabajo repetido.
   */
  heatSettings?: { radius: number; blur: number; opacity: number } | null;
  /**
   * Zoom relativo al encuadre automático usado en la última exportación.
   *
   * Se recuerda por el mismo motivo que `heatSettings`: en una isócrona grande
   * el encuadre automático deja las capas ilegibles, y el acercamiento que
   * resuelve eso es criterio sobre ESA ubicación. Rehacerlo de memoria en cada
   * informe invita a que las láminas no coincidan entre versiones.
   */
  captureZoomOffset?: number | null;
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
