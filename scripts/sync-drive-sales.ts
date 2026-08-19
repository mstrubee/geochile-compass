/**
 * scripts/sync-drive-sales.ts
 * ───────────────────────────
 * Sincronización automática del Excel de ventas desde Google Drive.
 *
 * Corre headless (GitHub Actions, a diario) con `vite-node`, que resuelve el
 * alias `@/` igual que la app — así este script usa EXACTAMENTE el mismo
 * parser, matcher y commit que la importación manual, sin lógica duplicada
 * que se pueda desincronizar.
 *
 * Flujo:
 *   1. Lee drive_sync_state para saber qué archivo vigilar y cuál fue la
 *      última versión procesada.
 *   2. Pregunta a Drive el modifiedTime del archivo. Si no cambió, termina
 *      sin hacer nada (esto es el caso normal la mayoría de los días).
 *   3. Descarga el archivo, lo parsea y lo matchea contra la memoria de
 *      identidad/alias que ya dejaron las importaciones manuales previas.
 *   4. Respalda en poi_metrics_snapshots todo valor que vaya a sobrescribir,
 *      para que la corrida sea reversible (restore_import_snapshot).
 *   5. Comprometeel resultado con commitImport (el mismo de la app).
 *   6. Las filas que no pudo asignar van a poi_import_pending_rows con sus
 *      métricas intactas — NUNCA se descartan en silencio.
 *
 * Variables de entorno requeridas:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   GOOGLE_SERVICE_ACCOUNT_JSON  (el JSON completo de la cuenta de servicio)
 *   SYNC_FOLDER_ID               (opcional: limita a una carpeta)
 *   DRY_RUN=true                 (opcional: no escribe nada, solo reporta)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseAutoPlanetBuffer } from "@/services/poiImportParser";
import { matchImportRows, DEFAULT_THRESHOLD_METERS } from "@/services/poiImportMatcher";
import { commitImport } from "@/services/poiImportCommit";
import { normalizeAddress } from "@/utils/addressNormalize";
import type { PoiFolderSchema, ImportRow, RowMatchResult } from "@/types/poiMetrics";
import type { SavedPoi } from "@/types/pois";
import { getDriveFileMeta, downloadDriveFile } from "./drive-client";

const DRY_RUN = process.env.DRY_RUN === "true";

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
};

interface SyncStateRow {
  folder_id: string;
  drive_file_id: string;
  enabled: boolean;
  last_modified_time: string | null;
}

/** Respalda los valores actuales de las métricas que se van a escribir. */
const snapshotBeforeWrite = async (
  admin: SupabaseClient,
  metrics: Array<{ poi_id: string; metric_key: string; period: string; value: number }>,
  jobId: string,
): Promise<void> => {
  // Traer los valores actuales de solo las métricas afectadas.
  const poiIds = [...new Set(metrics.map((m) => m.poi_id))];
  const existing = new Map<string, number>();
  const CHUNK = 40;
  for (let i = 0; i < poiIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("poi_metrics")
      .select("poi_id, metric_key, period, value")
      .in("poi_id", poiIds.slice(i, i + CHUNK));
    if (error) throw new Error(`No se pudo leer poi_metrics para respaldo: ${error.message}`);
    for (const r of data ?? []) {
      existing.set(`${r.poi_id}|${r.metric_key}|${r.period}`, Number(r.value));
    }
  }

  const snapshots = metrics.map((m) => {
    const key = `${m.poi_id}|${m.metric_key}|${m.period}`;
    const had = existing.has(key);
    return {
      job_id: jobId,
      poi_id: m.poi_id,
      metric_key: m.metric_key,
      period: m.period,
      old_value: had ? existing.get(key)! : null,
      existed_before: had,
    };
  });

  const SNAP_BATCH = 500;
  for (let i = 0; i < snapshots.length; i += SNAP_BATCH) {
    const { error } = await admin
      .from("poi_metrics_snapshots")
      .upsert(snapshots.slice(i, i + SNAP_BATCH), { onConflict: "job_id,poi_id,metric_key,period" });
    if (error) throw new Error(`No se pudo escribir el respaldo: ${error.message}`);
  }

  const overwritten = snapshots.filter((s) => s.existed_before).length;
  console.log(
    `   respaldo: ${snapshots.length} métricas (${overwritten} sobrescriben un valor previo, ${snapshots.length - overwritten} son nuevas)`,
  );
};

