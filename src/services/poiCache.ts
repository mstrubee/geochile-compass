/**
 * Caché offline de POIs y carpetas en IndexedDB (vía idb-keyval).
 *
 * Estrategia: cuando el usuario abre la app, leemos el snapshot local
 * inmediatamente para que los POIs aparezcan al instante (incluso sin red).
 * En paralelo, lanzamos la consulta normal a Supabase y, cuando llega,
 * sobrescribimos el caché. Esto evita la sensación de "tengo que recargar
 * los POIs cada vez" cuando la red está lenta o caída.
 *
 * Es solo lectura offline — las mutaciones (insert/update/delete) siguen
 * yendo directo a la BD y requieren conexión.
 */
import { get, set } from "idb-keyval";
import type { PoiFolder, SavedPoi } from "@/types/pois";

const POIS_KEY = (uid: string) => `lovable.cache.pois.${uid}`;
const TRASH_KEY = (uid: string) => `lovable.cache.trashed.${uid}`;
const FOLDERS_KEY = (uid: string) => `lovable.cache.folders.${uid}`;

export interface PoiCacheSnapshot {
  pois: SavedPoi[];
  trashedPois: SavedPoi[];
  cachedAt: number;
}

export interface FoldersCacheSnapshot {
  folders: PoiFolder[];
  cachedAt: number;
}

export const loadPoiCache = async (
  userId: string,
): Promise<PoiCacheSnapshot | null> => {
  try {
    const [pois, trashed] = await Promise.all([
      get<{ rows: SavedPoi[]; at: number }>(POIS_KEY(userId)),
      get<{ rows: SavedPoi[]; at: number }>(TRASH_KEY(userId)),
    ]);
    if (!pois) return null;
    return {
      pois: pois.rows ?? [],
      trashedPois: trashed?.rows ?? [],
      cachedAt: pois.at ?? 0,
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
): Promise<void> => {
  try {
    const at = Date.now();
    await Promise.all([
      set(POIS_KEY(userId), { rows: pois, at }),
      set(TRASH_KEY(userId), { rows: trashedPois, at }),
    ]);
  } catch (err) {
    console.warn("[poiCache] no se pudo escribir caché", err);
  }
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
