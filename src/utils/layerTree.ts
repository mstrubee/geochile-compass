import type { CheckState, LayerNode } from "@/types/layerNodes";
import { compareSiblings } from "@/utils/fractionalIndex";

/**
 * Lógica pura del panel de árbol de capas: armado del árbol desde `layer_nodes`,
 * casillas de tres estados, búsqueda y vista previa perezosa de los puntos de una
 * capa. Nada acá toca React ni la red, para poder probarlo aparte.
 */

export type TreeRowKind = "folder" | "layer" | "poi" | "status" | "more";

export interface TreeRow {
  /** Id del nodo (uuid) o, para filas sintéticas, `poi:…` / `status:…` / `more:…`. */
  id: string;
  kind: TreeRowKind;
  name: string;
  /** `undefined` = hoja. Una capa con puntos lleva `[]` hasta que se expande. */
  children?: TreeRow[];
  /** Presente en carpetas y capas. */
  node?: LayerNode;
  /** Solo capas: cantidad de puntos (`territorial_layers.feature_count`). */
  featureCount?: number;
  /** Solo filas `poi`, `status` y `more`: la capa a la que pertenecen. */
  layerId?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface BuiltTree {
  roots: TreeRow[];
  /** Nodos que no cuelgan de ninguna raíz (padre ausente o ciclo). No deberían existir. */
  orphanIds: string[];
}

/**
 * Arma el árbol. Los hermanos van por (position, id) comparando como la base
 * (`COLLATE "C"`, o sea por código de carácter, nunca con `localeCompare`).
 */
export const buildLayerTree = (
  nodes: readonly LayerNode[],
  featureCounts: ReadonlyMap<string, number> = new Map(),
): BuiltTree => {
  const byParent = new Map<string | null, LayerNode[]>();
  for (const n of nodes) {
    const key = n.parent_id ?? null;
    const list = byParent.get(key);
    if (list) list.push(n);
    else byParent.set(key, [n]);
  }

  const reached = new Set<string>();
  const toRow = (n: LayerNode): TreeRow => {
    reached.add(n.id);
    if (n.kind === "folder") {
      const kids = (byParent.get(n.id) ?? []).slice().sort(compareSiblings);
      return { id: n.id, kind: "folder", name: n.name, node: n, children: kids.filter((k) => !reached.has(k.id)).map(toRow) };
    }
    const count = featureCounts.get(n.id) ?? 0;
    return { id: n.id, kind: "layer", name: n.name, node: n, featureCount: count, children: count > 0 ? [] : undefined };
  };

  const roots = (byParent.get(null) ?? []).slice().sort(compareSiblings).map(toRow);
  const orphanIds = nodes.filter((n) => !reached.has(n.id)).map((n) => n.id);
  return { roots, orphanIds };
};

/** Ids de las capas bajo una fila (ella misma si es una capa). */
export const collectLayerIds = (row: TreeRow): string[] => {
  if (row.kind === "layer") return [row.id];
  if (row.kind !== "folder") return [];
  const out: string[] = [];
  const walk = (r: TreeRow) => {
    if (r.kind === "layer") out.push(r.id);
    else if (r.kind === "folder") r.children?.forEach(walk);
  };
  walk(row);
  return out;
};

export interface FolderStats {
  layers: number;
  visibleLayers: number;
  features: number;
}

export interface TreeAnalysis {
  /** Estado de cada carpeta y capa (las filas sintéticas no tienen casilla). */
  states: Map<string, CheckState>;
  /** Totales por carpeta, para mostrar "3/10". */
  stats: Map<string, FolderStats>;
}

/**
 * Casillas de tres estados en una sola pasada: una capa está marcada si es
 * visible; una carpeta, si todas sus capas descendientes lo están (intermedia si
 * solo algunas). Una carpeta sin capas queda desmarcada.
 */
export const analyzeTree = (roots: readonly TreeRow[], visible: ReadonlySet<string>): TreeAnalysis => {
  const states = new Map<string, CheckState>();
  const stats = new Map<string, FolderStats>();

  const walk = (r: TreeRow): FolderStats => {
    if (r.kind === "layer") {
      const on = visible.has(r.id);
      states.set(r.id, on ? "checked" : "unchecked");
      return { layers: 1, visibleLayers: on ? 1 : 0, features: r.featureCount ?? 0 };
    }
    const acc: FolderStats = { layers: 0, visibleLayers: 0, features: 0 };
    if (r.kind === "folder") {
      for (const c of r.children ?? []) {
        const s = walk(c);
        acc.layers += s.layers;
        acc.visibleLayers += s.visibleLayers;
        acc.features += s.features;
      }
      states.set(
        r.id,
        acc.layers === 0 || acc.visibleLayers === 0 ? "unchecked" : acc.visibleLayers === acc.layers ? "checked" : "mixed",
      );
      stats.set(r.id, acc);
    }
    return acc;
  };
  roots.forEach(walk);
  return { states, stats };
};

export interface ToggleResolution {
  /** Capas que hay que encender o apagar (todas las del subárbol). */
  ids: string[];
  visible: boolean;
  /** Las que hoy están apagadas y quedarían encendidas. */
  activating: string[];
}

/**
 * Qué hace clic en la casilla de una fila. Una capa se invierte; una carpeta
 * marcada apaga todo su subárbol y una desmarcada o intermedia lo enciende todo.
 */
export const resolveToggle = (row: TreeRow, state: CheckState, visible: ReadonlySet<string>): ToggleResolution => {
  const ids = collectLayerIds(row);
  const target = row.kind === "layer" ? !visible.has(row.id) : state !== "checked";
  return { ids, visible: target, activating: target ? ids.filter((id) => !visible.has(id)) : [] };
};

/** Puntos totales que se empezarían a pintar. Sirve para avisar antes de una carga enorme. */
export const activationWeight = (layerIds: readonly string[], featureCounts: ReadonlyMap<string, number>): number =>
  layerIds.reduce((sum, id) => sum + (featureCounts.get(id) ?? 0), 0);

// ── Búsqueda ───────────────────────────────────────────────────────────────

/** Minúsculas y sin tildes: "Estación" y "estacion" coinciden. */
export const normalizeText = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * ¿Coincide un nodo con la búsqueda? Cada palabra del término debe aparecer en el
 * nombre del nodo o en el de alguno de sus ancestros. Así "farmacias" muestra la
 * carpeta con todo lo que contiene y "farmacias cruz" solo las capas "Cruz…" de
 * esa carpeta.
 */
export const matchesSearch = (names: readonly string[], term: string): boolean => {
  const words = normalizeText(term).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = normalizeText(names.join(" "));
  return words.every((w) => haystack.includes(w));
};

// ── Filtros heredados de la UI anterior ───────────────────────────────────────

/** Se ocultan: ya tienen su propio interruptor ("Parque automotor") en la barra lateral. */
const HIDDEN_ROOTS = ["parque automotriz"];

/**
 * Mantiene lo que la lista anterior ocultaba. El orden ya no se toca: desde la
 * Fase 3 lo decide el árbol (se reordena arrastrando).
 */
export const applyLegacyRootRules = (roots: readonly TreeRow[]): TreeRow[] =>
  roots.filter((r) => !HIDDEN_ROOTS.includes(r.name.trim().toLowerCase()));

// ── Vista previa perezosa de los puntos de una capa ────────────────────────

export interface FeaturePreviewItem {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

export interface FeaturePreview {
  items: FeaturePreviewItem[];
  loading: boolean;
  error: boolean;
  /** Quedan más páginas por pedir. */
  hasMore: boolean;
}

export const POI_PAGE_SIZE = 100;

const poiRow = (layerId: string, f: FeaturePreviewItem): TreeRow => ({
  id: `poi:${f.id}`,
  kind: "poi",
  name: f.name?.trim() || "(sin nombre)",
  layerId,
  lat: f.lat,
  lng: f.lng,
});

/** Reemplaza los hijos de cada capa pedida por sus puntos (más una fila de estado si falta algo). */
export const withFeaturePreviews = (
  roots: readonly TreeRow[],
  previews: ReadonlyMap<string, FeaturePreview>,
): TreeRow[] => {
  if (!previews.size) return roots as TreeRow[];
  const walk = (r: TreeRow): TreeRow => {
    if (r.kind === "folder") return { ...r, children: r.children?.map(walk) };
    if (r.kind !== "layer") return r;
    const p = previews.get(r.id);
    if (!p) return r;
    const kids: TreeRow[] = p.items.map((f) => poiRow(r.id, f));
    if (p.error) kids.push({ id: `status:${r.id}`, kind: "status", name: "No se pudieron cargar los puntos", layerId: r.id });
    else if (p.loading) kids.push({ id: `status:${r.id}`, kind: "status", name: "Cargando…", layerId: r.id });
    else if (p.hasMore) {
      const remaining = (r.featureCount ?? 0) - p.items.length;
      const label = remaining > 0 ? `Ver más… (${remaining.toLocaleString("es-CL")} restantes)` : "Ver más…";
      kids.push({ id: `more:${r.id}`, kind: "more", name: label, layerId: r.id });
    }
    return { ...r, children: kids };
  };
  return roots.map(walk);
};
