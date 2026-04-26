import JSZip from "jszip";
import type { PoiFolder, SavedPoi } from "@/types/pois";

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
    a.name.localeCompare(b.name, "es"),
  );
  const pois = (poisByFolder.get(folder.id) ?? [])
    .filter((p) => !p.deleted_at)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

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
const triggerDownload = (blob: Blob, filename: string) => {
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

const safeFilename = (name: string): string =>
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
