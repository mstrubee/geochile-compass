import { supabase } from "@/integrations/supabase/client";
import type { ImportRow, RowMatchResult } from "@/types/poiMetrics";
import { normalizeAddress } from "@/utils/addressNormalize";

/**
 * Escribe a Supabase los resultados de una importación:
 * 1) Inserta `poi_import_jobs` (head).
 * 2) Por cada fila con poi asignado:
 *    a. Upsert de `poi_metrics` (poi_id, metric_key, period) con `source_import_id`.
 *    b. Upsert de `poi_attributes` (poi_id, attr_key) con valores estáticos.
 *    c. Si la fila era manual (manual_assigned), crea alias en `poi_address_aliases`.
 * 3) Marca el job como completed.
 *
 * Toda esta operación corre en el cliente. Para volúmenes grandes
 * (>500 filas × 88 períodos = 44k upserts), usa batches.
 */

const METRICS_BATCH = 1000;
const ATTRS_BATCH = 500;

interface CommitParams {
  folderId: string;
  filename: string;
  /** Ruta del archivo en el bucket `poi-imports`, si fue subido. */
  sourceFilePath?: string | null;
  rows: ImportRow[];
  matches: RowMatchResult[];
  /** Mapa overrides manuales: rowIndex -> poiId (para filas manual_assigned). */
  manualAssignments?: Record<number, string>;
  /** Filas a omitir del commit. */
  skippedRowIndices?: Set<number>;
  onProgress?: (msg: string, frac: number) => void;
}

export interface CommitResult {
  jobId: string;
  metricsInserted: number;
  attributesUpserted: number;
  aliasesCreated: number;
  rowsCommitted: number;
  rowsSkipped: number;
}

