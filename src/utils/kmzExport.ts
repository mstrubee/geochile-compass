import JSZip from "jszip";
import type { PoiFolder, SavedPoi } from "@/types/pois";
import { compareNatural, byNameNatural } from "@/utils/naturalSort";

/** Escapa caracteres reservados de XML. */
const escapeXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Convierte un color hex (#RRGGBB) al formato KML AABBGGRR (alpha BGR).
 * Si no se reconoce, devuelve un naranja por defecto opaco.
 */
const hexToKmlColor = (hex: string | null | undefined, alpha = "ff"): string => {
  const h = (hex || "#fb923c").replace(/^#/, "");
  if (h.length !== 6) return `${alpha}3c92fb`;
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `${alpha}${b}${g}${r}`.toLowerCase();
};

const styleIdForColor = (hex: string | null | undefined): string => {
  const safe = (hex || "#fb923c").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  return `s_${safe || "default"}`;
};

const buildStyleBlock = (hex: string | null | undefined): string => {
  const id = styleIdForColor(hex);
  const color = hexToKmlColor(hex);
  return `<Style id="${id}">
  <IconStyle>
    <color>${color}</color>
    <scale>1.1</scale>
    <Icon>
      <href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href>
    </Icon>
  </IconStyle>
  <LabelStyle><scale>0.9</scale></LabelStyle>
</Style>`;
};

const poiToPlacemarkXml = (poi: SavedPoi): string => {
  const styleId = styleIdForColor(poi.color);
  const desc = poi.description ? `<description>${escapeXml(poi.description)}</description>` : "";
  return `<Placemark>
  <name>${escapeXml(poi.name)}</name>
  ${desc}
  <styleUrl>#${styleId}</styleUrl>
  <Point><coordinates>${poi.lng},${poi.lat},0</coordinates></Point>
</Placemark>`;
};

/**
 * Recorre subcarpetas y POIs activos (deleted_at = null) emitiendo
 * `<Folder>` anidados que preservan el orden por nombre.
 */
const folderToFolderXml = (
  folder: PoiFolder,
  childrenMap: Map<string, PoiFolder[]>,
  poisByFolder: Map<string | null, SavedPoi[]>,
): string => {
  const subs = (childrenMap.get(folder.id) ?? []).slice().sort((a, b) =>
    compareNatural(a.name, b.name),
  );
  const pois = (poisByFolder.get(folder.id) ?? [])
    .filter((p) => !p.deleted_at)
    .slice()
    .sort(byNameNatural);

  const innerSubs = subs.map((s) => folderToFolderXml(s, childrenMap, poisByFolder)).join("\n");
  const innerPois = pois.map(poiToPlacemarkXml).join("\n");

  return `<Folder>
<name>${escapeXml(folder.name)}</name>
${innerSubs}
${innerPois}
</Folder>`;
};

const collectColors = (
  folder: PoiFolder,
  childrenMap: Map<string, PoiFolder[]>,
  poisByFolder: Map<string | null, SavedPoi[]>,
  out: Set<string>,
) => {
  for (const p of poisByFolder.get(folder.id) ?? []) {
    if (!p.deleted_at) out.add(p.color || "#fb923c");
  }
  for (const sub of childrenMap.get(folder.id) ?? []) {
    collectColors(sub, childrenMap, poisByFolder, out);
  }
};

const wrapKml = (innerBody: string, docName: string, styles: string): string => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${escapeXml(docName)}</name>
${styles}
${innerBody}
</Document>
</kml>`;
};

/**
 * Dispara la descarga de un Blob como archivo en el navegador.
 */
export const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
};

const buildKmzBlob = async (kml: string): Promise<Blob> => {
  const zip = new JSZip();
  zip.file("doc.kml", kml);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
};

export const safeFilename = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "export";

/** Exporta un único POI como KMZ. */
export const exportPoiAsKmz = async (poi: SavedPoi): Promise<void> => {
  const styles = buildStyleBlock(poi.color);
  const body = poiToPlacemarkXml(poi);
  const kml = wrapKml(body, poi.name, styles);
  const blob = await buildKmzBlob(kml);
  triggerDownload(blob, `${safeFilename(poi.name)}.kmz`);
};

/**
 * Exporta una carpeta completa (con todas las subcarpetas y POIs) como KMZ.
 * Sólo incluye elementos activos (no en papelera).
 */
export const exportFolderAsKmz = async (
  folder: PoiFolder,
  allFolders: PoiFolder[],
  allPois: SavedPoi[],
): Promise<void> => {
  // Indexes
  const childrenMap = new Map<string, PoiFolder[]>();
  for (const f of allFolders) {
    if (f.deleted_at) continue;
    if (!f.parent_id) continue;
    const arr = childrenMap.get(f.parent_id) ?? [];
    arr.push(f);
    childrenMap.set(f.parent_id, arr);
  }
  const poisByFolder = new Map<string | null, SavedPoi[]>();
  for (const p of allPois) {
    const arr = poisByFolder.get(p.folder_id) ?? [];
    arr.push(p);
    poisByFolder.set(p.folder_id, arr);
  }

  const colors = new Set<string>();
  collectColors(folder, childrenMap, poisByFolder, colors);
  const styles = Array.from(colors).map(buildStyleBlock).join("\n");
  const body = folderToFolderXml(folder, childrenMap, poisByFolder);
  const kml = wrapKml(body, folder.name, styles);
  const blob = await buildKmzBlob(kml);
  triggerDownload(blob, `${safeFilename(folder.name)}.kmz`);
};

// ── Capas territoriales (árbol de capas) ──────────────────────────────────────

export interface KmzFeature {
  name: string | null;
  geometry: GeoJSON.Geometry | null;
  properties?: Record<string, unknown> | null;
}

/** Una carpeta (con `children`) o una capa (con `features`) del árbol de capas. */
export interface KmzNode {
  name: string;
  color?: string | null;
  children?: KmzNode[];
  features?: KmzFeature[];
}

/** Coordenadas GeoJSON → texto KML. Se descarta la altura: Google Earth la trata como metros sobre el suelo. */
const coordsToKml = (positions: readonly (readonly number[])[]): string =>
  positions.map((p) => `${p[0]},${p[1]},0`).join(" ");

const ringToKml = (ring: readonly (readonly number[])[]): string =>
  `<LinearRing><coordinates>${coordsToKml(ring)}</coordinates></LinearRing>`;

const polygonToKml = (rings: readonly (readonly (readonly number[])[])[]): string => {
  const [outer, ...inner] = rings;
  if (!outer) return "";
  return `<Polygon><outerBoundaryIs>${ringToKml(outer)}</outerBoundaryIs>${inner
    .map((r) => `<innerBoundaryIs>${ringToKml(r)}</innerBoundaryIs>`)
    .join("")}</Polygon>`;
};

/** Geometría GeoJSON → elemento(s) KML. Devuelve "" si no se puede representar. */
export const geometryToKml = (g: GeoJSON.Geometry | null | undefined): string => {
  if (!g) return "";
  switch (g.type) {
    case "Point":
      return `<Point><coordinates>${coordsToKml([g.coordinates])}</coordinates></Point>`;
    case "LineString":
      return `<LineString><coordinates>${coordsToKml(g.coordinates)}</coordinates></LineString>`;
    case "Polygon":
      return polygonToKml(g.coordinates);
    case "MultiPoint":
      return `<MultiGeometry>${g.coordinates.map((c) => geometryToKml({ type: "Point", coordinates: c as number[] })).join("")}</MultiGeometry>`;
    case "MultiLineString":
      return `<MultiGeometry>${g.coordinates.map((c) => geometryToKml({ type: "LineString", coordinates: c as number[][] })).join("")}</MultiGeometry>`;
    case "MultiPolygon":
      return `<MultiGeometry>${g.coordinates.map((c) => polygonToKml(c)).join("")}</MultiGeometry>`;
    case "GeometryCollection":
      return `<MultiGeometry>${g.geometries.map((x) => geometryToKml(x)).join("")}</MultiGeometry>`;
    default:
      return "";
  }
};

const MAX_EXTENDED_DATA = 30;

const featureToPlacemarkXml = (f: KmzFeature, styleId: string, fallbackName: string): string => {
  const geom = geometryToKml(f.geometry);
  if (!geom) return "";
  const data = Object.entries(f.properties ?? {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, MAX_EXTENDED_DATA)
    .map(([k, v]) => `<Data name="${escapeXml(k)}"><value>${escapeXml(String(v))}</value></Data>`)
    .join("");
  return `<Placemark>
<name>${escapeXml(f.name?.trim() || fallbackName)}</name>
<styleUrl>#${styleId}</styleUrl>
${data ? `<ExtendedData>${data}</ExtendedData>` : ""}
${geom}
</Placemark>`;
};

/** Colores que realmente se usan: el de cada capa con puntos, heredando el de su carpeta. */
const collectNodeColors = (node: KmzNode, inherited: string | null, out: Set<string>) => {
  const color = node.color || inherited;
  if (node.features?.length) out.add(color || "#fb923c");
  node.children?.forEach((c) => collectNodeColors(c, color, out));
};

const nodeToXml = (node: KmzNode, inheritedColor: string | null): string => {
  const color = node.color || inheritedColor;
  const inner = [
    ...(node.children ?? []).map((c) => nodeToXml(c, color)),
    ...(node.features ?? []).map((f) => featureToPlacemarkXml(f, styleIdForColor(color), node.name)),
  ]
    .filter(Boolean)
    .join("\n");
  return `<Folder>\n<name>${escapeXml(node.name)}</name>\n${inner}\n</Folder>`;
};

/** KML con la estructura de carpetas del árbol (un `<Folder>` por carpeta y por capa). */
export const layerTreeToKml = (root: KmzNode): string => {
  const colors = new Set<string>();
  collectNodeColors(root, null, colors);
  const styles = Array.from(colors).map(buildStyleBlock).join("\n");
  return wrapKml(nodeToXml(root, null), root.name, styles);
};

/** Descarga una carpeta o capa del árbol de capas como KMZ, conservando sus subcarpetas. */
export const exportLayerTreeAsKmz = async (root: KmzNode): Promise<void> => {
  const blob = await buildKmzBlob(layerTreeToKml(root));
  triggerDownload(blob, `${safeFilename(root.name)}.kmz`);
};
