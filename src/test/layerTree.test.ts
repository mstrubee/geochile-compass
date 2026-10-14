import { describe, expect, it } from "vitest";
import type { LayerNode } from "@/types/layerNodes";
import {
  activationWeight,
  analyzeTree,
  applyLegacyRootRules,
  buildLayerTree,
  collectLayerIds,
  matchesSearch,
  normalizeText,
  resolveToggle,
  withFeaturePreviews,
  type FeaturePreview,
  type TreeRow,
} from "@/utils/layerTree";

const node = (over: Partial<LayerNode> & Pick<LayerNode, "id" | "kind" | "name">): LayerNode => ({
  parent_id: null,
  position: "a0",
  style: {},
  scope: "shared",
  owner_id: null,
  archived_at: null,
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
  ...over,
});
const folder = (id: string, name: string, parent: string | null, position = "a0") =>
  node({ id, kind: "folder", name, parent_id: parent, position });
const layer = (id: string, name: string, parent: string | null, position = "a0") =>
  node({ id, kind: "layer", name, parent_id: parent, position });

/**
 *  Farmacias (F1)
 *    Cruz Verde (L1, 10 pts)
 *    Salcobrand (L2, 5 pts)
 *    Regionales (F2)
 *      Ahumada (L3, 7 pts)
 *  Vacía (F3)
 */
const sample = () => {
  const nodes = [
    folder("F1", "Farmacias", null, "a0"),
    layer("L2", "Salcobrand", "F1", "a1"),
    layer("L1", "Cruz Verde", "F1", "a0"),
    folder("F2", "Regionales", "F1", "a2"),
    layer("L3", "Ahumada", "F2", "a0"),
    folder("F3", "Vacía", null, "a1"),
  ];
  const counts = new Map([["L1", 10], ["L2", 5], ["L3", 7]]);
  return buildLayerTree(nodes, counts);
};

