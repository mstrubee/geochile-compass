import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { PoiFolder, SavedPoi } from "@/types/pois";
import { exportFolderCoords } from "@/services/exportFolderCoords";

const folder = (id: string, name: string, parent_id: string | null = null, deleted_at: string | null = null): PoiFolder => ({
  id,
  name,
  parent_id,
  color: null,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at,
});

const poi = (id: string, name: string, folder_id: string, lat: number, lng: number, deleted_at: string | null = null): SavedPoi => ({
  id,
  name,
  description: null,
  category: null,
  color: null,
  icon: null,
  lat,
  lng,
  properties: {},
  source_layer: null,
  folder_id,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at,
});

const folders = [
  folder("R", "Retail Ñandú"),
  folder("C", "Sub", "R"),
  folder("X", "Otra"),
  folder("D", "Borrada", "R", "2026-02-01T00:00:00Z"),
];
const pois = [
  poi("1", "Local 10", "R", -33.45, -70.65),
  poi("2", "Local 2", "C", -33.123456789, -70.987654321),
  poi("3", 'Tienda "Sur"; Centro', "C", -34, -71),
  poi("4", "Fuera de alcance", "X", 0, 0),
  poi("5", "Eliminado", "R", 0, 0, "2026-03-01T00:00:00Z"),
  poi("6", "En carpeta eliminada", "D", 0, 0),
];

const readBytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });

describe("exportFolderCoords", () => {
  let blobs: Blob[];
  let names: string[];

  beforeEach(() => {
    blobs = [];
    names = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("CSV: carpeta y subcarpetas sin eliminados, 3 columnas, 6 decimales, orden natural y escape de ; y comillas", async () => {
    const res = await exportFolderCoords(folders[0], folders, pois, "csv");
    expect(res.rows).toBe(3);
    expect(res.filename).toMatch(/^locales_retail_nandu_\d{8}\.csv$/);
    expect(names).toEqual([res.filename]);

    const bytes = new Uint8Array(await readBytes(blobs[0]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
    expect(new TextDecoder().decode(bytes.slice(3)).split("\r\n")).toEqual([
      "Nombre;Latitud;Longitud",
      "Local 2;-33.123457;-70.987654", // natural: 2 antes que 10
      "Local 10;-33.450000;-70.650000",
      '"Tienda ""Sur""; Centro";-34.000000;-71.000000',
    ]);
  });

  it("Excel: hoja «Locales» con las mismas filas y lat/lng numéricos", async () => {
    const res = await exportFolderCoords(folders[0], folders, pois, "xlsx");
    expect(res.filename).toMatch(/^locales_retail_nandu_\d{8}\.xlsx$/);

    const wb = XLSX.read(await readBytes(blobs[0]), { type: "array" });
    expect(wb.SheetNames).toEqual(["Locales"]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Locales"], { header: 1 })).toEqual([
      ["Nombre", "Latitud", "Longitud"],
      ["Local 2", -33.123457, -70.987654],
      ["Local 10", -33.45, -70.65],
      ['Tienda "Sur"; Centro', -34, -71],
    ]);
    expect(wb.Sheets["Locales"]["B2"].t).toBe("n");
  });

  it("falla con el mismo error del dataset si la carpeta no tiene POIs activos", async () => {
    await expect(exportFolderCoords(folders[2], folders, [pois[4]], "csv")).rejects.toThrow(
      "La carpeta no contiene POIs activos",
    );
    expect(blobs).toHaveLength(0);
  });
});
