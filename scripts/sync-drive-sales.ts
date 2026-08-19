/**
 * scripts/sync-drive-sales.ts
 * ───────────────────────────
 * Sincronización del Excel de ventas hacia Supabase, desde Google Drive o
 * desde un archivo local.
 *
 * Corre headless con `vite-node`, que resuelve el alias `@/` igual que la app
 * — así este script usa EXACTAMENTE el mismo parser, matcher y commit que la
 * importación manual, sin lógica duplicada que se pueda desincronizar.
 *
 * Dos formas de usarlo:
 *
 *   a) Archivo local, sin configurar nada:
 *        npm run sync:ventas -- --file ~/ruta/ventas.xlsx [--dry-run]
 *
 *   b) Configurado en la tabla drive_sync_state (una fila por carpeta), que es
 *      lo que usa el workflow diario de GitHub Actions para el modo Drive:
 *        npm run sync:ventas
 *      Cada fila define source_type = 'drive' (drive_file_id) o 'local'
 *      (local_path). OJO: el modo 'local' NO lo puede correr GitHub Actions,
 *      porque la nube no ve archivos de tu computador.
 *
 * Flujo (idéntico para ambas fuentes):
 *   1. Averigua la fecha de modificación del archivo. Si no cambió desde la
 *      última corrida, termina sin hacer nada (caso normal la mayoría de los
 *      días). Con --file explícito se procesa siempre.
 *   2. Lee el archivo, lo parsea y lo matchea contra la memoria de
 *      identidad/alias que ya dejaron las importaciones manuales previas.
 *   3. Respalda en poi_metrics_snapshots todo valor que vaya a sobrescribir,
 *      para que la corrida sea reversible (restore_import_snapshot).
 *   4. Compromete el resultado con commitImport (el mismo de la app).
 *   5. Las filas que no pudo asignar van a poi_import_pending_rows con sus
 *      métricas intactas — NUNCA se descartan en silencio.
 *
 * Variables de entorno:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (requeridas)
 *   GOOGLE_SERVICE_ACCOUNT_JSON               (solo para el modo Drive)
 *   SYNC_FOLDER_ID / --folder <uuid>          (limita a una carpeta)
 *   DRY_RUN=true / --dry-run                  (no escribe nada, solo reporta)
 *   SYNC_LOCAL_FILE / --file <ruta>           (archivo local, ignora la tabla)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseAutoPlanetBuffer } from "@/services/poiImportParser";
import { matchImportRows, DEFAULT_THRESHOLD_METERS } from "@/services/poiImportMatcher";
import { commitImport } from "@/services/poiImportCommit";
import { normalizeAddress } from "@/utils/addressNormalize";
import type { PoiFolderSchema, ImportRow, RowMatchResult } from "@/types/poiMetrics";
import type { SavedPoi } from "@/types/pois";
import { getDriveFileMeta, downloadDriveFile } from "./drive-client";
import { getLocalFileMeta, readLocalFile } from "./local-file-client";

/** Lee `--flag valor` y `--flag=valor` de la línea de comandos. */
const argValue = (flag: string): string | undefined => {
  const args = process.argv.slice(2);
  const exact = args.indexOf(`--${flag}`);
  if (exact !== -1 && args[exact + 1] && !args[exact + 1].startsWith("--")) return args[exact + 1];
  const inline = args.find((a) => a.startsWith(`--${flag}=`));
  return inline ? inline.slice(flag.length + 3) : undefined;
};
const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(`--${flag}`);

const DRY_RUN = process.env.DRY_RUN === "true" || hasFlag("dry-run");
const CLI_FILE = argValue("file") ?? process.env.SYNC_LOCAL_FILE;
const CLI_FOLDER = argValue("folder") ?? process.env.SYNC_FOLDER_ID;

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
};

interface SyncStateRow {
  folder_id: string;
  source_type: "drive" | "local";
  drive_file_id: string | null;
  local_path: string | null;
  enabled: boolean;
  last_modified_time: string | null;
  /** true cuando la corrida viene de --file: se procesa siempre y no se
   * persiste el estado (es una corrida puntual, no la vigilancia agendada). */
  adHoc?: boolean;
}

/** Metadata + lector, resueltos según la fuente. Aísla al resto del script de
 * si el archivo viene de Drive o del disco. */
