import type { Geometry, Position } from "geojson";
import type { LayerNode } from "@/types/layerNodes";
import { layersOf, type ImportDocument, type ImportIssue, type ImportNode } from "@/utils/importParser";
import { compareSiblings } from "@/utils/fractionalIndex";
import type { TreeRow } from "@/utils/layerTree";

/** Lógica pura del asistente de importación (sin React ni red). */

// ── El árbol del archivo, con la misma forma que el panel de capas ───────────

const fakeNode = (n: ImportNode): LayerNode => ({
  id: n.key,
  parent_id: null,
  kind: n.kind,
  name: n.name,
  position: "",
  style: { ...(n.color ? { color: n.color } : {}), ...(n.icon ? { icon: n.icon } : {}) },
  scope: "shared",
  owner_id: null,
  archived_at: null,
  created_at: "",
  updated_at: "",
});

/** El documento como filas del panel (el id de cada fila es la clave del archivo). Las capas son hojas. */
export const docToTreeRows = (doc: ImportDocument): TreeRow[] => {
  const walk = (n: ImportNode): TreeRow =>
    n.kind === "folder"
      ? { id: n.key, kind: "folder", name: n.name, node: fakeNode(n), children: (n.children ?? []).map(walk) }
      : { id: n.key, kind: "layer", name: n.name, node: fakeNode(n), featureCount: n.features?.length ?? 0 };
  return [walk(doc.root)];
};

/** Todas las carpetas abiertas al empezar: el usuario quiere ver qué trae el archivo. */
export const allFoldersOpen = (doc: ImportDocument): Record<string, boolean> => {
  const open: Record<string, boolean> = {};
  const walk = (n: ImportNode) => {
    if (n.kind !== "folder") return;
    open[n.key] = true;
    n.children?.forEach(walk);
  };
  walk(doc.root);
  return open;
};

/** Claves de las capas que SÍ se importan (las que no están excluidas). */
export const includedLayerKeys = (doc: ImportDocument, excludedLayers: ReadonlySet<string>): Set<string> =>
  new Set(layersOf(doc.root).filter((l) => !excludedLayers.has(l.key)).map((l) => l.key));

/** Aplica un cambio de casilla (varias capas a la vez) al conjunto de exclusiones. */
export const applyInclusion = (excluded: ReadonlySet<string>, layerKeys: readonly string[], include: boolean): Set<string> => {
  const next = new Set(excluded);
  for (const k of layerKeys) {
    if (include) next.delete(k);
    else next.add(k);
  }
  return next;
};

// ── Mapa de vista previa ─────────────────────────────────────────────────────

export interface PreviewItem {
  layerKey: string;
  geometry: Geometry;
  name: string | null;
  color: string;
}

export const PREVIEW_PALETTE = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#06b6d4"];

/**
 * Lo que se dibuja en el mapa de vista previa: una muestra pareja (no los primeros N) de
 * lo incluido, para no clavar el navegador con 20 mil marcadores. Devuelve también el total.
 */
export const previewItems = (
  doc: ImportDocument,
  excludedLayers: ReadonlySet<string>,
  maxItems = 4000,
): { items: PreviewItem[]; total: number } => {
  const layers = layersOf(doc.root).filter((l) => !excludedLayers.has(l.key));
  const total = layers.reduce((n, l) => n + (l.features?.length ?? 0), 0);
  const step = total > maxItems ? total / maxItems : 1;
  const items: PreviewItem[] = [];
  let seen = 0;
  let nextPick = 0;
  layers.forEach((l, li) => {
    const color = l.color ?? PREVIEW_PALETTE[li % PREVIEW_PALETTE.length];
    for (const f of l.features ?? []) {
      if (seen >= nextPick) {
        items.push({ layerKey: l.key, geometry: f.geometry, name: f.name, color });
        nextPick += step;
      }
      seen++;
    }
  });
  return { items, total };
};

