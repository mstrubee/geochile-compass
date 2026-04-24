import { kml } from "@tmcw/togeojson";
import JSZip from "jszip";
import type { FeatureCollection } from "geojson";

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export type SupportedExt = "geojson" | "json" | "kml" | "kmz";

export const getExtension = (name: string): SupportedExt | null => {
  const m = name.toLowerCase().match(/\.(geojson|json|kml|kmz)$/);
  return m ? (m[1] as SupportedExt) : null;
};

const parseKmlString = (text: string): FeatureCollection => {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("KML inválido");
  return kml(doc) as FeatureCollection;
};

const parseGeoJsonString = (text: string): FeatureCollection => {
  const obj = JSON.parse(text);
  if (obj.type === "FeatureCollection") return obj as FeatureCollection;
  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [obj] } as FeatureCollection;
  }
  throw new Error("GeoJSON debe ser Feature o FeatureCollection");
};

export const parseFile = async (file: File): Promise<FeatureCollection> => {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Archivo demasiado grande (máx 20MB)`);
  }
  const ext = getExtension(file.name);
  if (!ext) throw new Error("Formato no soportado. Usa GeoJSON, KML o KMZ.");

  if (ext === "geojson" || ext === "json") {
    return parseGeoJsonString(await file.text());
  }
  if (ext === "kml") {
    return parseKmlString(await file.text());
  }
  // kmz
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntry = Object.values(zip.files).find((f) =>
    f.name.toLowerCase().endsWith(".kml")
  );
  if (!kmlEntry) throw new Error("KMZ sin archivo .kml interno");
  return parseKmlString(await kmlEntry.async("string"));
};
