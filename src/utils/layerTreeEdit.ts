import type { LayerNode } from "@/types/layerNodes";
import { compareSiblings, computeMovePosition } from "@/utils/fractionalIndex";

/**
 * Lógica pura de la edición del árbol: dónde cae un arrastre, si el destino es
 * válido, cómo se ve el resultado antes de que responda el servidor y cómo se
 * deshace. Las anclas tienen la misma semántica que el RPC `move_node`:
 *   afterId  = hermano que queda inmediatamente ANTES del nodo
 *   beforeId = hermano que queda inmediatamente DESPUÉS del nodo
 *   ninguno  = al final
 */

export interface Placement {
  parentId: string | null;
  afterId: string | null;
  beforeId: string | null;
}

export interface PlannedMove extends Placement {
  id: string;
}

/** Hijos activos de un padre (`null` = raíz), en el orden de la base. */
export const childrenOf = (nodes: readonly LayerNode[], parentId: string | null): LayerNode[] =>
  nodes.filter((n) => n.parent_id === parentId && !n.archived_at).sort(compareSiblings);

/** Ids de todos los descendientes de un nodo (sin incluirlo). */
export const descendantIds = (nodes: readonly LayerNode[], id: string): Set<string> => {
  const byParent = new Map<string | null, LayerNode[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parent_id);
    if (list) list.push(n);
    else byParent.set(n.parent_id, [n]);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    for (const c of byParent.get(stack.pop()!) ?? []) {
      if (!out.has(c.id)) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return out;
};

/** Orden de aparición (recorrido en profundidad) de todos los nodos activos. */
const documentOrder = (nodes: readonly LayerNode[]): Map<string, number> => {
  const order = new Map<string, number>();
  const walk = (parentId: string | null) => {
    for (const n of childrenOf(nodes, parentId)) {
      order.set(n.id, order.size);
      walk(n.id);
    }
  };
  walk(null);
  return order;
};

/** Dónde está hoy un nodo: su padre y los hermanos que lo rodean. */
export const placementOf = (nodes: readonly LayerNode[], id: string): Placement | null => {
  const node = nodes.find((n) => n.id === id);
  if (!node) return null;
  const sibs = childrenOf(nodes, node.parent_id);
  const i = sibs.findIndex((s) => s.id === id);
  if (i === -1) return null;
  return { parentId: node.parent_id, afterId: sibs[i - 1]?.id ?? null, beforeId: sibs[i + 1]?.id ?? null };
};

/**
 * ¿Se pueden soltar estos nodos dentro de `parentId` (`null` = raíz)?
 * Solo carpetas reciben hijos, las capas no van a la raíz, nada entra en sí mismo
 * ni en un descendiente, y lo compartido no se mezcla con lo personal.
 */
export const canDropInto = (
  nodes: readonly LayerNode[],
  dragged: readonly LayerNode[],
  parentId: string | null,
): boolean => {
  if (!dragged.length) return false;
  if (parentId === null) return dragged.every((d) => d.kind === "folder");
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent || parent.kind !== "folder" || parent.archived_at) return false;
  if (dragged.some((d) => d.scope !== parent.scope || d.owner_id !== parent.owner_id)) return false;
  for (const d of dragged) {
    if (d.id === parentId) return false;
    if (d.kind === "folder" && descendantIds(nodes, d.id).has(parentId)) return false;
  }
  return true;
};

/**
 * Traduce un arrastre de `react-arborist` en movimientos de `move_node`.
 *
 * `index` cuenta posiciones en la lista de hijos que se ve en pantalla
 * (`displayedSiblings`, que puede omitir carpetas ocultas), incluyendo a los
 * propios nodos arrastrados si ya estaban ahí. Varios nodos conservan su orden
 * relativo del árbol y quedan juntos.
 */
export const planMoves = (
  nodes: readonly LayerNode[],
  dragIds: readonly string[],
  parentId: string | null,
  index: number,
  displayedSiblings?: readonly string[],
): PlannedMove[] => {
  const drag = new Set(dragIds);
  const shown = displayedSiblings ? [...displayedSiblings] : childrenOf(nodes, parentId).map((n) => n.id);
  const cut = Math.max(0, Math.min(index, shown.length));
  const draggedBefore = shown.slice(0, cut).filter((id) => drag.has(id)).length;
  const remaining = shown.filter((id) => !drag.has(id));
  const at = Math.max(0, Math.min(cut - draggedBefore, remaining.length));

  const order = documentOrder(nodes);
  const ordered = [...drag].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  const beforeId = remaining[at] ?? null;
  let afterId = remaining[at - 1] ?? null;
  const moves: PlannedMove[] = [];
  for (const id of ordered) {
    moves.push({ id, parentId, afterId, beforeId });
    afterId = id;
  }
  return moves;
};

/** ¿El movimiento deja todo donde estaba? (soltar un nodo sobre su propio lugar) */
export const isNoopMove = (nodes: readonly LayerNode[], moves: readonly PlannedMove[]): boolean => {
  if (!moves.length) return true;
  const sim = applyMoves(nodes, moves);
  if (!sim) return false;
  const was = new Map(nodes.map((n) => [n.id, n]));
  const parents = new Set(moves.map((m) => m.parentId));
  for (const m of moves) {
    if (was.get(m.id)?.parent_id !== m.parentId) return false;
  }
  // Mismo padre para todos: es un no-op si el orden de los hijos no cambió.
  for (const pid of parents) {
    const a = childrenOf(nodes, pid).map((n) => n.id).join(",");
    const b = childrenOf(sim, pid).map((n) => n.id).join(",");
    if (a !== b) return false;
  }
  return true;
};

