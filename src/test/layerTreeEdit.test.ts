import { describe, expect, it } from "vitest";
import type { LayerNode } from "@/types/layerNodes";
import {
  applyMoves,
  buildTrashItems,
  canDropInto,
  childrenOf,
  descendantIds,
  friendlyError,
  isNoopMove,
  nextFolderName,
  placementOf,
  planMoves,
  removeSubtrees,
} from "@/utils/layerTreeEdit";

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
const folder = (id: string, parent: string | null, position: string) => node({ id, kind: "folder", name: id, parent_id: parent, position });
const layer = (id: string, parent: string | null, position: string) => node({ id, kind: "layer", name: id, parent_id: parent, position });

/**
 *  R1: A, B, C           (capas)
 *  R2: F (carpeta: X, Y) , Z (capa)
 *  R3: (vacía)
 */
const sample = (): LayerNode[] => [
  folder("R1", null, "a0"), layer("A", "R1", "a0"), layer("B", "R1", "a1"), layer("C", "R1", "a2"),
  folder("R2", null, "a1"), folder("F", "R2", "a0"), layer("X", "F", "a0"), layer("Y", "F", "a1"), layer("Z", "R2", "a1"),
  folder("R3", null, "a2"),
];
const order = (nodes: LayerNode[], parent: string | null) => childrenOf(nodes, parent).map((n) => n.id);

describe("childrenOf / descendantIds / placementOf", () => {
  it("devuelve los hijos activos en orden y deja fuera lo archivado", () => {
    const nodes = sample().map((n) => (n.id === "B" ? { ...n, archived_at: "2026-10-01T00:00:00Z" } : n));
    expect(order(nodes, "R1")).toEqual(["A", "C"]);
    expect(order(nodes, null)).toEqual(["R1", "R2", "R3"]);
  });

  it("junta todos los descendientes, sin el propio nodo", () => {
    expect([...descendantIds(sample(), "R2")].sort()).toEqual(["F", "X", "Y", "Z"]);
    expect([...descendantIds(sample(), "A")]).toEqual([]);
  });

  it("describe dónde está un nodo y quiénes lo rodean", () => {
    const n = sample();
    expect(placementOf(n, "B")).toEqual({ parentId: "R1", afterId: "A", beforeId: "C" });
    expect(placementOf(n, "A")).toEqual({ parentId: "R1", afterId: null, beforeId: "B" });
    expect(placementOf(n, "C")).toEqual({ parentId: "R1", afterId: "B", beforeId: null });
    expect(placementOf(n, "nope")).toBeNull();
  });
});

describe("canDropInto", () => {
  const get = (nodes: LayerNode[], ...ids: string[]) => ids.map((id) => nodes.find((n) => n.id === id)!);

  it("solo las carpetas reciben hijos", () => {
    const n = sample();
    expect(canDropInto(n, get(n, "A"), "R2")).toBe(true);
    expect(canDropInto(n, get(n, "A"), "Z")).toBe(false); // Z es una capa
    expect(canDropInto(n, get(n, "A"), "no-existe")).toBe(false);
  });

  it("las capas no van a la raíz; las carpetas sí", () => {
    const n = sample();
    expect(canDropInto(n, get(n, "A"), null)).toBe(false);
    expect(canDropInto(n, get(n, "F"), null)).toBe(true);
    expect(canDropInto(n, get(n, "F", "A"), null)).toBe(false);
  });

  it("una carpeta no entra en sí misma ni en un descendiente", () => {
    const n = sample();
    expect(canDropInto(n, get(n, "R2"), "R2")).toBe(false);
    expect(canDropInto(n, get(n, "R2"), "F")).toBe(false);
    expect(canDropInto(n, get(n, "F"), "R1")).toBe(true);
  });

  it("no mezcla lo compartido con lo personal ni entra en la papelera", () => {
    const n = sample().map((x) => (x.id === "R3" ? { ...x, scope: "personal" as const, owner_id: "u1" } : x));
    expect(canDropInto(n, get(n, "A"), "R3")).toBe(false);
    const arch = sample().map((x) => (x.id === "R3" ? { ...x, archived_at: "2026-10-01T00:00:00Z" } : x));
    expect(canDropInto(arch, get(arch, "A"), "R3")).toBe(false);
  });

  it("sin nodos arrastrados no hay destino válido", () => {
    expect(canDropInto(sample(), [], "R1")).toBe(false);
  });
});

