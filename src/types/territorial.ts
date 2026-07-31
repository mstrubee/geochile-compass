export interface TerritorialGroup {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  order_index: number;
  visible_default: boolean;
}

export interface TerritorialLayer {
  id: string;
  group_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  order_index: number;
  feature_count: number;
  source_file_id: string | null;
  bbox: [number, number, number, number] | null;
}

export interface TerritorialFeature {
  id: string;
  layer_id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

export type DedupStrategy = "replace_layer" | "merge_external_id" | "merge_coords_name";

export interface TerritorialSourceFile {
  id: string;
  original_filename: string;
  size_bytes: number | null;
  storage_path: string;
  gdrive_file_id: string | null;
  uploaded_at: string;
  processed_at: string | null;
  status: "pending" | "scanning" | "scanned" | "processing" | "done" | "error";
  error: string | null;
  excluded_layers: string[];
  dedup_strategy: DedupStrategy;
  layers_summary: Array<{ name: string; count: number }> | null;
  group_id: string | null;
  file_type?: "html" | "geojson" | "kml" | "kmz" | "csv" | null;
}