const openSource = async (
  state: SyncStateRow,
): Promise<{ name: string; modifiedTime: string; read: () => Promise<Uint8Array>; origen: string }> => {
  if (state.source_type === "local") {
    const path = state.local_path!;
    const meta = await getLocalFileMeta(path);
    return {
      name: meta.name,
      modifiedTime: meta.modifiedTime,
      read: () => readLocalFile(path),
      origen: `archivo local ${meta.path}`,
    };
  }
  const fileId = state.drive_file_id!;
  const meta = await getDriveFileMeta(fileId);
  return {
    name: meta.name,
    modifiedTime: meta.modifiedTime,
    read: () => downloadDriveFile(fileId),
    origen: `Drive ${fileId}`,
  };
};

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

/**
 * Respalda los atributos estáticos y los nombres de POI que se van a
 * sobrescribir. La importación no solo escribe métricas: también pisa
 * "Gerente Zonal", "Zona", etc. y el nombre del local con lo que traiga la
 * planilla. Sin este respaldo, un archivo malo dejaba esos campos
 * equivocados sin forma de volver atrás.
 */
const snapshotAttrsBeforeWrite = async (
  admin: SupabaseClient,
  attrs: Array<{ poi_id: string; attr_key: string; attr_value: string | null }>,
  renames: Array<{ poi_id: string; name: string }>,
  jobId: string,
): Promise<void> => {
  const poiIds = [...new Set([...attrs.map((a) => a.poi_id), ...renames.map((r) => r.poi_id)])];

  const existingAttrs = new Map<string, string | null>();
  const existingNames = new Map<string, string>();
  const CHUNK = 40;
  for (let i = 0; i < poiIds.length; i += CHUNK) {
    const slice = poiIds.slice(i, i + CHUNK);
    const [aRes, pRes] = await Promise.all([
      admin.from("poi_attributes").select("poi_id, attr_key, attr_value").in("poi_id", slice),
      admin.from("pois").select("id, name").in("id", slice),
    ]);
    if (aRes.error) throw new Error(`No se pudo leer poi_attributes para respaldo: ${aRes.error.message}`);
    if (pRes.error) throw new Error(`No se pudo leer pois para respaldo: ${pRes.error.message}`);
    for (const r of aRes.data ?? []) existingAttrs.set(`${r.poi_id}|${r.attr_key}`, r.attr_value);
    for (const r of pRes.data ?? []) existingNames.set(r.id, r.name);
  }

  if (attrs.length) {
    const snaps = attrs.map((a) => {
      const key = `${a.poi_id}|${a.attr_key}`;
      const had = existingAttrs.has(key);
      return {
        job_id: jobId,
        poi_id: a.poi_id,
        attr_key: a.attr_key,
        old_value: had ? existingAttrs.get(key)! : null,
        existed_before: had,
      };
    });
    const { error } = await admin
      .from("poi_attributes_snapshots")
      .upsert(snaps, { onConflict: "job_id,poi_id,attr_key" });
    if (error) throw new Error(`No se pudo respaldar los atributos: ${error.message}`);
  }

  // Solo respaldar nombres que realmente cambian.
  const nameSnaps = renames
    .filter((r) => existingNames.has(r.poi_id) && existingNames.get(r.poi_id) !== r.name)
    .map((r) => ({ job_id: jobId, poi_id: r.poi_id, old_name: existingNames.get(r.poi_id)! }));
  if (nameSnaps.length) {
    const { error } = await admin
      .from("poi_name_snapshots")
      .upsert(nameSnaps, { onConflict: "job_id,poi_id" });
    if (error) throw new Error(`No se pudo respaldar los nombres: ${error.message}`);
  }

  console.log(
    `   respaldo: ${attrs.length} atributos, ${nameSnaps.length} nombre(s) que cambian`,
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
  const { folder_id: folderId } = state;
  const source = await openSource(state);
  console.log(`\n=== carpeta ${folderId} · ${source.origen} ===`);
  console.log(`archivo: "${source.name}" · modificado ${source.modifiedTime}`);

  // ── 1) ¿Cambió el archivo? ──────────────────────────────────────────────
  // Una corrida puntual con --file se procesa siempre: el usuario la pidió
  // explícitamente, no tiene sentido saltarla por no haber cambiado.
  if (!state.adHoc && state.last_modified_time && source.modifiedTime === state.last_modified_time) {
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
  const bytes = await source.read();
  console.log(`leído: ${(bytes.byteLength / 1024).toFixed(0)} KB`);
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
    filename: `${state.source_type === "local" ? "Local" : "Drive"}: ${source.name}`,
    rows: parsed.rows,
    matches,
    skippedRowIndices: skipped,
    beforeMetricsWrite: (metrics, jobId) => snapshotBeforeWrite(admin, metrics, jobId),
    beforeAttrsWrite: (attrs, renames, jobId) => snapshotAttrsBeforeWrite(admin, attrs, renames, jobId),
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
  // Solo para la vigilancia configurada. Una corrida puntual con --file no
  // toca el estado: si lo hiciera, la vigilancia agendada creería que ya
  // procesó una versión que quizá no es la que ella vigila.
  if (!state.adHoc) {
    await admin
      .from("drive_sync_state")
      .update({
        last_modified_time: source.modifiedTime,
        last_synced_at: new Date().toISOString(),
        last_job_id: result.jobId,
        last_status: "ok",
        last_error: null,
      })
      .eq("folder_id", folderId);
  }

  console.log(`listo · job ${result.jobId}`);
};

const main = async (): Promise<void> => {
  const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let states: SyncStateRow[];

  if (CLI_FILE) {
    // Corrida puntual con un archivo del computador, sin configurar nada.
    // Necesita saber a qué carpeta va: se usa la indicada, o la única que
    // tenga la importación habilitada.
    let folderId = CLI_FOLDER;
    if (!folderId) {
      const { data, error } = await admin
        .from("poi_folder_schemas")
        .select("folder_id")
        .eq("import_enabled", true);
      if (error) throw new Error(`No se pudo leer los esquemas: ${error.message}`);
      const enabled = (data ?? []) as Array<{ folder_id: string }>;
      if (enabled.length === 0) {
        throw new Error("Ninguna carpeta tiene la importación habilitada. Configúrala en la app (Configurar importación…).");
      }
      if (enabled.length > 1) {
        throw new Error(
          `Hay ${enabled.length} carpetas con importación habilitada; indica cuál con --folder <uuid>: ${enabled.map((e) => e.folder_id).join(", ")}`,
        );
      }
      folderId = enabled[0].folder_id;
      console.log(`carpeta destino (única habilitada): ${folderId}`);
    }
    states = [
      {
        folder_id: folderId,
        source_type: "local",
        drive_file_id: null,
        local_path: CLI_FILE,
        enabled: true,
        last_modified_time: null,
        adHoc: true,
      },
    ];
  } else {
    let q = admin
      .from("drive_sync_state")
      .select("folder_id, source_type, drive_file_id, local_path, enabled, last_modified_time")
      .eq("enabled", true);
    if (CLI_FOLDER) q = q.eq("folder_id", CLI_FOLDER);
    const { data, error } = await q;
    if (error) throw new Error(`No se pudo leer drive_sync_state: ${error.message}`);

    states = (data ?? []) as SyncStateRow[];
    if (!states.length) {
      console.log(
        "No hay sincronización configurada y habilitada.\n" +
          "Para procesar un archivo del computador ahora mismo:\n" +
          "  npm run sync:ventas -- --file /ruta/al/archivo.xlsx --dry-run",
      );
      return;
    }
  }

  console.log(`${states.length} carpeta(s) a revisar${DRY_RUN ? " (DRY_RUN: no se escribe nada)" : ""}`);

  let failures = 0;
  for (const state of states) {
    try {
      await syncFolder(admin, state);
    } catch (e) {
      failures++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`✗ carpeta ${state.folder_id}: ${msg}`);
      // Registrar el error para que se vea desde la app, no solo en los logs.
      // En corridas puntuales no hay fila de estado que actualizar.
      if (!state.adHoc) {
        await admin
          .from("drive_sync_state")
          .update({ last_synced_at: new Date().toISOString(), last_status: "error", last_error: msg })
          .eq("folder_id", state.folder_id);
      }
    }
  }

  if (failures) throw new Error(`${failures} carpeta(s) fallaron`);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
