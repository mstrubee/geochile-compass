/**
 * Caché offline cache-first de POIs y carpetas en IndexedDB (idb-keyval).
 *
 * Estrategia:
 * - Al iniciar, leemos el snapshot local y lo usamos como fuente de verdad.
 * - En background hacemos un sync incremental contra Supabase usando
 *   `updated_at` (ver useSavedPois.syncDelta). Solo bajamos las filas que
 *   cambiaron desde la última sincronización exitosa.
 * - Después de cada sync verificamos integridad (count + checksum) contra el
 *   servidor; si difieren, fallback automático a fullRefresh.
 * - Las mutaciones locales escriben el caché inmediatamente para que un
 *   reload posterior tenga el dato sin esperar a Supabase.
 */
import { get, set } from "idb-keyval";
import type { PoiFolder, SavedPoi } from "@/types/pois";

const POIS_KEY = (uid: string) => `lovable.cache.pois.${uid}`;
const TRASH_KEY = (uid: string) => `lovable.cache.trashed.${uid}`;
const SYNC_KEY = (uid: string) => `lovable.cache.pois.lastSyncAt.${uid}`;
const FOLDERS_KEY = (uid: string) => `lovable.cache.folders.${uid}`;

export interface PoiCacheSnapshot {
  pois: SavedPoi[];
  trashedPois: SavedPoi[];
  cachedAt: number;
  lastSyncAt: string | null;
}

export interface FoldersCacheSnapshot {
  folders: PoiFolder[];
  cachedAt: number;
}

export const loadPoiCache = async (
  userId: string,
): Promise<PoiCacheSnapshot | null> => {
  try {
    const [pois, trashed, lastSyncAt] = await Promise.all([
      get<{ rows: SavedPoi[]; at: number }>(POIS_KEY(userId)),
      get<{ rows: SavedPoi[]; at: number }>(TRASH_KEY(userId)),
      get<string>(SYNC_KEY(userId)),
    ]);
    if (!pois) return null;
    return {
      pois: pois.rows ?? [],
      trashedPois: trashed?.rows ?? [],
      cachedAt: pois.at ?? 0,
      lastSyncAt: lastSyncAt ?? null,
    };
  } catch (err) {
    console.warn("[poiCache] no se pudo leer caché", err);
    return null;
  }
};

export const savePoiCache = async (
  userId: string,
  pois: SavedPoi[],
  trashedPois: SavedPoi[],
  lastSyncAt?: string | null,
): Promise<void> => {
  try {
    const at = Date.now();
    const writes: Promise<unknown>[] = [
      set(POIS_KEY(userId), { rows: pois, at }),
      set(TRASH_KEY(userId), { rows: trashedPois, at }),
    ];
    if (lastSyncAt !== undefined) {
      writes.push(set(SYNC_KEY(userId), lastSyncAt));
    }
    await Promise.all(writes);
  } catch (err) {
    console.warn("[poiCache] no se pudo escribir caché", err);
  }
};

export const setLastSyncAt = async (
  userId: string,
  iso: string | null,
): Promise<void> => {
  try {
    await set(SYNC_KEY(userId), iso);
  } catch (err) {
    console.warn("[poiCache] no se pudo escribir lastSyncAt", err);
  }
};

/** Devuelve el max(updated_at, created_at, deleted_at) de una fila como ISO. */
export const rowSyncStamp = (row: SavedPoi): string => {
  const candidates = [row.updated_at, row.deleted_at, row.created_at].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (!candidates.length) return new Date(0).toISOString();
  return candidates.reduce((a, b) => (a > b ? a : b));
};

export const loadFoldersCache = async (
  userId: string,
): Promise<FoldersCacheSnapshot | null> => {
  try {
    const data = await get<{ rows: PoiFolder[]; at: number }>(
      FOLDERS_KEY(userId),
    );
    if (!data) return null;
    return { folders: data.rows ?? [], cachedAt: data.at ?? 0 };
  } catch (err) {
    console.warn("[poiCache] no se pudo leer caché de carpetas", err);
    return null;
  }
};

export const saveFoldersCache = async (
  userId: string,
  folders: PoiFolder[],
): Promise<void> => {
  try {
    await set(FOLDERS_KEY(userId), { rows: folders, at: Date.now() });
  } catch (err) {
    console.warn("[poiCache] no se pudo escribir caché de carpetas", err);
  }
};
