/**
 * Exporta los locales de una carpeta de POIs (con subcarpetas) como Excel o CSV
 * con tres columnas: Nombre | Latitud | Longitud. Usa los POIs que ya están en
 * memoria; no consulta Supabase.
 */
import * as XLSX from "xlsx";
import type { PoiFolder, SavedPoi } from "@/types/pois";
import { byNameNatural } from "@/utils/naturalSort";

export type CoordsFormat = "xlsx" | "csv";

export interface CoordsExportResult {
  rows: number;
  filename: string;
}

const HEADERS = ["Nombre", "Latitud", "Longitud"];

/** Ids de la carpeta y de todas sus subcarpetas no eliminadas. */
const collectFolderIds = (rootId: string, allFolders: PoiFolder[]): Set<string> => {
  const out = new Set<string>([rootId]);
  const childrenOf = new Map<string, string[]>();
  for (const f of allFolders) {
    if (f.deleted_at || !f.parent_id) continue;
    childrenOf.set(f.parent_id, [...(childrenOf.get(f.parent_id) ?? []), f.id]);
  }
  const walk = (id: string) => {
    for (const child of childrenOf.get(id) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        walk(child);
      }
    }
  };
  walk(rootId);
  return out;
};

const slugify = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "carpeta";

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

/** YYYYMMDD en hora local. */
const todayStamp = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

const csvEscape = (v: string): string => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const round6 = (n: number): number | null => (Number.isFinite(n) ? Number(n.toFixed(6)) : null);

/** Locales de la carpeta y subcarpetas (sin eliminados), en orden natural por nombre. */
export const coordsRows = (
  folder: PoiFolder,
  allFolders: PoiFolder[],
  allPois: SavedPoi[],
): Array<{ nombre: string; lat: number | null; lng: number | null }> => {
  const ids = collectFolderIds(folder.id, allFolders);
  return allPois
    .filter((p) => !p.deleted_at && p.folder_id && ids.has(p.folder_id))
    .sort(byNameNatural)
    .map((p) => ({ nombre: p.name, lat: round6(p.lat), lng: round6(p.lng) }));
};

/** CSV con BOM UTF-8, separador ";" y punto decimal. */
export const coordsToCsv = (rows: ReturnType<typeof coordsRows>): string => {
  const lines = [HEADERS.join(";")];
  for (const r of rows) {
    lines.push([csvEscape(r.nombre), r.lat?.toFixed(6) ?? "", r.lng?.toFixed(6) ?? ""].join(";"));
  }
  return "\uFEFF" + lines.join("\r\n");
};

const coordsToXlsx = (rows: ReturnType<typeof coordsRows>): ArrayBuffer => {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows.map((r) => [r.nombre, r.lat, r.lng])]);
  for (let i = 1; i <= rows.length; i++) {
    for (const c of [1, 2]) {
      const cell = ws[XLSX.utils.encode_cell({ r: i, c })];
      if (cell) cell.z = "0.000000";
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Locales");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
};

export const exportFolderCoords = async (
  folder: PoiFolder,
  allFolders: PoiFolder[],
  allPois: SavedPoi[],
  format: CoordsFormat,
): Promise<CoordsExportResult> => {
  const rows = coordsRows(folder, allFolders, allPois);
  if (rows.length === 0) {
    throw new Error("La carpeta no contiene POIs activos");
  }

  const filename = `locales_${slugify(folder.name)}_${todayStamp()}.${format}`;
  const blob =
    format === "xlsx"
      ? new Blob([coordsToXlsx(rows)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      : new Blob([coordsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename);

  return { rows: rows.length, filename };
};