/** Guarda las filas sin asignar para revisión humana, con sus métricas intactas. */
const savePendingRows = async (
  admin: SupabaseClient,
  jobId: string,
  folderId: string,
  rows: ImportRow[],
  matches: RowMatchResult[],
  skipped: Set<number>,
): Promise<number> => {
  const matchByIndex = new Map(matches.map((m) => [m.rowIndex, m]));
  const pending = rows
    .filter((r) => !skipped.has(r.rowIndex) && !matchByIndex.get(r.rowIndex)?.assignedPoiId)
    .map((r) => ({
      job_id: jobId,
      folder_id: folderId,
      row_index: r.rowIndex,
      raw_name: (r.identity["Nombre Local"] ?? r.identity["Local"] ?? r.identity["Nombre"] ?? null) as string | null,
      raw_address: r.rawAddress || null,
      comuna: r.comuna || null,
      identity: r.identity,
      metrics: r.metrics,
      static_attrs: r.staticAttrs,
      reason: matchByIndex.get(r.rowIndex)?.status ?? "sin_coincidencia",
    }));

  if (!pending.length) return 0;
  const { error } = await admin.from("poi_import_pending_rows").insert(pending);
  if (error) throw new Error(`No se pudieron guardar las filas pendientes: ${error.message}`);
  return pending.length;
};

