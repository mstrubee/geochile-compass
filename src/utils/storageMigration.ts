import { del, get, keys, set } from "idb-keyval";

/**
 * Migración de claves de almacenamiento del cliente `lovable.*` → `geochile.*`.
 *
 * Hay dos almacenes distintos y cada uno necesita su propia migración:
 *  - localStorage (`lovable.communeOverrides.v1`): síncrona, tiene que correr
 *    ANTES de que `applyStoredOverrides()` lea el valor.
 *  - IndexedDB vía idb-keyval (`lovable.cache.*`, la caché offline de POIs):
 *    asíncrona; `poiCache` espera a `ensureIdbMigrated()` antes de leer o escribir.
 *
 * Reglas comunes:
 *  - Se mueve clave por clave (copiar y recién ahí borrar la vieja), así un
 *    corte a la mitad nunca deja la clave en ningún lado.
 *  - Si la clave nueva ya existe, GANA la nueva (es más reciente que la vieja)
 *    y la vieja se descarta.
 *  - Es idempotente: una marca de versión evita volver a escanear, y solo se
 *    escribe cuando no quedó nada pendiente.
 */

export const LEGACY_PREFIX = "lovable.";
export const NEW_PREFIX = "geochile.";
export const DONE_FLAG = "geochile.migrations.lovable-prefix.v1";

/** Las claves `lovable.cache.*` son caché regenerable: ante falta de cuota se descartan. */
const REGENERABLE_PREFIX = "lovable.cache.";

export interface MigrationReport {
  moved: number;
  /** La clave nueva ya existía: se conservó la nueva y se descartó la vieja. */
  skippedExisting: number;
  /** Caché que no cupo por cuota y se descartó (se vuelve a bajar del servidor). */
  droppedCache: number;
  /** No se pudo mover; queda la clave vieja intacta y se reintenta en la próxima carga. */
  failed: number;
}

const emptyReport = (): MigrationReport => ({
  moved: 0,
  skippedExisting: 0,
  droppedCache: 0,
  failed: 0,
});

const newKeyFor = (legacyKey: string): string =>
  NEW_PREFIX + legacyKey.slice(LEGACY_PREFIX.length);

const isQuotaError = (e: unknown): boolean =>
  e instanceof DOMException &&
  (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");

const logIfChanged = (store: string, r: MigrationReport) => {
  if (r.moved || r.skippedExisting || r.droppedCache || r.failed) {
    console.info(`[storageMigration] ${store}:`, r);
  }
};

// ── localStorage ──────────────────────────────────────────────────────────────

export const migrateLocalStorageKeys = (
  storage: Storage = localStorage,
): MigrationReport => {
  const report = emptyReport();
  try {
    if (storage.getItem(DONE_FLAG) === "1") return report;

    // Foto de las claves antes de mutar: borrar mientras se itera corre los índices.
    const legacyKeys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(LEGACY_PREFIX)) legacyKeys.push(k);
    }

    for (const oldKey of legacyKeys) {
      const newKey = newKeyFor(oldKey);
      try {
        if (storage.getItem(newKey) !== null) {
          storage.removeItem(oldKey);
          report.skippedExisting++;
          continue;
        }
        const value = storage.getItem(oldKey);
        if (value === null) continue;
        storage.setItem(newKey, value);
        storage.removeItem(oldKey);
        report.moved++;
      } catch (e) {
        // Sin cuota para copiar: se deja la vieja intacta y se reintenta luego.
        report.failed++;
        console.warn(`[storageMigration] no se pudo migrar ${oldKey}`, e);
      }
    }

    if (report.failed === 0) storage.setItem(DONE_FLAG, "1");
  } catch (e) {
    // localStorage inaccesible (modo privado, política del navegador): nada que migrar.
    console.warn("[storageMigration] localStorage no disponible", e);
  }
  logIfChanged("localStorage", report);
  return report;
};

// ── IndexedDB (idb-keyval) ────────────────────────────────────────────────────

/** Subconjunto de idb-keyval que usa la migración; permite probarla sin IndexedDB real. */
export interface IdbLike {
  keys: () => Promise<IDBValidKey[]>;
  get: (key: IDBValidKey) => Promise<unknown>;
  set: (key: IDBValidKey, value: unknown) => Promise<void>;
  del: (key: IDBValidKey) => Promise<void>;
}

const defaultIdb: IdbLike = {
  keys: () => keys(),
  get: (k) => get(k),
  set: (k, v) => set(k, v),
  del: (k) => del(k),
};

export const migrateIdbKeys = async (idb: IdbLike = defaultIdb): Promise<MigrationReport> => {
  const report = emptyReport();
  try {
    if ((await idb.get(DONE_FLAG)) === true) return report;

    const legacyKeys = (await idb.keys()).filter(
      (k): k is string => typeof k === "string" && k.startsWith(LEGACY_PREFIX),
    );

    for (const oldKey of legacyKeys) {
      const newKey = newKeyFor(oldKey);
      try {
        if ((await idb.get(newKey)) !== undefined) {
          await idb.del(oldKey);
          report.skippedExisting++;
          continue;
        }
        const value = await idb.get(oldKey);
        if (value === undefined) {
          await idb.del(oldKey);
          continue;
        }
        await idb.set(newKey, value);
        await idb.del(oldKey);
        report.moved++;
      } catch (e) {
        if (isQuotaError(e) && oldKey.startsWith(REGENERABLE_PREFIX)) {
          try {
            await idb.del(oldKey);
            report.droppedCache++;
            continue;
          } catch {
            /* cae al failed de abajo */
          }
        }
        report.failed++;
        console.warn(`[storageMigration] no se pudo migrar ${oldKey}`, e);
      }
    }

    if (report.failed === 0) await idb.set(DONE_FLAG, true);
  } catch (e) {
    console.warn("[storageMigration] IndexedDB no disponible", e);
  }
  logIfChanged("IndexedDB", report);
  return report;
};

let idbMigration: Promise<MigrationReport> | null = null;

/**
 * Corre la migración de IndexedDB una sola vez por carga de página y devuelve
 * la misma promesa a todos los que esperan. Nunca rechaza: si falla, la caché
 * simplemente se trata como vacía.
 */
export const ensureIdbMigrated = (): Promise<MigrationReport> => {
  idbMigration ??= migrateIdbKeys().catch(() => emptyReport());
  return idbMigration;
};
