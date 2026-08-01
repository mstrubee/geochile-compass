/**
 * territorialLayerAdmin.ts
 * ────────────────────────
 * Operaciones de administración sobre capas territoriales (Supabase).
 * Todas requieren rol admin (las RLS lo validan en el servidor).
 */

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { clearTerritorialFeaturesCache } from "@/hooks/useTerritorialLayers";

// ── Helpers ──────────────────────────────────────────────────────────────────

const must = <T>(data: T | null, error: { message: string } | null, ctx: string): T => {
  if (error) throw new Error(`${ctx}: ${error.message}`);
  if (data === null) throw new Error(`${ctx}: sin datos`);
  return data;
};

// ── Reordenado ───────────────────────────────────────────────────────────────

/** Actualiza order_index de las capas de un grupo según el array de IDs recibido. */
export const reorderLayersInGroup = async (orderedIds: string[]): Promise<void> => {
  const updates = orderedIds.map((id, i) =>
    supabase.from("territorial_layers").update({ order_index: i }).eq("id", id),
  );
  await Promise.all(updates);
};

/** Mueve una capa a otro grupo y la pone al final de ese grupo. */
export const moveLayerToGroup = async (
  layerId: string,
  newGroupId: string,
  currentMaxOrder: number,
): Promise<void> => {
  const { error } = await supabase
    .from("territorial_layers")
    .update({ group_id: newGroupId, order_index: currentMaxOrder + 1 })
    .eq("id", layerId);
  if (error) throw new Error(`moveLayerToGroup: ${error.message}`);
};

/** Actualiza order_index de los grupos según el array de IDs recibido. */
export const reorderGroups = async (orderedIds: string[]): Promise<void> => {
  const updates = orderedIds.map((id, i) =>
    supabase.from("territorial_layer_groups").update({ order_index: i }).eq("id", id),
  );
  await Promise.all(updates);
};

// ── Fusión de capas ──────────────────────────────────────────────────────────

/**
 * Fusiona las capas `sourceIds` en la capa `targetId`.
 * Mueve todos los features, actualiza el conteo y elimina las capas fuente.
 */
export const mergeLayers = async (
  sourceIds: string[],
  targetId: string,
): Promise<void> => {
  if (sourceIds.length === 0) return;

  // Mover todos los features de las capas fuente a la capa destino
  for (const srcId of sourceIds) {
    const { error } = await supabase
      .from("territorial_features")
      .update({ layer_id: targetId })
      .eq("layer_id", srcId);
    if (error) throw new Error(`mergeLayers (move features ${srcId}): ${error.message}`);
    clearTerritorialFeaturesCache(srcId);
  }

  // Recalcular feature_count del destino
  const { count, error: cntErr } = await supabase
    .from("territorial_features")
    .select("id", { count: "exact", head: true })
    .eq("layer_id", targetId);
  if (!cntErr) {
    await supabase
      .from("territorial_layers")
      .update({ feature_count: count ?? 0 })
      .eq("id", targetId);
  }

  // Eliminar capas fuente
  const { error: delErr } = await supabase
    .from("territorial_layers")
    .delete()
    .in("id", sourceIds);
  if (delErr) throw new Error(`mergeLayers (delete sources): ${delErr.message}`);

  clearTerritorialFeaturesCache(targetId);
};

// ── Actualizar features desde CSV parseado ───────────────────────────────────

export interface CsvFeatureRow {
  lat: number;
  lng: number;
  name: string;
  properties: Record<string, unknown>;
}

/**
 * Reemplaza todos los features de una capa con las filas parseadas del CSV.
 * Borra primero, luego inserta en lotes de 500 filas.
 */
export const replaceFeaturesFromCsv = async (
  layerId: string,
  rows: CsvFeatureRow[],
): Promise<number> => {
  // 1) Borrar features existentes
  const { error: delErr } = await supabase
    .from("territorial_features")
    .delete()
    .eq("layer_id", layerId);
  if (delErr) throw new Error(`replaceFeaturesFromCsv (delete): ${delErr.message}`);

  // 2) Insertar en lotes
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({
      layer_id: layerId,
      name:     r.name || null,
      lat:      r.lat,
      lng:      r.lng,
      geometry: { type: "Point", coordinates: [r.lng, r.lat] } as Json,
      properties: r.properties as unknown as Json,
    }));
    const { error: insErr } = await supabase
      .from("territorial_features")
      .insert(batch);
    if (insErr) throw new Error(`replaceFeaturesFromCsv (insert batch ${i}): ${insErr.message}`);
    inserted += batch.length;
  }

  // 3) Actualizar feature_count
  await supabase
    .from("territorial_layers")
    .update({ feature_count: inserted })
    .eq("id", layerId);

  clearTerritorialFeaturesCache(layerId);
  return inserted;
};

