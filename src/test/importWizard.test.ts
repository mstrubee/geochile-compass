import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LayerNode } from "@/types/layerNodes";
import { parseImportContent } from "@/utils/importParser";
import { analyzeTree, resolveToggle } from "@/utils/layerTree";
import {
  allFoldersOpen,
  applyInclusion,
  boundsOf,
  destinationOptions,
  docToTreeRows,
  filterDestinations,
  groupIssues,
  includedLayerKeys,
  newImportSummary,
  previewItems,
  sizeMessage,
} from "@/utils/importWizard";

const doc = parseImportContent.kml(readFileSync(join(process.cwd(), "src/test/fixtures/import/locales.kml"), "utf-8"), "locales.kml");

describe("docToTreeRows / allFoldersOpen", () => {
  const rows = docToTreeRows(doc);

  it("el archivo es un árbol de una raíz con la misma forma que el panel", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "0", kind: "folder", name: "Red de locales" });
    expect(rows[0].children!.map((c) => c.name)).toEqual(["Norte", "Sur", "Zonas", "Con problemas"]);
    const anto = rows[0].children![0].children![0];
    expect(anto).toMatchObject({ id: "0.0.0", kind: "layer", featureCount: 3 });
    expect(anto.children).toBeUndefined(); // hoja: sin chevron de puntos
  });

  it("lleva el color y el ícono de cada capa para dibujarlos", () => {
    const anto = rows[0].children![0].children![0];
    expect(anto.node!.style.color).toBe("#0288d1");
    expect(anto.node!.style.icon).toMatch(/^https:\/\/www\.gstatic\.com/);
  });

  it("abre todas las carpetas (y solo carpetas)", () => {
    expect(allFoldersOpen(doc)).toEqual({ "0": true, "0.0": true, "0.1": true });
  });
});

describe("exclusiones por capa con las casillas de tres estados", () => {
  const rows = docToTreeRows(doc);
  const state = (excluded: Set<string>) => analyzeTree(rows, includedLayerKeys(doc, excluded));

  it("al abrir, todo está incluido", () => {
    const { states } = state(new Set());
    expect([...states.values()].every((s) => s === "checked")).toBe(true);
  });

  it("excluir una capa deja las carpetas que la contienen en estado intermedio", () => {
    const { states } = state(new Set(["0.0.0"]));
    expect(states.get("0.0.0")).toBe("unchecked");
    expect(states.get("0.0.1")).toBe("checked");
    expect(states.get("0.0")).toBe("mixed");
    expect(states.get("0")).toBe("mixed");
  });

  it("desmarcar una carpeta excluye todas sus capas, y volver a marcarla las incluye", () => {
    const norte = rows[0].children![0];
    let excluded = new Set<string>();
    let r = resolveToggle(norte, state(excluded).states.get("0.0")!, includedLayerKeys(doc, excluded));
    expect(r.visible).toBe(false);
    excluded = applyInclusion(excluded, r.ids, r.visible);
    expect([...excluded].sort()).toEqual(["0.0.0", "0.0.1"]);
    expect(state(excluded).states.get("0.0")).toBe("unchecked");
    r = resolveToggle(norte, state(excluded).states.get("0.0")!, includedLayerKeys(doc, excluded));
    excluded = applyInclusion(excluded, r.ids, r.visible);
    expect(excluded.size).toBe(0);
  });

  it("applyInclusion no modifica el conjunto original", () => {
    const original = new Set(["a"]);
    applyInclusion(original, ["b"], false);
    expect([...original]).toEqual(["a"]);
  });
});