describe("planMoves (índice de react-arborist → anclas de move_node)", () => {
  const n = sample();

  it("al principio de una carpeta", () => {
    expect(planMoves(n, ["B"], "R1", 0)).toEqual([{ id: "B", parentId: "R1", afterId: null, beforeId: "A" }]);
  });

  it("al final de una carpeta", () => {
    expect(planMoves(n, ["A"], "R1", 3)).toEqual([{ id: "A", parentId: "R1", afterId: "C", beforeId: null }]);
  });

  it("en el medio, descontando al propio nodo si ya estaba antes del hueco", () => {
    // C se suelta en el hueco 1 (entre A y B)
    expect(planMoves(n, ["C"], "R1", 1)).toEqual([{ id: "C", parentId: "R1", afterId: "A", beforeId: "B" }]);
    // A se suelta en el hueco 2 (entre B y C): como A estaba antes, el hueco real es entre B y C
    expect(planMoves(n, ["A"], "R1", 2)).toEqual([{ id: "A", parentId: "R1", afterId: "B", beforeId: "C" }]);
  });

  it("a una carpeta vacía", () => {
    expect(planMoves(n, ["A"], "R3", 0)).toEqual([{ id: "A", parentId: "R3", afterId: null, beforeId: null }]);
  });

  it("varios nodos quedan juntos y en su orden del árbol, sin importar el orden de la selección", () => {
    const plan = planMoves(n, ["C", "A"], "R2", 0);
    expect(plan).toEqual([
      { id: "A", parentId: "R2", afterId: null, beforeId: "F" },
      { id: "C", parentId: "R2", afterId: "A", beforeId: "F" },
    ]);
  });

  it("usa la lista que se ve en pantalla cuando hay carpetas ocultas", () => {
    // en pantalla la raíz muestra solo R1 y R3; el hueco 1 queda entre ellas
    expect(planMoves(n, ["R2"], null, 1, ["R1", "R3"])).toEqual([
      { id: "R2", parentId: null, afterId: "R1", beforeId: "R3" },
    ]);
  });

  it("acota un índice fuera de rango", () => {
    expect(planMoves(n, ["A"], "R1", 99)).toEqual([{ id: "A", parentId: "R1", afterId: "C", beforeId: null }]);
    expect(planMoves(n, ["B"], "R1", -5)).toEqual([{ id: "B", parentId: "R1", afterId: null, beforeId: "A" }]);
  });
});

describe("applyMoves e isNoopMove", () => {
  it("reordena dentro de la misma carpeta", () => {
    const n = sample();
    const out = applyMoves(n, planMoves(n, ["C"], "R1", 0))!;
    expect(order(out, "R1")).toEqual(["C", "A", "B"]);
  });

  it("cambia de carpeta", () => {
    const n = sample();
    const out = applyMoves(n, planMoves(n, ["A"], "R2", 1))!;
    expect(order(out, "R1")).toEqual(["B", "C"]);
    expect(order(out, "R2")).toEqual(["F", "A", "Z"]);
    expect(out.find((x) => x.id === "A")!.parent_id).toBe("R2");
  });

  it("varios nodos conservan su orden relativo", () => {
    const n = sample();
    const out = applyMoves(n, planMoves(n, ["C", "A"], "R3", 0))!;
    expect(order(out, "R3")).toEqual(["A", "C"]);
    expect(order(out, "R1")).toEqual(["B"]);
  });

  it("el resultado coincide con las claves que calcula la base (mismo algoritmo)", () => {
    const n = sample();
    const out = applyMoves(n, planMoves(n, ["C"], "R1", 1))!;
    const c = out.find((x) => x.id === "C")!;
    const a = out.find((x) => x.id === "A")!;
    const b = out.find((x) => x.id === "B")!;
    expect(a.position < c.position && c.position < b.position).toBe(true);
  });

  it("no toca el arreglo original", () => {
    const n = sample();
    const snapshot = JSON.stringify(n);
    applyMoves(n, planMoves(n, ["A"], "R2", 0));
    expect(JSON.stringify(n)).toBe(snapshot);
  });

  it("devuelve null si un ancla no es válida", () => {
    expect(applyMoves(sample(), [{ id: "A", parentId: "R2", afterId: "C", beforeId: null }])).toBeNull();
  });

  it("detecta soltar un nodo en su mismo lugar", () => {
    const n = sample();
    expect(isNoopMove(n, planMoves(n, ["B"], "R1", 1))).toBe(true);
    expect(isNoopMove(n, planMoves(n, ["B"], "R1", 2))).toBe(true);
    expect(isNoopMove(n, planMoves(n, ["B"], "R1", 0))).toBe(false);
    expect(isNoopMove(n, planMoves(n, ["B"], "R2", 0))).toBe(false);
    expect(isNoopMove(n, [])).toBe(true);
  });
});

describe("deshacer un movimiento", () => {
  it("volver a las anclas originales deja el árbol como estaba", () => {
    const n = sample();
    const before = placementOf(n, "B")!;
    const moved = applyMoves(n, planMoves(n, ["B"], "R3", 0))!;
    expect(order(moved, "R3")).toEqual(["B"]);
    const back = applyMoves(moved, [{ id: "B", ...before }])!;
    expect(order(back, "R1")).toEqual(["A", "B", "C"]);
    expect(order(back, "R3")).toEqual([]);
  });
});

