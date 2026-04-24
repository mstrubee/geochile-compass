import { kml } from "@tmcw/togeojson";
import JSZip from "jszip";
import type { Feature, FeatureCollection } from "geojson";

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export type SupportedExt = "geojson" | "json" | "kml" | "kmz";

/**
 * Internal property name used to attach the KML folder hierarchy to each feature.
 * Stored as an array of folder names from root to leaf, e.g. ["Clientes", "Norte"].
 * Empty array (or missing) means the feature lives at the document root.
 */
export const FOLDER_PATH_KEY = "_folderPath";

export const getExtension = (name: string): SupportedExt | null => {
  const m = name.toLowerCase().match(/\.(geojson|json|kml|kmz)$/);
  return m ? (m[1] as SupportedExt) : null;
};

const parseGeoJsonString = (text: string): FeatureCollection => {
  const obj = JSON.parse(text);
  if (obj.type === "FeatureCollection") return obj as FeatureCollection;
  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [obj] } as FeatureCollection;
  }
  throw new Error("GeoJSON debe ser Feature o FeatureCollection");
};

/**
 * Parse a KML XML string into a GeoJSON FeatureCollection while preserving
 * the original <Folder> hierarchy as `_folderPath` on each feature.
 *
 * Strategy: walk the DOM ourselves to know which Placemark belongs to which
 * folder, convert each Placemark individually with @tmcw/togeojson, and then
 * tag the resulting features.
 */
const parseKmlStringWithFolders = (text: string): FeatureCollection => {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("KML inválido");

  const root = doc.documentElement;
  if (!root) throw new Error("KML vacío");

  const features: Feature[] = [];

  // Build a tiny KML wrapper around a single Placemark so togeojson can convert it.
  const NS = 'xmlns="http://www.opengis.net/kml/2.2"';
  const convertPlacemark = (placemark: Element): Feature[] => {
    const xml = `<kml ${NS}><Document>${placemark.outerHTML}</Document></kml>`;
    const sub = new DOMParser().parseFromString(xml, "text/xml");
    const fc = kml(sub) as FeatureCollection;
    return fc.features ?? [];
  };

  const folderName = (folder: Element): string => {
    // Direct child <name>, not nested ones from inner Placemarks.
    for (let i = 0; i < folder.children.length; i++) {
      const c = folder.children[i];
      if (c.tagName === "name") return (c.textContent ?? "").trim() || "Sin nombre";
    }
    return "Sin nombre";
  };

  const walk = (node: Element, path: string[]) => {
    // Only iterate direct children to preserve the hierarchy.
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const tag = child.tagName;
      if (tag === "Folder" || tag === "Document") {
        const name = folderName(child);
        // <Document> at the root contributes no folder level.
        const isRootDocument = tag === "Document" && path.length === 0 && node === root;
        const nextPath = isRootDocument ? path : [...path, name];
        walk(child, nextPath);
      } else if (tag === "Placemark") {
        const converted = convertPlacemark(child);
        for (const f of converted) {
          const props = (f.properties ?? {}) as Record<string, unknown>;
          props[FOLDER_PATH_KEY] = path;
          f.properties = props;
          features.push(f);
        }
      }
    }
  };

  walk(root, []);

  // Fallback: if we found nothing (unusual KML structure), use plain togeojson.
  if (features.length === 0) {
    const fc = kml(doc) as FeatureCollection;
    return fc;
  }

  return { type: "FeatureCollection", features };
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
    return parseKmlStringWithFolders(await file.text());
  }
  // kmz
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntry = Object.values(zip.files).find((f) =>
    f.name.toLowerCase().endsWith(".kml")
  );
  if (!kmlEntry) throw new Error("KMZ sin archivo .kml interno");
  const fc = parseKmlStringWithFolders(await kmlEntry.async("string"));
  await resolveKmzIcons(fc, zip);
  return fc;
};

/**
 * Read the folder path stored on a feature (empty array if none).
 */
export const getFolderPath = (f: Feature): string[] => {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const v = p[FOLDER_PATH_KEY];
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];
};

/**
 * Group the features of a FeatureCollection by their `_folderPath`,
 * preserving the original ordering of folders as they appear in the file.
 *
 * Returns one bucket per distinct path. Features without a path go into
 * a bucket with `path: []`.
 */
export const splitByFolderPath = (
  fc: FeatureCollection
): Array<{ path: string[]; features: Feature[] }> => {
  const order: string[] = [];
  const map = new Map<string, { path: string[]; features: Feature[] }>();
  for (const f of fc.features) {
    const path = getFolderPath(f);
    const key = path.join("\u0000");
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { path, features: [] };
      map.set(key, bucket);
      order.push(key);
    }
    bucket.features.push(f);
  }
  return order.map((k) => map.get(k)!);
};