// ── Estilos (icono + color) ──────────────────────────────────────────────────

export const updateLayerStyle = async (
  layerId: string,
  style: { icon?: string | null; color?: string | null },
): Promise<void> => {
  const { error } = await supabase
    .from("territorial_layers")
    .update(style)
    .eq("id", layerId);
  if (error) throw new Error(`updateLayerStyle: ${error.message}`);
};

export const updateGroupStyle = async (
  groupId: string,
  style: { icon?: string | null; color?: string | null },
): Promise<void> => {
  const { error } = await supabase
    .from("territorial_layer_groups")
    .update(style)
    .eq("id", groupId);
  if (error) throw new Error(`updateGroupStyle: ${error.message}`);
};

// ── Renombrar ────────────────────────────────────────────────────────────────

export const renameLayer = async (layerId: string, name: string): Promise<void> => {
  const { error } = await supabase
    .from("territorial_layers")
    .update({ name })
    .eq("id", layerId);
  if (error) throw new Error(`renameLayer: ${error.message}`);
};

export const renameGroup = async (groupId: string, name: string): Promise<void> => {
  const { error } = await supabase
    .from("territorial_layer_groups")
    .update({ name })
    .eq("id", groupId);
  if (error) throw new Error(`renameGroup: ${error.message}`);
};

// ── Crear / eliminar ─────────────────────────────────────────────────────────

export const createGroup = async (
  name: string,
  color: string,
  icon: string | null,
  orderIndex: number,
): Promise<string> => {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) + `_${Date.now()}`;
  const { data, error } = await supabase
    .from("territorial_layer_groups")
    .insert({ name, slug, color, icon, order_index: orderIndex, visible_default: false })
    .select("id")
    .single();
  must(data, error, "createGroup");
  return (data as { id: string }).id;
};

export const deleteLayer = async (layerId: string): Promise<void> => {
  const { error } = await supabase
    .from("territorial_layers")
    .delete()
    .eq("id", layerId);
  if (error) throw new Error(`deleteLayer: ${error.message}`);
  clearTerritorialFeaturesCache(layerId);
};

export const deleteGroup = async (groupId: string): Promise<void> => {
  // Las capas y features se eliminan por CASCADE
  const { error } = await supabase
    .from("territorial_layer_groups")
    .delete()
    .eq("id", groupId);
  if (error) throw new Error(`deleteGroup: ${error.message}`);
};

// ── Exportación CSV consolidada ────────────────────────────────────────────

interface ExportRow {
  layer_name: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  properties: Record<string, unknown> | null;
}

const EXPORT_PAGE = 1000;

/** Trae TODAS las features de una capa, paginando (sin límite de 1000 de PostgREST). */
const fetchAllFeaturesForLayer = async (
  layerId: string,
  layerName: string,
): Promise<ExportRow[]> => {
  const all: ExportRow[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("territorial_features")
      .select("name,lat,lng,properties")
      .eq("layer_id", layerId)
      .range(from, from + EXPORT_PAGE - 1);
    if (error) throw new Error(`exportGroupFeaturesCsv (${layerName}): ${error.message}`);
    const page = (data ?? []) as Array<{ name: string | null; lat: number | null; lng: number | null; properties: Record<string, unknown> | null }>;
    all.push(...page.map((p) => ({ ...p, layer_name: layerName })));
    if (page.length < EXPORT_PAGE) break;
    from += EXPORT_PAGE;
  }
  return all;
};

/**
 * Exporta TODAS las features de TODAS las capas de un grupo en un solo CSV
 * (columnas: layer_name, name, lat, lng + una columna por cada propiedad
 * distinta que aparezca en cualquier feature). Pagina para no toparse con
 * el límite de 1000 filas por request de PostgREST.
 */
export const exportGroupFeaturesCsv = async (
  layers: Array<{ id: string; name: string }>,
): Promise<{ headers: string[]; rows: Array<Record<string, unknown>> }> => {
  const perLayer = await Promise.all(
    layers.map((l) => fetchAllFeaturesForLayer(l.id, l.name)),
  );
  const flat = perLayer.flat();

  // Unión de todas las claves de properties, para que el CSV tenga columnas
  // consistentes aunque las capas vengan de fuentes distintas.
  const propKeys = new Set<string>();
  for (const r of flat) {
    for (const k of Object.keys(r.properties ?? {})) propKeys.add(k);
  }
  const propHeaders = [...propKeys].sort();
  const headers = ["layer_name", "name", "lat", "lng", ...propHeaders];

  const rows = flat.map((r) => {
    const row: Record<string, unknown> = {
      layer_name: r.layer_name,
      name: r.name ?? "",
      lat: r.lat ?? "",
      lng: r.lng ?? "",
    };
    for (const k of propHeaders) row[k] = (r.properties ?? {})[k] ?? "";
    return row;
  });

  return { headers, rows };
};
