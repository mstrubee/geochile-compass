import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { geometryToKml, layerTreeToKml, type KmzNode } from "@/utils/kmzExport";
import { buildKmzTree } from "@/services/layerTreeExport";
import { buildLayerTree } from "@/utils/layerTree";
import type { LayerNode } from "@/types/layerNodes";

const parse = (kml: string) => new DOMParser().parseFromString(kml, "application/xml");
const q = (doc: Document, sel: string) => Array.from(doc.querySelectorAll(sel));
const text = (el: Element | null | undefined) => el?.textContent ?? "";

describe("geometryToKml", () => {
  it("un punto pierde la altura (siempre 0)", () => {
    expect(geometryToKml({ type: "Point", coordinates: [-70.6, -33.4, 1500] })).toBe(
      "<Point><coordinates>-70.6,-33.4,0</coordinates></Point>",
    );
  });

  it("línea y polígono con hueco", () => {
    expect(geometryToKml({ type: "LineString", coordinates: [[0, 0], [1, 1, 9]] })).toContain("<coordinates>0,0,0 1,1,0</coordinates>");
    const poly = geometryToKml({
      type: "Polygon",
      coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]],
    });
    expect(poly).toContain("<outerBoundaryIs>");
    expect(poly).toContain("<innerBoundaryIs>");
  });

  it("las geometrías múltiples van en MultiGeometry", () => {
    const multi = geometryToKml({ type: "MultiPoint", coordinates: [[0, 0], [1, 1]] });
    expect(multi.startsWith("<MultiGeometry>")).toBe(true);
    expect((multi.match(/<Point>/g) ?? []).length).toBe(2);
    expect(geometryToKml({ type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] }))
      .toContain("</Polygon><Polygon>");
  });

  it("sin geometría no hay nada que escribir", () => {
    expect(geometryToKml(null)).toBe("");
    expect(geometryToKml({ type: "Polygon", coordinates: [] })).toBe("");
  });
});

describe("layerTreeToKml", () => {
  const tree: KmzNode = {
    name: 'Farmacias & "Cía"',
    color: "#10b981",
    children: [
      {
        name: "Cruz Verde",
        features: [
          { name: "Local <1>", geometry: { type: "Point", coordinates: [-70.6, -33.4] }, properties: { comuna: "Providencia", n: 5, anidado: { x: 1 } } },
          { name: null, geometry: { type: "Point", coordinates: [-70.7, -33.5] } },
          { name: "Sin geometría", geometry: null },
        ],
      },
      { name: "Regionales", color: "#ef4444", children: [{ name: "Ahumada", features: [{ name: "A", geometry: { type: "Point", coordinates: [-71, -33] } }] }] },
    ],
  };
  const doc = parse(layerTreeToKml(tree));

  it("genera un XML válido y escapa los nombres", () => {
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(text(doc.querySelector("Document > name"))).toBe('Farmacias & "Cía"');
  });

  it("conserva la estructura de carpetas anidadas", () => {
    const root = doc.querySelector("Document > Folder")!;
    expect(text(root.querySelector(":scope > name"))).toBe('Farmacias & "Cía"');
    const subs = q(doc, "Document > Folder > Folder").map((f) => text(f.querySelector(":scope > name")));
    expect(subs).toEqual(["Cruz Verde", "Regionales"]);
    expect(q(doc, "Folder Folder Folder > name").map(text)).toEqual(["Ahumada"]);
  });

  it("un Placemark por punto con geometría; los puntos sin nombre usan el de su capa", () => {
    const placemarks = q(doc, "Placemark");
    expect(placemarks).toHaveLength(3); // el que no tiene geometría se omite
    const names = placemarks.map((p) => text(p.querySelector(":scope > name")));
    expect(names).toEqual(["Local <1>", "Cruz Verde", "A"]);
  });

  it("guarda los atributos simples como ExtendedData y descarta los anidados", () => {
    const data = q(doc, "Placemark ExtendedData Data").map((d) => [d.getAttribute("name"), text(d.querySelector("value"))]);
    expect(data).toEqual([["comuna", "Providencia"], ["n", "5"]]);
  });

  it("cada capa usa el color de su carpeta si no tiene uno propio, y hay un estilo por color", () => {
    const styles = q(doc, "Document > Style").map((s) => s.getAttribute("id"));
    expect(new Set(styles)).toEqual(new Set(["s_10b981", "s_ef4444"]));
    const urls = q(doc, "Placemark > styleUrl").map(text);
    expect(urls).toEqual(["#s_10b981", "#s_10b981", "#s_ef4444"]);
  });
});

describe("buildKmzTree", () => {
  const node = (id: string, kind: "folder" | "layer", name: string, parent: string | null, position: string, color?: string): LayerNode => ({
    id, kind, name, parent_id: parent, position, style: color ? { color } : {}, scope: "shared", owner_id: null,
    archived_at: null, created_at: "", updated_at: "",
  });

  it("recorre el árbol, pide los puntos de cada capa y deja fuera las filas de vista previa", async () => {
    const nodes = [
      node("F", "folder", "Farmacias", null, "a0", "#10b981"),
      node("L1", "layer", "Cruz Verde", "F", "a0"),
      node("S", "folder", "Regionales", "F", "a1"),
      node("L2", "layer", "Ahumada", "S", "a0"),
    ];
    const { roots } = buildLayerTree(nodes, new Map([["L1", 2], ["L2", 1]]));
    // una capa expandida trae filas de punto como hijos; no deben exportarse como carpetas
    roots[0].children![0].children = [{ id: "poi:1", kind: "poi", name: "Local", layerId: "L1" }];

    const fetchFeatures = vi.fn(async (id: string) => [{ name: `P-${id}`, geometry: { type: "Point", coordinates: [0, 0] } as GeoJSON.Geometry }]);
    const progress: number[] = [];
    const out = await buildKmzTree(roots[0], (n) => progress.push(n), fetchFeatures);

    expect(fetchFeatures.mock.calls.map((c) => c[0])).toEqual(["L1", "L2"]);
    expect(progress).toEqual([1, 2]);
    expect(out).toMatchObject({ name: "Farmacias", color: "#10b981" });
    expect(out.children!.map((c) => c.name)).toEqual(["Cruz Verde", "Regionales"]);
    expect(out.children![0].features).toHaveLength(1);
    expect(out.children![1].children![0]).toMatchObject({ name: "Ahumada" });
  });

  it("el KMZ es un zip con doc.kml", async () => {
    const zip = new JSZip();
    zip.file("doc.kml", layerTreeToKml({ name: "X", features: [{ name: "p", geometry: { type: "Point", coordinates: [0, 0] } }] }));
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
    expect(Object.keys(loaded.files)).toEqual(["doc.kml"]);
  });
});
