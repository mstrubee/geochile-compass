import type { Database } from "@/integrations/supabase/types";

/**
 * Árbol de capas estilo Google Earth (tabla `layer_nodes`).
 *
 * Una carpeta puede contener carpetas y capas a cualquier profundidad; una capa
 * es siempre una hoja. Las carpetas raíz y las capas reutilizan el uuid de los grupos y capas
 * antiguos; `territorial_layers` sigue siendo la tabla de detalle de cada capa (fuente, modo de
 * render, bbox, features…). Los "grupos" del análisis son las carpetas raíz (ver
 * `groupsFromNodes`); `territorial_layer_groups` queda solo hasta que se aplique su retiro.
 */
export type LayerNodeRow = Database["public"]["Tables"]["layer_nodes"]["Row"];

export type LayerNodeKind = "folder" | "layer";
export type LayerNodeScope = "shared" | "personal";

/** Estilo que guarda el nodo; las carpetas raíz heredadas traen además `slug` y `visible_default`. */
export interface LayerNodeStyle {
  color?: string;
  icon?: string;
  opacity?: number;
  slug?: string;
  visible_default?: boolean;
}

export interface LayerNode extends Omit<LayerNodeRow, "kind" | "scope" | "style"> {
  kind: LayerNodeKind;
  scope: LayerNodeScope;
  style: LayerNodeStyle;
}

/** Estado de una casilla de visibilidad; el de una carpeta se deriva del de sus capas. */
export type CheckState = "checked" | "unchecked" | "mixed";

export const isFolder = (n: Pick<LayerNode, "kind">): boolean => n.kind === "folder";

/** Normaliza una fila de la base al tipo de dominio. */
export const toLayerNode = (r: LayerNodeRow): LayerNode => ({
  ...r,
  kind: r.kind as LayerNodeKind,
  scope: r.scope as LayerNodeScope,
  style: (r.style && typeof r.style === "object" && !Array.isArray(r.style) ? r.style : {}) as LayerNodeStyle,
});