describe("previewItems / boundsOf", () => {
  it("devuelve todo lo incluido si es poco, con su color de capa", () => {
    const { items, total } = previewItems(doc, new Set());
    expect(total).toBe(10);
    expect(items).toHaveLength(10);
    expect(items.find((i) => i.name === "Local Centro")!.color).toBe("#0288d1");
  });

  it("no dibuja lo excluido", () => {
    const { items, total } = previewItems(doc, new Set(["0.0.0", "0.0.1"]));
    expect(total).toBe(6);
    expect(items.some((i) => i.name === "Local Calama")).toBe(false);
  });

  it("con muchos puntos toma una muestra pareja de TODAS las capas (no solo las primeras)", () => {
    const features = Array.from({ length: 1000 }, (_, i) => ({
      key: `x#${i}`, externalId: null, name: `p${i}`, geometry: { type: "Point" as const, coordinates: [-70 - i / 1000, -33] },
      properties: {}, icon: null, color: null,
    }));
    const big = {
      ...doc,
      root: {
        key: "0", kind: "folder" as const, name: "g", color: null, icon: null,
        children: ["a", "b"].map((n, i) => ({ key: `0.${i}`, kind: "layer" as const, name: n, color: null, icon: null, features })),
      },
    };
    const { items, total } = previewItems(big, new Set(), 100);
    expect(total).toBe(2000);
    expect(items.length).toBeGreaterThanOrEqual(99);
    expect(items.length).toBeLessThanOrEqual(101);
    expect(new Set(items.map((i) => i.layerKey))).toEqual(new Set(["0.0", "0.1"]));
  });

  it("calcula la caja de lo dibujado", () => {
    expect(boundsOf([{ geometry: { type: "Point", coordinates: [-70, -33] } }, { geometry: { type: "LineString", coordinates: [[-72, -35], [-71, -34]] } }]))
      .toEqual([-72, -35, -70, -33]);
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ geometry: { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [1, 2] }] } }])).toEqual([1, 2, 1, 2]);
  });
});

describe("groupIssues", () => {
  it("agrupa por tipo con lo que se pierde primero y omite los grupos vacíos", () => {
    const groups = groupIssues(doc.issues);
    expect(groups.map((g) => g.kind)).toEqual(["invalid-geometry", "no-geometry", "unsupported", "warning"]);
    expect(groups[0]).toMatchObject({ count: 3, title: expect.stringMatching(/inválidas/) });
    expect(groupIssues([])).toEqual([]);
  });
});

describe("destinationOptions / filterDestinations", () => {
  const n = (id: string, kind: "folder" | "layer", name: string, parent: string | null, position: string, archived = false): LayerNode => ({
    id, kind, name, parent_id: parent, position, style: {}, scope: "shared", owner_id: null,
    archived_at: archived ? "2026-10-01T00:00:00Z" : null, created_at: "", updated_at: "",
  });
  const nodes = [
    n("F1", "folder", "Farmacias", null, "a0"), n("L1", "layer", "Cruz Verde", "F1", "a0"),
    n("F2", "folder", "Regionales", "F1", "a1"), n("L2", "layer", "Ahumada", "F2", "a0"),
    n("F3", "folder", "Retail", null, "a1"), n("X", "folder", "Archivada", null, "a2", true),
  ];

  it("lista las carpetas en el orden en que se ven, con su ruta y profundidad", () => {
    expect(destinationOptions(nodes, "folder").map((o) => [o.name, o.path, o.depth])).toEqual([
      ["Farmacias", "", 0], ["Regionales", "Farmacias", 1], ["Retail", "", 0],
    ]);
  });

  it("para reemplazar o agregar lista las capas con la carpeta que las contiene", () => {
    expect(destinationOptions(nodes, "layer").map((o) => [o.name, o.path])).toEqual([["Cruz Verde", "Farmacias"], ["Ahumada", "Farmacias › Regionales"]]);
  });

  it("filtra por nombre y por ruta, sin tildes", () => {
    const opts = destinationOptions(nodes, "layer");
    expect(filterDestinations(opts, "regionales").map((o) => o.name)).toEqual(["Ahumada"]);
    expect(filterDestinations(opts, "FARMACIAS cruz").map((o) => o.name)).toEqual(["Cruz Verde"]);
    expect(filterDestinations(opts, "").length).toBe(2);
    expect(filterDestinations(opts, "zzz")).toEqual([]);
  });
});

describe("sizeMessage", () => {
  it("avisa solo cuando no cabe", () => {
    expect(sizeMessage(5000, 5600)).toBeNull();
    expect(sizeMessage(25045, 5600)).toMatch(/25\.045 puntos.*5\.600/);
  });
});

describe("newImportSummary", () => {
  it("cuenta lo que se crearía y deja fuera las carpetas que quedan vacías", () => {
    expect(newImportSummary(doc, new Set())).toEqual({ folders: 3, layers: 6, features: 10 });
    // sin las dos capas de Norte, esa carpeta desaparece
    expect(newImportSummary(doc, new Set(["0.0.0", "0.0.1"]))).toEqual({ folders: 2, layers: 4, features: 6 });
    // sin nada incluido no queda ni la raíz
    const all = new Set(includedLayerKeys(doc, new Set()));
    expect(newImportSummary(doc, all)).toEqual({ folders: 0, layers: 0, features: 0 });
  });
});