/**
 * Aplica los movimientos sobre una copia de los nodos, con las mismas claves que
 * calcularía la base. Devuelve `null` si alguna ancla no es válida (en ese caso
 * se espera a la respuesta del servidor en vez de pintar algo incorrecto).
 */
export const applyMoves = (nodes: readonly LayerNode[], moves: readonly PlannedMove[]): LayerNode[] | null => {
  let cur = nodes.slice();
  try {
    for (const m of moves) {
      const siblings = childrenOf(cur, m.parentId);
      const position = computeMovePosition(siblings, m.id, { afterId: m.afterId, beforeId: m.beforeId });
      cur = cur.map((n) => (n.id === m.id ? { ...n, parent_id: m.parentId, position } : n));
    }
  } catch {
    return null;
  }
  return cur;
};

/** Quita del conjunto activo los nodos dados y todo lo que cuelga de ellos. */
export const removeSubtrees = (nodes: readonly LayerNode[], ids: readonly string[]): LayerNode[] => {
  const gone = new Set(ids);
  for (const id of ids) for (const d of descendantIds(nodes, id)) gone.add(d);
  return nodes.filter((n) => !gone.has(n.id));
};

/** "Nueva carpeta", "Nueva carpeta 2"… sin repetir los nombres de sus hermanos. */
export const nextFolderName = (siblingNames: readonly string[], base = "Nueva carpeta"): string => {
  const taken = new Set(siblingNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
};

/** Mensaje claro para el usuario a partir de un error de Postgres/PostgREST. */
export const friendlyError = (e: unknown): string => {
  const err = (e ?? {}) as { message?: string; code?: string; details?: string };
  const text = `${err.message ?? ""} ${err.details ?? ""}`;
  if (err.code === "23505" || text.includes("territorial_layers_group_id_name_key")) {
    return "Ya existe una capa con ese nombre en ese grupo.";
  }
  if (err.code === "42501" || text.includes("sin permiso") || text.includes("insufficient_privilege")) {
    return "No tienes permiso para hacer esto.";
  }
  if (text.includes("ciclo")) return "No se puede mover una carpeta dentro de sí misma.";
  if (text.includes("una capa debe estar dentro de una carpeta")) return "Una capa debe estar dentro de una carpeta.";
  if (text.includes("máximo para duplicar")) {
    const m = /contiene ([\d.]+) puntos y el máximo para duplicar es ([\d.]+)/.exec(text);
    return m ? `Tiene ${m[1]} puntos; el máximo para duplicar es ${m[2]}.` : "Es demasiado grande para duplicar.";
  }
  if (text.includes("sigue en la papelera")) return "Restaura primero la carpeta que la contiene.";
  const first = (err.message ?? "").replace(/^[a-z_]+: /, "").trim();
  return first || "No se pudo completar la acción.";
};

// ── Papelera ────────────────────────────────────────────────────────────────

export const TRASH_RETENTION_DAYS = 30;

export interface TrashItem {
  /** Lo que se eliminó (la raíz del subárbol archivado). */
  node: LayerNode;
  /** Cuántos nodos más se fueron con él (carpetas y capas de su interior). */
  descendants: number;
  /** Cuándo lo borra la limpieza diaria. */
  purgeAt: Date;
  /** Días que le quedan (0 si se borra hoy). */
  daysLeft: number;
  /** Nombre de la carpeta de la que salió, si sigue existiendo. */
  parentName: string | null;
}

/**
 * Agrupa los nodos archivados en "lo que el usuario eliminó": las raíces de cada
 * subárbol archivado de una vez (mismo `archived_at` que su padre). Lo más
 * reciente primero.
 */
export const buildTrashItems = (
  archived: readonly LayerNode[],
  /** Nombre de las carpetas activas por id (para decir de dónde salió cada cosa). */
  liveNames: ReadonlyMap<string, string> = new Map(),
  now: Date = new Date(),
): TrashItem[] => {
  const byId = new Map(archived.map((n) => [n.id, n]));
  const kidsByParent = new Map<string, LayerNode[]>();
  for (const n of archived) {
    if (!n.parent_id) continue;
    const list = kidsByParent.get(n.parent_id);
    if (list) list.push(n);
    else kidsByParent.set(n.parent_id, [n]);
  }
  const countWithin = (root: LayerNode): number => {
    let total = 0;
    const stack = [root.id];
    while (stack.length) {
      for (const c of kidsByParent.get(stack.pop()!) ?? []) {
        if (c.archived_at === root.archived_at) {
          total++;
          stack.push(c.id);
        }
      }
    }
    return total;
  };

  return archived
    .filter((n) => {
      const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
      return !parent || parent.archived_at !== n.archived_at;
    })
    .map((node) => {
      const purgeAt = new Date(new Date(node.archived_at as string).getTime() + TRASH_RETENTION_DAYS * 86_400_000);
      return {
        node,
        descendants: countWithin(node),
        purgeAt,
        daysLeft: Math.max(0, Math.ceil((purgeAt.getTime() - now.getTime()) / 86_400_000)),
        parentName: node.parent_id ? (byId.get(node.parent_id)?.name ?? liveNames.get(node.parent_id) ?? null) : null,
      };
    })
    .sort((a, b) => (a.node.archived_at! < b.node.archived_at! ? 1 : a.node.archived_at! > b.node.archived_at! ? -1 : 0));
};
