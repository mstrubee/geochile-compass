import { compareSiblings } from "@/utils/fractionalIndex";
import type { LayerNode } from "@/types/layerNodes";
import type { TerritorialGroup } from "@/types/territorial";

/** Misma regla que `_legacy_slug` de la base (sin la parte de colisiones, que no aplica acá). */
export const slugFromName = (name: string): string => {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "carpeta";
};

/**
 * Los "grupos" que usan el análisis y los roles de las carpetas son las carpetas RAÍZ compartidas y activas del
 * árbol de capas (`layer_nodes`): mismo id, nombre, color e ícono que tenía el grupo antiguo. El `slug` viene del
 * estilo de la carpeta (las heredadas lo traen) y, si no lo tiene, se deriva del nombre. El orden es el del árbol:
 * el que el administrador dejó arrastrando, no el `order_index` antiguo.
 */
export const groupsFromNodes = (nodes: readonly LayerNode[]): TerritorialGroup[] =>
  nodes
    .filter((n) => n.kind === "folder" && n.parent_id === null && n.scope === "shared" && !n.archived_at)
    .sort(compareSiblings)
    .map((n, i) => ({
      id: n.id,
      name: n.name,
      slug: n.style.slug || slugFromName(n.name),
      color: n.style.color ?? null,
      icon: n.style.icon ?? null,
      order_index: i,
      visible_default: n.style.visible_default ?? false,
    }));
