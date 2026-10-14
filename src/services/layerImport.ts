import type { Geometry, Position } from "geojson";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isExcluded, layersOf, structureOf, type ImportDocument } from "@/utils/importParser";

/**
 * Cliente del importador: sube los puntos de un archivo ya parseado a la base
 * (staging), pide la vista previa y confirma. Nada se escribe en las capas hasta
 * `commitImport`, que corre en una sola transacción en la base.
 */

export type ImportMode = "new" | "replace" | "append";

export interface ImportLimits {
  max_rows: number;
  statement_timeout: string;
}

export interface DiffSample {
  name: string | null;
  changed?: string[];
}

export interface ImportPreview {
  mode: ImportMode;
  max_rows: number;
  fits: boolean;
  empty?: boolean;
  included: { layers: number; features: number };
  new?: { folders: number; layers: number; features: number; rows_to_write: number };
  target?: { id: string; name: string; feature_count: number };
  diff?: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    kept: number;
    matched_by_external_id: number;
    matched_by_coords: number;
    rows_to_write: number;
    samples: { added: (string | null)[]; removed: (string | null)[]; modified: DiffSample[] };
  };
}

export interface ImportResult {
  mode: ImportMode;
  folders?: number;
  layers?: number;
  features: number;
  root_node_ids?: string[];
  added?: number;
  removed?: number;
  modified?: number;
  unchanged?: number;
  target_node_id?: string;
}

const call = async <T,>(p: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T> => {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
};

// ── Preparar los puntos ──────────────────────────────────────────────────────

const walkPositions = (c: unknown, visit: (p: Position) => void) => {
  if (Array.isArray(c) && typeof c[0] === "number") visit(c as Position);
  else if (Array.isArray(c)) c.forEach((x) => walkPositions(x, visit));
};

/**
 * `lat`/`lng` de un punto: su ubicación. Para líneas y polígonos, el centro de su caja. Las
 * consultas por zona (análisis de isócronas) filtran por estas columnas, así que no pueden
 * quedar vacías.
 */
export const representativePoint = (g: Geometry): { lat: number; lng: number } | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (p: Position) => {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  };
  if (g.type === "GeometryCollection") g.geometries.forEach((x) => walkPositions((x as { coordinates?: unknown }).coordinates, visit));
  else walkPositions((g as { coordinates?: unknown }).coordinates, visit);
  if (!Number.isFinite(minX)) return null;
  return { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2 };
};

export interface StagingRow {
  import_id: string;
  layer_key: string;
  seq: number;
  external_id: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
  geometry: Json;
  properties: Json;
}

/** Todas las filas de staging de un documento (en el orden del archivo). */
export const toStagingRows = (doc: ImportDocument, importId: string): StagingRow[] => {
  const rows: StagingRow[] = [];
  for (const layer of layersOf(doc.root)) {
    (layer.features ?? []).forEach((f, seq) => {
      const pt = representativePoint(f.geometry);
      rows.push({
        import_id: importId,
        layer_key: layer.key,
        seq,
        external_id: f.externalId,
        name: f.name,
        lat: pt?.lat ?? null,
        lng: pt?.lng ?? null,
        geometry: f.geometry as unknown as Json,
        properties: f.properties as unknown as Json,
      });
    });
  }
  return rows;
};

const CHUNK_ROWS = 500;
const CHUNK_BYTES = 900_000; // PostgREST acepta cuerpos grandes, pero conviene no acercarse al límite del gateway

/** Parte las filas en lotes de hasta 500 filas o ~900 KB (lo que ocurra primero). */
export const chunkRows = <T,>(rows: readonly T[], maxRows = CHUNK_ROWS, maxBytes = CHUNK_BYTES): T[][] => {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const r of rows) {
    const size = JSON.stringify(r).length;
    if (cur.length && (cur.length >= maxRows || bytes + size > maxBytes)) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
};

// ── RPC ──────────────────────────────────────────────────────────────────────

export const fetchImportLimits = async (): Promise<ImportLimits> => (await call(supabase.rpc("layer_import_limits"))) as unknown as ImportLimits;

/** Crea el lote (con la estructura del archivo) y devuelve su id. */
export const createImport = (doc: ImportDocument): Promise<string> =>
  call(
    supabase.rpc("create_layer_import", {
      p_filename: doc.filename,
      p_format: doc.format,
      p_structure: structureOf(doc.root) as unknown as Json,
      p_feature_total: doc.counts.features,
    }),
  ) as Promise<string>;

/**
 * Sube los puntos del documento al lote. Reintenta una vez cada tramo y avisa el avance.
 * Si algo falla se descarta el lote (no queda nada a medias en la base).
 */
export const uploadStaging = async (
  importId: string,
  doc: ImportDocument,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const rows = toStagingRows(doc, importId);
  let done = 0;
  for (const chunk of chunkRows(rows)) {
    if (signal?.aborted) throw new DOMException("Subida cancelada", "AbortError");
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await supabase.from("territorial_import_staging").insert(chunk);
      if (!error) {
        lastError = undefined;
        break;
      }
      lastError = error;
    }
    if (lastError) throw lastError;
    done += chunk.length;
    onProgress?.(done, rows.length);
  }
  await call(supabase.rpc("finish_layer_import_staging", { p_import_id: importId }));
};

export const previewImport = async (importId: string, mode: ImportMode, targetNodeId: string | null, excluded: ReadonlySet<string>): Promise<ImportPreview> =>
  (await call(
    supabase.rpc("preview_layer_import", {
      p_import_id: importId,
      p_mode: mode,
      p_target_node_id: targetNodeId as string,
      p_excluded_keys: [...excluded],
    }),
  )) as unknown as ImportPreview;

export const commitImport = async (importId: string, mode: ImportMode, targetNodeId: string | null, excluded: ReadonlySet<string>): Promise<ImportResult> =>
  (await call(
    supabase.rpc("commit_layer_import", {
      p_import_id: importId,
      p_mode: mode,
      p_target_node_id: targetNodeId as string,
      p_excluded_keys: [...excluded],
    }),
  )) as unknown as ImportResult;

export const revertImport = (importId: string) => call(supabase.rpc("revert_layer_import", { p_import_id: importId }));

export const discardImport = (importId: string) => call(supabase.rpc("discard_layer_import", { p_import_id: importId }));

/** Puntos del documento que quedan después de las exclusiones (para avisar antes de subir). */
export const includedFeatureCount = (doc: ImportDocument, excluded: ReadonlySet<string>): number =>
  layersOf(doc.root)
    .filter((l) => !isExcluded(l.key, excluded))
    .reduce((n, l) => n + (l.features?.length ?? 0), 0);
