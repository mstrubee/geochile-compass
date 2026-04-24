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

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};

const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[]
    );
  }
  return btoa(binary);
};

/**
 * Resolve relative icon paths (e.g. "files/icon.png") inside a KMZ archive
 * to data URLs so they render in the browser.
 */
const resolveKmzIcons = async (
  fc: FeatureCollection,
  zip: JSZip
): Promise<void> => {
  const cache = new Map<string, string | null>();

  const resolve = async (href: string): Promise<string | null> => {
    if (!href) return null;
    if (/^(https?:|data:)/i.test(href)) return href;
    if (cache.has(href)) return cache.get(href)!;
    // Normalize: strip leading "./" and any query/fragment
    const clean = href.replace(/^\.\//, "").split(/[?#]/)[0];
    const entry =
      zip.file(clean) ||
      zip.file(decodeURIComponent(clean)) ||
      Object.values(zip.files).find(
        (f) => f.name.toLowerCase() === clean.toLowerCase()
      );
    if (!entry) {
      cache.set(href, null);
      return null;
    }
    const ext = clean.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    const buf = await entry.async("arraybuffer");
    const dataUrl = `data:${mime};base64,${arrayBufferToBase64(buf)}`;
    cache.set(href, dataUrl);
    return dataUrl;
  };

  for (const feature of fc.features) {
    const props = feature.properties as Record<string, unknown> | null;
    const icon = props?.icon;
    if (typeof icon === "string") {
      const resolved = await resolve(icon);
      if (resolved) (props as Record<string, unknown>).icon = resolved;
    }
  }
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
  const fc = parseKmlString(await kmlEntry.async("string"));
  await resolveKmzIcons(fc, zip);
  return fc;
};