export const commitImport = async ({
  folderId,
  filename,
  sourceFilePath = null,
  rows,
  matches,
  manualAssignments = {},
  skippedRowIndices = new Set(),
  onProgress,
}: CommitParams): Promise<CommitResult> => {
  // -------- Crear el job head --------
  const { data: { user } } = await supabase.auth.getUser();
  const { data: jobRow, error: jobErr } = await supabase
    .from("poi_import_jobs")
    .insert({
      folder_id: folderId,
      filename,
      status: "pending",
      rows_total: rows.length,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (jobErr || !jobRow) throw jobErr ?? new Error("No se pudo crear el import job");
  const jobId = jobRow.id as string;

  onProgress?.("Job creado, escribiendo datos…", 0);

  // -------- Indices auxiliares --------
  const rowByIndex = new Map(rows.map((r) => [r.rowIndex, r]));
  const matchByIndex = new Map(matches.map((m) => [m.rowIndex, m]));

  let metricsInserted = 0;
  let attributesUpserted = 0;
  let aliasesCreated = 0;
  let rowsMatchedAuto = 0;
  let rowsMatchedManual = 0;
  let rowsCommitted = 0;
  let rowsSkipped = 0;
  let periodMin: string | null = null;
  let periodMax: string | null = null;
  const metricKeySet = new Set<string>();

  const metricInserts: Array<{
    poi_id: string;
    metric_key: string;
    period: string;
    value: number;
    source_import_id: string;
  }> = [];
  const attrInserts: Array<{
    poi_id: string;
    attr_key: string;
    attr_value: string | null;
    source_import_id: string;
  }> = [];
  const aliasInserts: Array<{
    poi_id: string;
    normalized_address: string;
    raw_address: string;
  }> = [];
  /** Mapa poi_id -> nombre que viene del Excel (la última fila gana). */
  const poiRenames = new Map<string, string>();

  /** Filas omitidas: persistimos para recordar en futuros imports. */
  const skipMemoryInserts: Array<{
    folder_id: string;
    normalized_key: string;
    raw_address: string | null;
    raw_name: string | null;
  }> = [];

  /** Memoria de identidad: código/nombre → POI, por carpeta. */
  const identityMemoryInserts: Array<{
    folder_id: string;
    key_type: string;
    key_value: string;
    poi_id: string;
  }> = [];

  for (const row of rows) {
    if (skippedRowIndices.has(row.rowIndex)) {
      rowsSkipped++;
      const name = (
        row.identity["Nombre Local"] ??
        row.identity["Local"] ??
        row.identity["Nombre"] ??
        ""
      ).toString().trim();
      const addrNorm = normalizeAddress(row.rawAddress ?? "");
      skipMemoryInserts.push({
        folder_id: folderId,
        normalized_key: `${name.toLowerCase()}::${addrNorm}`,
        raw_address: row.rawAddress || null,
        raw_name: name || null,
      });
      continue;
    }
    const m = matchByIndex.get(row.rowIndex);
    const manualId = manualAssignments[row.rowIndex];
    const poiId = manualId ?? m?.assignedPoiId ?? null;
    if (!poiId) {
      rowsSkipped++;
      continue;
    }

    rowsCommitted++;
    if (manualId) rowsMatchedManual++;
    else rowsMatchedAuto++;

    // Renombrar el POI con el nombre de la planilla (facilita identificar locales en el futuro)
    const excelName = (
      row.identity["Nombre Local"] ??
      row.identity["Local"] ??
      row.identity["Nombre"] ??
      ""
    ).trim();
    if (excelName) poiRenames.set(poiId, excelName);

    // Métricas
    for (const met of row.metrics) {
      metricInserts.push({
        poi_id: poiId,
        metric_key: met.key,
        period: met.period,
        value: met.value,
        source_import_id: jobId,
      });
      metricKeySet.add(met.key);
      if (!periodMin || met.period < periodMin) periodMin = met.period;
      if (!periodMax || met.period > periodMax) periodMax = met.period;
    }

    // Atributos
    for (const [k, v] of Object.entries(row.staticAttrs)) {
      if (v == null || v === "") continue;
      attrInserts.push({
        poi_id: poiId,
        attr_key: k,
        attr_value: v,
        source_import_id: jobId,
      });
    }

    // Alias: guardamos para CUALQUIER fila que terminó asignada (manual, auto o alias)
    // Así, en la próxima importación del mismo archivo, no hace falta volver a geocodificar
    // y filas que "ya habían sido asignadas" no aparecen como "Sin geo" si Nominatim falla.
    if (row.rawAddress) {
      aliasInserts.push({
        poi_id: poiId,
        normalized_address: normalizeAddress(row.rawAddress),
        raw_address: row.rawAddress,
      });
    }

    // Memoria de identidad por carpeta (para reconocimiento futuro).
    const centroSap = (row.identity["Centro Sap"] ?? "").toString().trim();
    const localCode = (row.identity["Local"] ?? "").toString().trim();
    const nameNorm = (
      row.identity["Nombre Local"] ??
      row.identity["Local"] ??
      row.identity["Nombre"] ??
      ""
    )
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    if (centroSap) {
      identityMemoryInserts.push({
        folder_id: folderId,
        key_type: "centro_sap",
        key_value: centroSap.toLowerCase(),
        poi_id: poiId,
      });
    }
    if (localCode) {
      identityMemoryInserts.push({
        folder_id: folderId,
        key_type: "local",
        key_value: localCode.toLowerCase(),
        poi_id: poiId,
      });
    }
    if (nameNorm) {
      identityMemoryInserts.push({
        folder_id: folderId,
        key_type: "name_norm",
        key_value: nameNorm,
        poi_id: poiId,
      });
    }
  }

  // -------- Deduplicar para evitar "ON CONFLICT cannot affect row a second time" --------
  // Métricas: una sola fila por (poi_id, metric_key, period). La última gana.
  const metricsMap = new Map<string, typeof metricInserts[number]>();
  for (const m of metricInserts) {
    metricsMap.set(`${m.poi_id}|${m.metric_key}|${m.period}`, m);
  }
  const dedupMetrics = [...metricsMap.values()];

  // Atributos: una sola fila por (poi_id, attr_key). La última gana.
  const attrsMap = new Map<string, typeof attrInserts[number]>();
  for (const a of attrInserts) {
    attrsMap.set(`${a.poi_id}|${a.attr_key}`, a);
  }
  const dedupAttrs = [...attrsMap.values()];

  // Aliases: una sola fila por (poi_id, normalized_address).
  const aliasMap = new Map<string, typeof aliasInserts[number]>();
  for (const a of aliasInserts) {
    aliasMap.set(`${a.poi_id}|${a.normalized_address}`, a);
  }
  const dedupAliases = [...aliasMap.values()];

  // -------- Batch upserts --------
  for (let i = 0; i < dedupMetrics.length; i += METRICS_BATCH) {
    const batch = dedupMetrics.slice(i, i + METRICS_BATCH);
    const { error } = await supabase
      .from("poi_metrics")
      .upsert(batch, { onConflict: "poi_id,metric_key,period" });
    if (error) throw error;
    metricsInserted += batch.length;
    onProgress?.(
      `Métricas ${metricsInserted}/${dedupMetrics.length}`,
      0.1 + 0.6 * (metricsInserted / Math.max(1, dedupMetrics.length)),
    );
  }

  for (let i = 0; i < dedupAttrs.length; i += ATTRS_BATCH) {
    const batch = dedupAttrs.slice(i, i + ATTRS_BATCH);
    const { error } = await supabase
      .from("poi_attributes")
      .upsert(batch, { onConflict: "poi_id,attr_key" });
    if (error) throw error;
    attributesUpserted += batch.length;
    onProgress?.(
      `Atributos ${attributesUpserted}/${dedupAttrs.length}`,
      0.7 + 0.15 * (attributesUpserted / Math.max(1, dedupAttrs.length)),
    );
  }

  if (dedupAliases.length > 0) {
    const { error } = await supabase
      .from("poi_address_aliases")
      .upsert(dedupAliases, { onConflict: "poi_id,normalized_address" });
    if (error) throw error;
    aliasesCreated = dedupAliases.length;
  }

  // -------- Renombrar POIs asignados con el nombre del Excel --------
  if (poiRenames.size > 0) {
    onProgress?.(`Actualizando nombres de ${poiRenames.size} POIs…`, 0.92);
    const renameEntries = [...poiRenames.entries()];
    // Una update por POI (N suele ser pequeño: ~filas comprometidas).
    await Promise.all(
      renameEntries.map(([poi_id, name]) =>
        supabase.from("pois").update({ name }).eq("id", poi_id),
      ),
    );
  }

  // -------- Persistir memoria de omisiones (folder_id, normalized_key) --------
  if (skipMemoryInserts.length > 0) {
    const skipMap = new Map<string, typeof skipMemoryInserts[number]>();
    for (const s of skipMemoryInserts) {
      skipMap.set(`${s.folder_id}|${s.normalized_key}`, s);
    }
    const dedupSkip = [...skipMap.values()].filter((s) => s.normalized_key !== "::");
    if (dedupSkip.length > 0) {
      const { error: skipErr } = await supabase
        .from("poi_import_skip_memory")
        .upsert(dedupSkip, { onConflict: "folder_id,normalized_key" });
      if (skipErr) console.warn("[skip memory] upsert failed", skipErr);
    }
  }

  // -------- Persistir memoria de identidad (folder_id, key_type, key_value) --------
  if (identityMemoryInserts.length > 0) {
    const idMap = new Map<string, typeof identityMemoryInserts[number]>();
    for (const e of identityMemoryInserts) {
      idMap.set(`${e.folder_id}|${e.key_type}|${e.key_value}`, e);
    }
    const dedupIdentity = [...idMap.values()];
    if (dedupIdentity.length > 0) {
      const { error: idErr } = await supabase
        .from("poi_import_identity_memory")
        .upsert(dedupIdentity, { onConflict: "folder_id,key_type,key_value" });
      if (idErr) console.warn("[identity memory] upsert failed", idErr);
    }
  }

  onProgress?.("Finalizando…", 0.95);

  // -------- Cerrar el job --------
  const { error: updErr } = await supabase
    .from("poi_import_jobs")
    .update({
      status: "completed",
      rows_matched_auto: rowsMatchedAuto,
      rows_matched_manual: rowsMatchedManual,
      rows_unmatched: rowsSkipped,
      metric_keys: Array.from(metricKeySet),
      period_min: periodMin,
      period_max: periodMax,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (updErr) throw updErr;

  onProgress?.("Listo", 1);

  return {
    jobId,
    metricsInserted,
    attributesUpserted,
    aliasesCreated,
    rowsCommitted,
    rowsSkipped,
  };
};