/** Caja [oeste, sur, este, norte] de lo que se dibuja, o null si no hay nada. */
export const boundsOf = (items: readonly { geometry: Geometry }[]): [number, number, number, number] | null => {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const p = c as Position;
      w = Math.min(w, p[0]);
      e = Math.max(e, p[0]);
      s = Math.min(s, p[1]);
      n = Math.max(n, p[1]);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const it of items) {
    if (it.geometry.type === "GeometryCollection") it.geometry.geometries.forEach((g) => visit((g as { coordinates?: unknown }).coordinates));
    else visit((it.geometry as { coordinates?: unknown }).coordinates);
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
};

// ── Avisos del archivo ───────────────────────────────────────────────────────

export interface IssueGroup {
  kind: ImportIssue["kind"];
  title: string;
  count: number;
  items: ImportIssue[];
}

const ISSUE_TITLES: Record<ImportIssue["kind"], string> = {
  "invalid-geometry": "Geometrías inválidas (no se importan)",
  "no-geometry": "Sin geometría (no se importan)",
  unsupported: "Contenido no soportado (se ignora)",
  warning: "Avisos",
};

/** Agrupa los avisos por tipo, en el orden en que importan: lo que se pierde primero. */
export const groupIssues = (issues: readonly ImportIssue[]): IssueGroup[] =>
  (["invalid-geometry", "no-geometry", "unsupported", "warning"] as const)
    .map((kind) => {
      const items = issues.filter((i) => i.kind === kind);
      return { kind, title: ISSUE_TITLES[kind], count: items.length, items };
    })
    .filter((g) => g.count > 0);

// ── Destino ──────────────────────────────────────────────────────────────────

export interface DestinationOption {
  id: string;
  name: string;
  /** Ruta de carpetas hasta él ("Farmacias › Regionales"). */
  path: string;
  depth: number;
  kind: "folder" | "layer";
}

/**
 * Carpetas (para una importación nueva) o capas (para reemplazar/agregar) del árbol, en el
 * orden en que se ven, con su ruta. Lo archivado no aparece.
 */
export const destinationOptions = (nodes: readonly LayerNode[], kind: "folder" | "layer"): DestinationOption[] => {
  const byParent = new Map<string | null, LayerNode[]>();
  for (const n of nodes) {
    if (n.archived_at) continue;
    const list = byParent.get(n.parent_id);
    if (list) list.push(n);
    else byParent.set(n.parent_id, [n]);
  }
  const out: DestinationOption[] = [];
  const walk = (parent: string | null, path: string[], depth: number) => {
    for (const n of (byParent.get(parent) ?? []).slice().sort(compareSiblings)) {
      if (n.kind === kind) out.push({ id: n.id, name: n.name, path: path.join(" › "), depth, kind });
      if (n.kind === "folder") walk(n.id, [...path, n.name], depth + 1);
    }
  };
  walk(null, [], 0);
  return out;
};

/** Filtra opciones por texto (sin tildes ni mayúsculas) sobre su nombre y su ruta. */
export const filterDestinations = (options: readonly DestinationOption[], term: string): DestinationOption[] => {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = norm(term).split(/\s+/).filter(Boolean);
  if (!words.length) return [...options];
  return options.filter((o) => {
    const hay = norm(`${o.path} ${o.name}`);
    return words.every((w) => hay.includes(w));
  });
};

/** Texto corto para explicar cuántos puntos se escribirán y si caben. */
export const sizeMessage = (rows: number, max: number): string | null =>
  rows > max
    ? `Son ${rows.toLocaleString("es-CL")} puntos y el máximo por confirmación es ${max.toLocaleString("es-CL")}. Excluye partes del archivo o impórtalo por separado.`
    : null;

// ── Resumen de una importación nueva (sin pasar por la base) ─────────────────

/** Qué se crearía en modo "nueva": las carpetas que conservan alguna capa incluida, las capas y los puntos. */
export const newImportSummary = (doc: ImportDocument, excludedLayers: ReadonlySet<string>): { folders: number; layers: number; features: number } => {
  let folders = 0;
  let layers = 0;
  let features = 0;
  const walk = (n: ImportNode): boolean => {
    if (n.kind === "layer") {
      if (excludedLayers.has(n.key)) return false;
      layers++;
      features += n.features?.length ?? 0;
      return true;
    }
    const kept = (n.children ?? []).map(walk).some(Boolean);
    if (kept) folders++;
    return kept;
  };
  walk(doc.root);
  return { folders, layers, features };
};