describe("removeSubtrees", () => {
  it("quita el nodo y todo lo que cuelga de él", () => {
    expect(removeSubtrees(sample(), ["R2"]).map((n) => n.id).sort()).toEqual(["A", "B", "C", "R1", "R3"]);
    expect(removeSubtrees(sample(), ["A", "F"]).map((n) => n.id).sort()).toEqual(["B", "C", "R1", "R2", "R3", "Z"]);
  });
});

describe("nextFolderName", () => {
  it("usa el nombre base si está libre y numera si no", () => {
    expect(nextFolderName([])).toBe("Nueva carpeta");
    expect(nextFolderName(["Nueva carpeta"])).toBe("Nueva carpeta 2");
    expect(nextFolderName(["nueva carpeta", "Nueva carpeta 2"])).toBe("Nueva carpeta 3");
  });
});

describe("friendlyError", () => {
  it("traduce los errores conocidos", () => {
    expect(friendlyError({ code: "23505", message: "duplicate key value violates unique constraint \"territorial_layers_group_id_name_key\"" }))
      .toBe("Ya existe una capa con ese nombre en ese grupo.");
    expect(friendlyError({ code: "42501", message: "move_node: sin permiso para mover este nodo" })).toBe("No tienes permiso para hacer esto.");
    expect(friendlyError({ message: "move_node: mover un nodo dentro de sí mismo o de un descendiente crearía un ciclo" }))
      .toBe("No se puede mover una carpeta dentro de sí misma.");
    expect(friendlyError({ message: "layer_nodes: una capa debe estar dentro de una carpeta" })).toBe("Una capa debe estar dentro de una carpeta.");
    expect(friendlyError({ message: "duplicate_node: contiene 25045 puntos y el máximo para duplicar es 10000" }))
      .toBe("Tiene 25045 puntos; el máximo para duplicar es 10000.");
    expect(friendlyError({ message: "restore_node: la carpeta de esta capa sigue en la papelera; restaura primero la carpeta" }))
      .toBe("Restaura primero la carpeta que la contiene.");
  });

  it("deja pasar el mensaje de lo desconocido sin el prefijo de la función", () => {
    expect(friendlyError({ message: "rename_node: el nombre no puede estar vacío" })).toBe("el nombre no puede estar vacío");
    expect(friendlyError(null)).toBe("No se pudo completar la acción.");
  });
});

describe("buildTrashItems", () => {
  const T1 = "2026-10-01T10:00:00+00:00";
  const T2 = "2026-10-10T10:00:00+00:00";
  const arch = (n: LayerNode, at: string) => ({ ...n, archived_at: at });
  const now = new Date("2026-10-14T10:00:00Z");

  it("agrupa por lo que el usuario eliminó: la raíz archivada de una vez, con lo que se fue con ella", () => {
    const n = sample();
    const archived = [arch(n.find((x) => x.id === "R2")!, T2), arch(n.find((x) => x.id === "F")!, T2),
      arch(n.find((x) => x.id === "X")!, T2), arch(n.find((x) => x.id === "Z")!, T2)];
    const items = buildTrashItems(archived, new Map(), now);
    expect(items).toHaveLength(1);
    expect(items[0].node.id).toBe("R2");
    expect(items[0].descendants).toBe(3); // F, X, Z
  });

  it("lo archivado antes que su carpeta es otro elemento de la papelera", () => {
    const n = sample();
    const archived = [arch(n.find((x) => x.id === "Z")!, T1), arch(n.find((x) => x.id === "R2")!, T2), arch(n.find((x) => x.id === "F")!, T2)];
    const items = buildTrashItems(archived, new Map(), now);
    expect(items.map((i) => i.node.id)).toEqual(["R2", "Z"]); // más reciente primero
    expect(items.find((i) => i.node.id === "R2")!.descendants).toBe(1); // Z NO se cuenta
    expect(items.find((i) => i.node.id === "Z")!.parentName).toBe("R2");
  });

  it("calcula cuándo se purga y los días que quedan", () => {
    const n = sample();
    const [item] = buildTrashItems([arch(n.find((x) => x.id === "A")!, T1)], new Map([["R1", "R1"]]), now);
    expect(item.purgeAt.toISOString()).toBe("2026-10-31T10:00:00.000Z");
    expect(item.daysLeft).toBe(17);
    expect(item.parentName).toBe("R1");
  });

  it("no baja de 0 días si ya venció", () => {
    const n = sample();
    const [item] = buildTrashItems([arch(n.find((x) => x.id === "A")!, "2026-08-01T00:00:00Z")], new Map(), now);
    expect(item.daysLeft).toBe(0);
  });
});