const syncFolder = async (admin: SupabaseClient, state: SyncStateRow): Promise<void> => {
  const { folder_id: folderId, drive_file_id: fileId } = state;
  console.log(`\n=== carpeta ${folderId} · archivo de Drive ${fileId} ===`);

  // ── 1) ¿Cambió el archivo? ──────────────────────────────────────────────
  const meta = await getDriveFileMeta(fileId);
  console.log(`archivo: "${meta.name}" · modificado ${meta.modifiedTime}`);
  if (state.last_modified_time && meta.modifiedTime === state.last_modified_time) {
    console.log("sin cambios desde la última corrida — no hay nada que hacer");
    await admin
      .from("drive_sync_state")
      .update({ last_synced_at: new Date().toISOString(), last_status: "skipped", last_error: null })
      .eq("folder_id", folderId);
    return;
  }

  // ── 2) Esquema de la carpeta ────────────────────────────────────────────
  const { data: schemaRow, error: schemaErr } = await admin
    .from("poi_folder_schemas")
    .select("*")
    .eq("folder_id", folderId)
    .maybeSingle();
  if (schemaErr) throw new Error(`No se pudo leer el esquema: ${schemaErr.message}`);
  if (!schemaRow) throw new Error(`La carpeta ${folderId} no tiene esquema de importación configurado`);
  if (!schemaRow.import_enabled) throw new Error(`La importación está deshabilitada para la carpeta ${folderId}`);
  const schema = schemaRow as unknown as PoiFolderSchema;

  // ── 3) Descargar y parsear ──────────────────────────────────────────────
  const bytes = await downloadDriveFile(fileId);
  console.log(`descargado: ${(bytes.byteLength / 1024).toFixed(0)} KB`);
  const parsed = parseAutoPlanetBuffer(bytes, schema);
  console.log(`parseado: ${parsed.rows.length} filas`);

  // ── 4) Datos para el matching (misma fuente que la app) ─────────────────
  const { data: poisData, error: poisErr } = await admin
    .from("pois")
    .select("*")
    .eq("folder_id", folderId)
    .is("deleted_at", null);
  if (poisErr) throw new Error(`No se pudieron leer los POIs: ${poisErr.message}`);
  const pois = (poisData ?? []) as unknown as SavedPoi[];
  const poiIds = pois.map((p) => p.id);

  const [aliasRes, attrsRes, identityRes, skipRes] = await Promise.all([
    poiIds.length ? admin.from("poi_address_aliases").select("*").in("poi_id", poiIds) : { data: [], error: null },
    poiIds.length ? admin.from("poi_attributes").select("*").in("poi_id", poiIds) : { data: [], error: null },
    admin.from("poi_import_identity_memory").select("key_type,key_value,poi_id").eq("folder_id", folderId),
    admin.from("poi_import_skip_memory").select("normalized_key").eq("folder_id", folderId),
  ]);

  const aliases = (aliasRes.data ?? []) as Array<{ poi_id: string; normalized_address: string; raw_address: string }>;
  console.log(
    `memoria: ${pois.length} locales, ${aliases.length} alias, ${(identityRes.data ?? []).length} claves de identidad`,
  );

  // ── 5) Matching ─────────────────────────────────────────────────────────
  const matches = await matchImportRows({
    rows: parsed.rows,
    pois,
    aliases,
    poiAttributes: (attrsRes.data ?? []) as never,
    identityMemory: (identityRes.data ?? []) as never,
    thresholdMeters: DEFAULT_THRESHOLD_METERS,
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`   matching ${done}/${total}`);
    },
  });

  // Respetar la memoria de omisiones, igual que la app.
  const skipKeys = new Set((skipRes.data ?? []).map((r: { normalized_key: string }) => r.normalized_key));
  const skipped = new Set<number>();
  for (const row of parsed.rows) {
    const name = (row.identity["Nombre Local"] ?? row.identity["Local"] ?? row.identity["Nombre"] ?? "")
      .toString()
      .trim()
      .toLowerCase();
    if (skipKeys.has(`${name}::${normalizeAddress(row.rawAddress ?? "")}`)) skipped.add(row.rowIndex);
  }

  const assigned = matches.filter((m) => m.assignedPoiId).length;
  const unassigned = parsed.rows.length - assigned - skipped.size;
  console.log(`asignadas: ${assigned} · omitidas por memoria: ${skipped.size} · sin asignar: ${unassigned}`);

  if (DRY_RUN) {
    console.log("DRY_RUN: no se escribe nada");
    return;
  }

  // ── 6) Commit (mismo código que la app) + respaldo previo ───────────────
  const result = await commitImport({
    client: admin,
    folderId,
    filename: `Drive: ${meta.name}`,
    rows: parsed.rows,
    matches,
    skippedRowIndices: skipped,
    beforeMetricsWrite: (metrics, jobId) => snapshotBeforeWrite(admin, metrics, jobId),
    onProgress: (msg, frac) => console.log(`   ${msg} (${Math.round(frac * 100)}%)`),
  });
  console.log(
    `commit: ${result.metricsInserted} métricas, ${result.attributesUpserted} atributos, ${result.rowsCommitted} filas`,
  );

  // ── 7) Filas sin asignar → cola de revisión ─────────────────────────────
  const pendingCount = await savePendingRows(
    admin,
    result.jobId,
    folderId,
    parsed.rows,
    matches,
    skipped,
  );
  if (pendingCount) console.log(`⚠ ${pendingCount} filas quedaron para revisión manual (poi_import_pending_rows)`);

  // ── 8) Marcar esta versión como procesada ───────────────────────────────
  await admin
    .from("drive_sync_state")
    .update({
      last_modified_time: meta.modifiedTime,
      last_synced_at: new Date().toISOString(),
      last_job_id: result.jobId,
      last_status: "ok",
      last_error: null,
    })
    .eq("folder_id", folderId);

  console.log(`listo · job ${result.jobId}`);
};

const main = async (): Promise<void> => {
  const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let q = admin.from("drive_sync_state").select("folder_id, drive_file_id, enabled, last_modified_time").eq("enabled", true);
  if (process.env.SYNC_FOLDER_ID) q = q.eq("folder_id", process.env.SYNC_FOLDER_ID);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudo leer drive_sync_state: ${error.message}`);

  const states = (data ?? []) as SyncStateRow[];
  if (!states.length) {
    console.log("No hay carpetas con sincronización de Drive configurada y habilitada. Nada que hacer.");
    return;
  }
  console.log(`${states.length} carpeta(s) a revisar${DRY_RUN ? " (DRY_RUN)" : ""}`);

  let failures = 0;
  for (const state of states) {
    try {
      await syncFolder(admin, state);
    } catch (e) {
      failures++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`✗ carpeta ${state.folder_id}: ${msg}`);
      // Registrar el error para que se vea desde la app, no solo en los logs.
      await admin
        .from("drive_sync_state")
        .update({ last_synced_at: new Date().toISOString(), last_status: "error", last_error: msg })
        .eq("folder_id", state.folder_id);
    }
  }

  if (failures) throw new Error(`${failures} carpeta(s) fallaron`);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
