import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoiFolder, SavedPoi } from "@/types/pois";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let ids: string[] = [];
      const q = {
        select: () => q,
        in: (_col: string, v: string[]) => {
          ids = v;
          return q;
        },
        range: async (from: number, to: number) => ({
          data: (h.tables[table] ?? []).filter((r) => ids.includes(r.poi_id as string)).slice(from, to + 1),
          error: null,
        }),
      };
      return q;
    },
  },
}));

import { exportFolderDataset } from "@/services/exportFolderDataset";

const folder = (id: string, name: string, parent_id: string | null = null, deleted_at: string | null = null): PoiFolder => ({
  id,
  name,
  parent_id,
  color: null,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at,
});

const poi = (id: string, name: string, folder_id: string, extra: Partial<SavedPoi> = {}): SavedPoi => ({
  id,
  name,
  description: null,
  category: null,
  color: null,
  icon: null,
  lat: -33.45,
  lng: -70.65,
  properties: {},
  source_layer: null,
  folder_id,
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});

const folders = [
  folder("R", "Retail Norte"),
  folder("C", "Sub Carpeta", "R"),
  folder("X", "Otra"),
  folder("D", "Borrada", "R", "2026-02-01T00:00:00Z"),
];

const pois = [
  poi("p1", "Local, \"Uno\"", "R", { properties: { direccion: "Av. Siempre Viva 1" } }),
  poi("p2", "Local Dos", "C", { properties: { address: "Calle Falsa 2" }, lat: -33.5, lng: -70.7 }),
  poi("p3", "Fuera de alcance", "X"),
  poi("p4", "Borrado", "R", { deleted_at: "2026-03-01T00:00:00Z" }),
  poi("p5", "En carpeta borrada", "D"),
];

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });

const readBytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });

describe("exportFolderDataset (dataset completo)", () => {
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
    h.tables = {
      poi_attributes: [
        { poi_id: "p1", attr_key: "Local", attr_value: "10" },
        { poi_id: "p1", attr_key: "Comuna", attr_value: "Santiago" },
        { poi_id: "p2", attr_key: "Local", attr_value: "2" },
        { poi_id: "p3", attr_key: "Local", attr_value: "99" },
      ],
      poi_features_cache: [
        { poi_id: "p1", features: { pob_500: 1200, nota: "ok" }, iso_minutes: 10, is_rm: true, config_version: 1, computed_at: "2026-04-01T00:00:00Z" },
        { poi_id: "p1", features: { pob_500: 1, nota: "viejo" }, iso_minutes: 5, is_rm: false, config_version: 1, computed_at: "2026-01-01T00:00:00Z" },
      ],
      poi_metrics: [
        { poi_id: "p1", metric_key: "ventas", period: "2026-01-01", value: 100 },
        { poi_id: "p1", metric_key: "ventas", period: "2026-06-01", value: 999 },
        { poi_id: "p2", metric_key: "ventas", period: "2026-02-01", value: 50 },
      ],
    };
  });

  afterEach(() => vi.restoreAllMocks());

  it("genera el mismo CSV de siempre: BOM, coma, CRLF, columnas e historial por período", async () => {
    const res = await exportFolderDataset(folders[0], folders, pois, {
      folder_id: "R",
      static_columns: ["Local"],
    } as never);

    expect(res.rows).toBe(2);
    expect(res.filename).toMatch(/^dataset_retail_norte_\d{8}\.csv$/);
    expect(names).toEqual([res.filename]);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");

    const csv = await readBlob(blobs[0]);
    expect(csv).toMatchInlineSnapshot(`
      "poi_id,name,folder,lat,lng,address,Local,Comuna,feat_nota,feat_pob_500,feat_iso_minutes,feat_is_rm,feat_computed_at,ventas_2026-01,ventas_2026-02
      p1,"Local, ""Uno""",Retail Norte,-33.45,-70.65,Av. Siempre Viva 1,10,Santiago,ok,1200,10,true,2026-04-01T00:00:00Z,100,
      p2,Local Dos,Retail Norte › Sub Carpeta,-33.5,-70.7,Calle Falsa 2,2,,,,,,,,50"
    `);
    expect(res.columns).toBe(csv.split("\r\n")[0].split(",").length);

    // readAsText descarta el BOM: se verifica en los bytes crudos.
    const bytes = new Uint8Array(await readBytes(blobs[0]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("falla si la carpeta no tiene POIs activos", async () => {
    await expect(exportFolderDataset(folders[2], folders, [], undefined)).rejects.toThrow(
      "La carpeta no contiene POIs activos",
    );
  });
});
