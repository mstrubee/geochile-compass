import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: h.rpc, from: vi.fn(() => ({ insert: h.insert })) },
}));

import {
  chunkRows,
  commitImport,
  createImport,
  includedFeatureCount,
  previewImport,
  representativePoint,
  toStagingRows,
  uploadStaging,
} from "@/services/layerImport";
import { parseImportContent } from "@/utils/importParser";

const doc = parseImportContent.kml(readFileSync(join(process.cwd(), "src/test/fixtures/import/locales.kml"), "utf-8"), "locales.kml");
const ok = (data: unknown = null) => Promise.resolve({ data, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  h.rpc.mockImplementation(() => ok(0));
  h.insert.mockImplementation(() => Promise.resolve({ error: null }));
});

describe("representativePoint", () => {
  it("un punto es él mismo", () => {
    expect(representativePoint({ type: "Point", coordinates: [-70.5, -33.4] })).toEqual({ lat: -33.4, lng: -70.5 });
  });

  it("una línea o polígono usa el centro de su caja", () => {
    expect(representativePoint({ type: "LineString", coordinates: [[-70, -33], [-72, -35]] })).toEqual({ lat: -34, lng: -71 });
    expect(representativePoint({ type: "Polygon", coordinates: [[[0.5, 0.5], [0.5, 2.5], [2.5, 2.5], [0.5, 0.5]]] })).toEqual({ lat: 1.5, lng: 1.5 });
  });

  it("una colección mezcla todas sus partes", () => {
    const c = representativePoint({
      type: "GeometryCollection",
      geometries: [{ type: "Point", coordinates: [-70, -33] }, { type: "LineString", coordinates: [[-72, -35], [-71, -34]] }],
    });
    expect(c).toEqual({ lat: -34, lng: -71 });
  });

  it("una geometría vacía no tiene punto", () => {
    expect(representativePoint({ type: "MultiPoint", coordinates: [] })).toBeNull();
  });
});

describe("toStagingRows", () => {
  const rows = toStagingRows(doc, "batch-1");

  it("una fila por punto con la clave de su capa y su posición dentro de ella", () => {
    expect(rows).toHaveLength(doc.counts.features);
    const anto = rows.filter((r) => r.layer_key === "0.0.0");
    expect(anto.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.import_id === "batch-1")).toBe(true);
  });

  it("calcula lat/lng también para líneas y polígonos (las consultas por zona las necesitan)", () => {
    expect(rows.every((r) => r.lat != null && r.lng != null)).toBe(true);
    const zona = rows.find((r) => r.name === "Zona A")!;
    expect(zona.lat).toBeCloseTo(-33.1, 5);
    expect(zona.lng).toBeCloseTo(-70.1, 5);
  });

  it("conserva el external_id y los atributos", () => {
    const centro = rows.find((r) => r.name === "Local Centro")!;
    expect(centro.external_id).toBe("loc-001");
    expect(centro.properties).toEqual({ comuna: "Antofagasta", m2: "120" });
  });
});

describe("chunkRows", () => {
  it("parte por cantidad", () => {
    const chunks = chunkRows(Array.from({ length: 1200 }, (_, i) => ({ i })), 500, 10_000_000);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 200]);
  });

  it("parte por peso, sin dejar un tramo vacío ni perder filas", () => {
    const big = Array.from({ length: 5 }, (_, i) => ({ i, pad: "x".repeat(400) }));
    const chunks = chunkRows(big, 500, 1000);
    expect(chunks.flat()).toEqual(big);
    expect(chunks.every((c) => c.length >= 1)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("una fila más pesada que el tope va sola", () => {
    const chunks = chunkRows([{ pad: "x".repeat(5000) }, { pad: "y" }], 500, 100);
    expect(chunks.map((c) => c.length)).toEqual([1, 1]);
  });

  it("sin filas no hay tramos", () => {
    expect(chunkRows([])).toEqual([]);
  });
});

describe("uploadStaging", () => {
  it("sube en tramos, avisa el avance y cierra la subida", async () => {
    const progress: [number, number][] = [];
    await uploadStaging("b1", doc, (d, t) => progress.push([d, t]));
    const total = doc.counts.features;
    expect(h.insert).toHaveBeenCalledTimes(1); // 10 puntos caben en un tramo
    expect(h.insert.mock.calls[0][0]).toHaveLength(total);
    expect(progress.at(-1)).toEqual([total, total]);
    expect(h.rpc).toHaveBeenCalledWith("finish_layer_import_staging", { p_import_id: "b1" });
  });

  it("reintenta una vez un tramo que falla", async () => {
    h.insert.mockImplementationOnce(() => Promise.resolve({ error: { message: "red" } }));
    await uploadStaging("b1", doc);
    expect(h.insert).toHaveBeenCalledTimes(2);
  });

  it("si el reintento también falla, lanza el error y no cierra la subida", async () => {
    h.insert.mockImplementation(() => Promise.resolve({ error: { message: "sin permiso", code: "42501" } }));
    await expect(uploadStaging("b1", doc)).rejects.toMatchObject({ code: "42501" });
    expect(h.insert).toHaveBeenCalledTimes(2);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("se puede cancelar entre tramos", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(uploadStaging("b1", doc, undefined, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(h.insert).not.toHaveBeenCalled();
  });
});

describe("RPC", () => {
  it("createImport manda la estructura sin los puntos y el total", async () => {
    h.rpc.mockImplementationOnce(() => ok("batch-9"));
    expect(await createImport(doc)).toBe("batch-9");
    const [fn, args] = h.rpc.mock.calls[0];
    expect(fn).toBe("create_layer_import");
    expect(args).toMatchObject({ p_filename: "locales.kml", p_format: "kml", p_feature_total: 10 });
    expect(JSON.stringify(args.p_structure)).not.toContain("coordinates");
    expect(args.p_structure.name).toBe("Red de locales");
  });

  it("previewImport y commitImport pasan las exclusiones como arreglo", async () => {
    h.rpc.mockImplementation(() => ok({ mode: "new", fits: true }));
    await previewImport("b1", "new", "dest", new Set(["0.1", "0.2"]));
    expect(h.rpc).toHaveBeenLastCalledWith("preview_layer_import", { p_import_id: "b1", p_mode: "new", p_target_node_id: "dest", p_excluded_keys: ["0.1", "0.2"] });
    await commitImport("b1", "replace", "capa", new Set());
    expect(h.rpc).toHaveBeenLastCalledWith("commit_layer_import", { p_import_id: "b1", p_mode: "replace", p_target_node_id: "capa", p_excluded_keys: [] });
  });

  it("un error de la base se propaga con su código", async () => {
    h.rpc.mockImplementationOnce(() => Promise.resolve({ data: null, error: { message: "importador: sin permiso", code: "42501" } }));
    await expect(commitImport("b1", "new", null, new Set())).rejects.toMatchObject({ code: "42501" });
  });
});

describe("includedFeatureCount", () => {
  it("descuenta lo excluido", () => {
    expect(includedFeatureCount(doc, new Set())).toBe(10);
    expect(includedFeatureCount(doc, new Set(["0.0"]))).toBe(6);
  });
});