describe("buildLayerTree", () => {
  it("anida carpetas y capas y ordena los hermanos por posición", () => {
    const { roots, orphanIds } = sample();
    expect(orphanIds).toEqual([]);
    expect(roots.map((r) => r.name)).toEqual(["Farmacias", "Vacía"]);
    expect(roots[0].children!.map((r) => r.name)).toEqual(["Cruz Verde", "Salcobrand", "Regionales"]);
    expect(roots[0].children![2].children!.map((r) => r.name)).toEqual(["Ahumada"]);
  });

  it("ordena como la base (por código de carácter): mayúsculas antes que minúsculas", () => {
    const { roots } = buildLayerTree([folder("a", "x", null, "aa"), folder("b", "y", null, "aB"), folder("c", "z", null, "ab")]);
    // 'B' (66) < 'a' (97) < 'b' (98): "aB" < "aa" < "ab". localeCompare daría aa, ab, aB.
    expect(roots.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("desempata por id cuando la posición es igual", () => {
    const { roots } = buildLayerTree([folder("b", "B", null, "a0"), folder("a", "A", null, "a0")]);
    expect(roots.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("marca las capas con puntos como expandibles y las vacías como hoja", () => {
    const { roots } = buildLayerTree([layer("L", "Con puntos", null), layer("V", "Vacía", null, "a1")], new Map([["L", 3]]));
    expect(roots[0].children).toEqual([]);
    expect(roots[1].children).toBeUndefined();
  });

  it("reporta como huérfano lo que no cuelga de ninguna raíz", () => {
    const { roots, orphanIds } = buildLayerTree([folder("F", "F", null), layer("X", "Sin padre", "no-existe")]);
    expect(roots.map((r) => r.id)).toEqual(["F"]);
    expect(orphanIds).toEqual(["X"]);
  });

  it("un ciclo de padres no cuelga la construcción y queda como huérfano", () => {
    const { roots, orphanIds } = buildLayerTree([folder("A", "A", "B"), folder("B", "B", "A")]);
    expect(roots).toEqual([]);
    expect(orphanIds.sort()).toEqual(["A", "B"]);
  });
});

describe("collectLayerIds", () => {
  it("junta las capas de todo el subárbol", () => {
    const { roots } = sample();
    expect(collectLayerIds(roots[0]).sort()).toEqual(["L1", "L2", "L3"]);
    expect(collectLayerIds(roots[1])).toEqual([]);
  });

  it("una capa es ella misma y una fila sintética no tiene capas", () => {
    const { roots } = sample();
    expect(collectLayerIds(roots[0].children![0])).toEqual(["L1"]);
    expect(collectLayerIds({ id: "poi:1", kind: "poi", name: "p" })).toEqual([]);
  });
});

describe("analyzeTree — casillas de tres estados", () => {
  it("todo apagado: nada marcado", () => {
    const { roots } = sample();
    const { states } = analyzeTree(roots, new Set());
    expect([...states.values()].every((s) => s === "unchecked")).toBe(true);
  });

  it("mezcla en una carpeta: intermedia, y también en sus ancestros", () => {
    const { roots } = sample();
    const { states } = analyzeTree(roots, new Set(["L3"]));
    expect(states.get("L3")).toBe("checked");
    expect(states.get("F2")).toBe("checked"); // su única capa está encendida
    expect(states.get("F1")).toBe("mixed"); // faltan L1 y L2
    expect(states.get("L1")).toBe("unchecked");
  });

  it("todas las capas encendidas: la carpeta queda marcada en todos los niveles", () => {
    const { roots } = sample();
    const { states } = analyzeTree(roots, new Set(["L1", "L2", "L3"]));
    expect(states.get("F1")).toBe("checked");
    expect(states.get("F2")).toBe("checked");
  });

  it("una carpeta sin capas nunca se marca", () => {
    const { roots } = sample();
    expect(analyzeTree(roots, new Set(["L1", "L2", "L3"])).states.get("F3")).toBe("unchecked");
  });

  it("cuenta capas, visibles y puntos por carpeta", () => {
    const { roots } = sample();
    const { stats } = analyzeTree(roots, new Set(["L1", "L3"]));
    expect(stats.get("F1")).toEqual({ layers: 3, visibleLayers: 2, features: 22 });
    expect(stats.get("F2")).toEqual({ layers: 1, visibleLayers: 1, features: 7 });
    expect(stats.get("F3")).toEqual({ layers: 0, visibleLayers: 0, features: 0 });
  });

  it("ignora ids visibles que ya no existen en el árbol", () => {
    const { roots } = sample();
    const { states } = analyzeTree(roots, new Set(["borrada", "L1"]));
    expect(states.get("F1")).toBe("mixed");
  });
});

describe("resolveToggle", () => {
  const rows = () => {
    const { roots } = sample();
    return { f1: roots[0], l1: roots[0].children![0], f3: roots[1] };
  };

  it("una capa se invierte", () => {
    const { l1 } = rows();
    expect(resolveToggle(l1, "unchecked", new Set())).toEqual({ ids: ["L1"], visible: true, activating: ["L1"] });
    expect(resolveToggle(l1, "checked", new Set(["L1"]))).toEqual({ ids: ["L1"], visible: false, activating: [] });
  });

  it("una carpeta desmarcada enciende todo su subárbol", () => {
    const { f1 } = rows();
    const r = resolveToggle(f1, "unchecked", new Set());
    expect(r.visible).toBe(true);
    expect(r.ids.sort()).toEqual(["L1", "L2", "L3"]);
    expect(r.activating.sort()).toEqual(["L1", "L2", "L3"]);
  });

  it("una carpeta intermedia también enciende todo (y solo cuenta lo que estaba apagado)", () => {
    const { f1 } = rows();
    const r = resolveToggle(f1, "mixed", new Set(["L1"]));
    expect(r.visible).toBe(true);
    expect(r.activating.sort()).toEqual(["L2", "L3"]);
  });

  it("una carpeta marcada apaga todo su subárbol", () => {
    const { f1 } = rows();
    const r = resolveToggle(f1, "checked", new Set(["L1", "L2", "L3"]));
    expect(r.visible).toBe(false);
    expect(r.ids.sort()).toEqual(["L1", "L2", "L3"]);
    expect(r.activating).toEqual([]);
  });

  it("una carpeta sin capas no cambia nada", () => {
    const { f3 } = rows();
    expect(resolveToggle(f3, "unchecked", new Set()).ids).toEqual([]);
  });
});

describe("activationWeight", () => {
  it("suma los puntos de las capas dadas y trata como 0 las desconocidas", () => {
    const counts = new Map([["a", 10], ["b", 5]]);
    expect(activationWeight(["a", "b", "x"], counts)).toBe(15);
    expect(activationWeight([], counts)).toBe(0);
  });
});

describe("búsqueda", () => {
  it("normaliza tildes y mayúsculas", () => {
    expect(normalizeText("  Estación DE Servicio ")).toBe("estacion de servicio");
  });

  it("coincide por el nombre propio o por el de un ancestro", () => {
    expect(matchesSearch(["Cruz Verde", "Farmacias"], "farmacias")).toBe(true);
    expect(matchesSearch(["Cruz Verde", "Farmacias"], "cruz")).toBe(true);
    expect(matchesSearch(["Salcobrand", "Farmacias"], "cruz")).toBe(false);
  });

  it("todas las palabras deben aparecer, en cualquier nivel de la cadena", () => {
    expect(matchesSearch(["Cruz Verde", "Farmacias"], "farmacias cruz")).toBe(true);
    expect(matchesSearch(["Salcobrand", "Farmacias"], "farmacias cruz")).toBe(false);
  });

  it("ignora tildes y un término vacío coincide con todo", () => {
    expect(matchesSearch(["Estación Copec"], "estacion")).toBe(true);
    expect(matchesSearch(["Lo que sea"], "   ")).toBe(true);
  });
});

describe("applyLegacyRootRules", () => {
  const root = (name: string, id = name): TreeRow => ({ id, kind: "folder", name, children: [] });

  it("oculta Parque Automotriz y deja SERV. AUTOMOTRICES primero, sin alterar el resto", () => {
    const out = applyLegacyRootRules([root("Parque Automotriz"), root("Farmacias"), root("Retail"), root("SERV. AUTOMOTRICES"), root("Otros")]);
    expect(out.map((r) => r.name)).toEqual(["SERV. AUTOMOTRICES", "Farmacias", "Retail", "Otros"]);
  });

  it("no toca el orden si no hay nada que fijar", () => {
    const out = applyLegacyRootRules([root("B"), root("A")]);
    expect(out.map((r) => r.name)).toEqual(["B", "A"]);
  });
});

describe("withFeaturePreviews", () => {
  const preview = (over: Partial<FeaturePreview> = {}): FeaturePreview => ({
    items: [],
    loading: false,
    error: false,
    hasMore: false,
    ...over,
  });
  const l1 = (roots: TreeRow[]) => roots[0].children![0];

  it("sin vistas previas devuelve el mismo árbol", () => {
    const { roots } = sample();
    expect(withFeaturePreviews(roots, new Map())).toBe(roots);
  });

  it("pone los puntos como hijos de la capa pedida y deja el resto igual", () => {
    const { roots } = sample();
    const out = withFeaturePreviews(
      roots,
      new Map([["L1", preview({ items: [{ id: "p1", name: "Local 1", lat: -33, lng: -70 }, { id: "p2", name: null, lat: -34, lng: -71 }] })]]),
    );
    const kids = l1(out).children!;
    expect(kids.map((k) => [k.kind, k.name, k.layerId])).toEqual([
      ["poi", "Local 1", "L1"],
      ["poi", "(sin nombre)", "L1"],
    ]);
    expect(kids[0].lat).toBe(-33);
    expect(out[0].children![1].children).toEqual([]); // L2 sin tocar
  });

  it("muestra 'Cargando…' mientras llega la página", () => {
    const { roots } = sample();
    const out = withFeaturePreviews(roots, new Map([["L1", preview({ loading: true })]]));
    expect(l1(out).children!.map((k) => [k.kind, k.name])).toEqual([["status", "Cargando…"]]);
  });

  it("ofrece 'Ver más…' solo cuando quedan páginas y no está cargando", () => {
    const { roots } = sample();
    const item = { id: "p1", name: "A", lat: 0, lng: 0 };
    const more = withFeaturePreviews(roots, new Map([["L1", preview({ items: [item], hasMore: true })]]));
    // L1 tiene 10 puntos y ya se muestra 1
    expect(l1(more).children!.at(-1)).toMatchObject({ kind: "more", layerId: "L1", name: "Ver más… (9 restantes)" });
    const busy = withFeaturePreviews(roots, new Map([["L1", preview({ items: [item], hasMore: true, loading: true })]]));
    expect(l1(busy).children!.map((k) => k.kind)).toEqual(["poi", "status"]);
  });

  it("un error se muestra como fila de estado, sin romper lo ya cargado", () => {
    const { roots } = sample();
    const out = withFeaturePreviews(roots, new Map([["L1", preview({ items: [{ id: "p1", name: "A", lat: 0, lng: 0 }], error: true })]]));
    expect(l1(out).children!.map((k) => k.kind)).toEqual(["poi", "status"]);
  });
});
