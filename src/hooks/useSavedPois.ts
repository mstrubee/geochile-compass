import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import {
  loadPoiCache,
  rowSyncStamp,
  savePoiCache,
  setLastSyncAt as persistLastSyncAt,
} from "@/services/poiCache";
import type { PoiInsert, PoiUpdate, SavedPoi } from "@/types/pois";

// Columnas ligeras para pintar el mapa rápido (sin `properties` ni
// `description` que pueden ser blobs gigantes con KMZ con logos embebidos).
const LIGHT_COLS =
  "id,name,category,color,icon,lat,lng,source_layer,folder_id,created_at,updated_at,deleted_at";

const PAGE = 250;
// TTL del caché: si el snapshot es más viejo que esto, hacemos refresh full.
const CACHE_FULL_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

type LightRow = Record<string, unknown>;
const toSavedPoi = (row: LightRow): SavedPoi =>
  ({
    ...(row as object),
    description: null,
    properties: {},
  }) as SavedPoi;

export const useSavedPois = () => {
  const { user } = useAuth();
  const [pois, setPois] = useState<SavedPoi[]>([]);
  const [trashedPois, setTrashedPois] = useState<SavedPoi[]>([]);
  const [loading, setLoading] = useState(false);

  // Snapshot interno del último lastSyncAt confirmado para este user.
  const lastSyncAtRef = useRef<string | null>(null);

  /** Persiste el state actual + lastSyncAt al caché local. */
  const persistCache = useCallback(
    (nextPois: SavedPoi[], nextTrashed: SavedPoi[], syncAt?: string | null) => {
      if (!user) return;
      void savePoiCache(user.id, nextPois, nextTrashed, syncAt);
      if (syncAt !== undefined) lastSyncAtRef.current = syncAt;
    },
    [user],
  );

  /** Avanza lastSyncAt al máximo entre el actual y los timestamps de las filas dadas. */
  const advanceSyncStamp = useCallback(
    (rows: Array<Pick<SavedPoi, "updated_at" | "created_at" | "deleted_at">>) => {
      if (!user || !rows.length) return lastSyncAtRef.current;
      let maxStamp = lastSyncAtRef.current ?? new Date(0).toISOString();
      for (const r of rows) {
        const s = rowSyncStamp(r as SavedPoi);
        if (s > maxStamp) maxStamp = s;
      }
      if (maxStamp !== lastSyncAtRef.current) {
        lastSyncAtRef.current = maxStamp;
        void persistLastSyncAt(user.id, maxStamp);
      }
      return maxStamp;
    },
    [user],
  );

  // ===== Refresh full (paginado, fallback / primera vez / botón manual) =====
  const fullRefresh = useCallback(async (): Promise<void> => {
    if (!user) {
      setPois([]);
      setTrashedPois([]);
      return;
    }
    setLoading(true);

    const fetchAllLight = async (deleted: boolean): Promise<SavedPoi[]> => {
      const all: SavedPoi[] = [];
      const seen = new Set<string>();
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let lastError: unknown = null;
        let data: SavedPoi[] | null = null;
        for (let attempt = 0; attempt < 3 && data === null; attempt++) {
          let q = supabase
            .from("pois")
            .select(LIGHT_COLS)
            .order(deleted ? "deleted_at" : "created_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, from + PAGE - 1);
          q = deleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
          const res = await q;
          if (res.error) {
            lastError = res.error;
            await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
            continue;
          }
          data = (res.data ?? []).map((row) => toSavedPoi(row as LightRow));
        }
        if (data === null) {
          console.error("[useSavedPois] light fetch failed (after retries)", lastError);
          throw new Error(
            lastError instanceof Error ? lastError.message : "No se pudieron cargar los POIs",
          );
        }
        for (const row of data) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            all.push(row);
          }
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };

    try {
      const [activeRes, trashedRes] = await Promise.allSettled([
        fetchAllLight(false),
        fetchAllLight(true),
      ]);
      const activeOk = activeRes.status === "fulfilled";
      const trashedOk = trashedRes.status === "fulfilled";
      const active = activeOk ? activeRes.value : null;
      const trashed = trashedOk ? trashedRes.value : [];

      if (activeOk && active) {
        setPois(active);
        setTrashedPois(trashed);
        // Avanza lastSyncAt al máximo de todo lo cargado.
        const all = [...active, ...trashed];
        const stamp = all.reduce(
          (m, r) => {
            const s = rowSyncStamp(r);
            return s > m ? s : m;
          },
          new Date(0).toISOString(),
        );
        lastSyncAtRef.current = stamp;
        persistCache(active, trashed, stamp);

        // Enriquecimiento heavy en background: solo lo que no tiene properties cargado.
        void enrichInBackground(active, "active", setPois, persistCache);
        if (trashedOk) void enrichInBackground(trashed, "trashed", setTrashedPois, persistCache);
      } else {
        console.error(
          "[useSavedPois.fullRefresh] active fetch failed, keeping cached state",
          activeRes.status === "rejected" ? activeRes.reason : null,
        );
      }
    } catch (err) {
      console.error("[useSavedPois.fullRefresh] error", err);
    } finally {
      setLoading(false);
    }
  }, [user, persistCache]);

  // ===== Sync delta (rápido: 1 query con updated_at > lastSyncAt) =====
  const syncDelta = useCallback(async (): Promise<void> => {
    if (!user) return;
    const since = lastSyncAtRef.current;
    if (!since) {
      // Sin baseline → caemos al fullRefresh.
      await fullRefresh();
      return;
    }
    try {
      // Trae filas cambiadas (incluye soft-deletes y restores) desde la última sync.
      // Sin filtro de deleted_at: queremos también las eliminadas para mover a trash.
      const { data, error } = await supabase
        .from("pois")
        .select(LIGHT_COLS)
        .gt("updated_at", since)
        .order("updated_at", { ascending: true })
        .limit(5000);
      if (error) {
        console.warn("[useSavedPois.syncDelta] error, ignoring", error.message);
        return;
      }
      const changed = (data ?? []).map((r) => toSavedPoi(r as LightRow));
      if (!changed.length) return;

      // Merge en active / trash.
      const activeIncoming = changed.filter((r) => !r.deleted_at);
      const trashedIncoming = changed.filter((r) => !!r.deleted_at);
      const incomingIds = new Set(changed.map((r) => r.id));

      setPois((prev) => {
        const kept = prev.filter((p) => !incomingIds.has(p.id));
        return [...activeIncoming, ...kept];
      });
      setTrashedPois((prev) => {
        const kept = prev.filter((p) => !incomingIds.has(p.id));
        return [...trashedIncoming, ...kept];
      });
      advanceSyncStamp(changed);

      // Persistencia diferida: leemos el último state vía setters para snapshot consistente.
      setPois((curr) => {
        setTrashedPois((trashCurr) => {
          persistCache(curr, trashCurr, lastSyncAtRef.current);
          return trashCurr;
        });
        return curr;
      });

      // Enriquecimiento heavy solo para las activas que llegaron en el delta.
      if (activeIncoming.length) {
        void enrichInBackground(activeIncoming, "active", setPois, persistCache);
      }
      if (trashedIncoming.length) {
        void enrichInBackground(trashedIncoming, "trashed", setTrashedPois, persistCache);
      }
    } catch (err) {
      console.warn("[useSavedPois.syncDelta] threw, ignoring", err);
    }
  }, [user, fullRefresh, persistCache, advanceSyncStamp]);

  // ===== Bootstrap: hidratar desde caché + decidir delta vs full =====
  useEffect(() => {
    if (!user) {
      setPois([]);
      setTrashedPois([]);
      lastSyncAtRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await loadPoiCache(user.id);
      if (cancelled) return;
      if (cached) {
        setPois(cached.pois);
        setTrashedPois(cached.trashedPois);
        lastSyncAtRef.current = cached.lastSyncAt;
        const stale = Date.now() - cached.cachedAt > CACHE_FULL_REFRESH_TTL_MS;
        // Si tenemos baseline y caché fresco → solo delta (rápido).
        if (cached.lastSyncAt && !stale) {
          void syncDelta();
        } else {
          // Sin baseline o caché vencido → refresh completo en background.
          void fullRefresh();
        }
      } else {
        // Sin caché → primera vez: refresh completo bloqueante.
        await fullRefresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, syncDelta, fullRefresh]);

  // Public refresh = sync delta (no bloqueante, normal). Para forzar el full
  // se usa forceFullRefresh.
  const refresh = useCallback(async () => {
    await syncDelta();
  }, [syncDelta]);

  const forceFullRefresh = useCallback(async () => {
    await fullRefresh();
  }, [fullRefresh]);

  // Debounce para encadenar mutaciones sin disparar varios delta.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void syncDelta();
    }, 300);
  }, [syncDelta]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  // ===== Mutaciones (optimistas + persistencia inmediata al caché) =====

  const addMany = useCallback(
    async (
      items: PoiInsert[],
      folder_id: string | null = null,
      _opts?: { deferRefresh?: boolean },
    ) => {
      if (!user) throw new Error("Debes iniciar sesión");
      if (!items.length) return 0;

      const sanitize = (p: PoiInsert) => {
        const props = { ...((p.properties ?? {}) as Record<string, unknown>) };
        delete props.icon;
        delete props._folderPath;
        return {
          ...p,
          folder_id: p.folder_id ?? folder_id,
          properties: props as never,
          user_id: user.id,
        };
      };
      const rows = items.map(sanitize);

      const CHUNK_SIZE = 200;
      let totalInserted = 0;
      const inserted: SavedPoi[] = [];
      const errors: string[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const slice = rows.slice(i, i + CHUNK_SIZE);
        const { data, error, count } = await supabase
          .from("pois")
          .insert(slice, { count: "exact" })
          .select(LIGHT_COLS);
        if (error) {
          console.error(`[addMany] chunk ${i}-${i + slice.length} falló:`, error);
          errors.push(error.message);
          continue;
        }
        totalInserted += count ?? slice.length;
        if (data) {
          for (const row of data as LightRow[]) inserted.push(toSavedPoi(row));
        }
      }
      if (inserted.length) {
        setPois((prev) => {
          const next = [...inserted, ...prev];
          setTrashedPois((trash) => {
            advanceSyncStamp(inserted);
            persistCache(next, trash, lastSyncAtRef.current);
            return trash;
          });
          return next;
        });
      }
      if (totalInserted === 0 && errors.length) throw new Error(errors[0]);
      return totalInserted;
    },
    [user, persistCache, advanceSyncStamp],
  );

  const update = useCallback(
    async (id: string, patch: PoiUpdate) => {
      const { error } = await supabase
        .from("pois")
        .update(patch as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
      const nowIso = new Date().toISOString();
      setPois((prev) => {
        const next = prev.map((p) =>
          p.id === id ? ({ ...p, ...patch, updated_at: nowIso } as SavedPoi) : p,
        );
        setTrashedPois((trash) => {
          persistCache(next, trash, nowIso > (lastSyncAtRef.current ?? "") ? nowIso : lastSyncAtRef.current);
          return trash;
        });
        return next;
      });
      lastSyncAtRef.current = nowIso > (lastSyncAtRef.current ?? "") ? nowIso : lastSyncAtRef.current;
      void persistLastSyncAt(user!.id, lastSyncAtRef.current);
    },
    [user, persistCache],
  );

  const moveMany = useCallback(
    async (ids: string[], folder_id: string | null) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("pois")
        .update({ folder_id })
        .in("id", ids);
      if (error) throw new Error(error.message);
      const nowIso = new Date().toISOString();
      const idSet = new Set(ids);
      setPois((prev) => {
        const next = prev.map((p) =>
          idSet.has(p.id) ? ({ ...p, folder_id, updated_at: nowIso } as SavedPoi) : p,
        );
        setTrashedPois((trash) => {
          persistCache(next, trash, nowIso);
          return trash;
        });
        return next;
      });
      lastSyncAtRef.current = nowIso;
      if (user) void persistLastSyncAt(user.id, nowIso);
    },
    [user, persistCache],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("pois")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
      const nowIso = new Date().toISOString();
      setPois((prev) => {
        const moving = prev.find((p) => p.id === id);
        const next = prev.filter((p) => p.id !== id);
        setTrashedPois((trash) => {
          const newTrash = moving
            ? [{ ...moving, deleted_at: nowIso, updated_at: nowIso }, ...trash]
            : trash;
          persistCache(next, newTrash, nowIso);
          return newTrash;
        });
        return next;
      });
      lastSyncAtRef.current = nowIso;
      if (user) void persistLastSyncAt(user.id, nowIso);
    },
    [user, persistCache],
  );

  const removeMany = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("pois")
        .update({ deleted_at: nowIso })
        .in("id", ids);
      if (error) throw new Error(error.message);
      const idSet = new Set(ids);
      setPois((prev) => {
        const moving = prev.filter((p) => idSet.has(p.id));
        const next = prev.filter((p) => !idSet.has(p.id));
        setTrashedPois((trash) => {
          const newTrash = [
            ...moving.map((m) => ({ ...m, deleted_at: nowIso, updated_at: nowIso })),
            ...trash,
          ];
          persistCache(next, newTrash, nowIso);
          return newTrash;
        });
        return next;
      });
      lastSyncAtRef.current = nowIso;
      if (user) void persistLastSyncAt(user.id, nowIso);
    },
    [user, persistCache],
  );

  const restore = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("pois")
        .update({ deleted_at: null })
        .in("id", ids);
      if (error) throw new Error(error.message);
      const nowIso = new Date().toISOString();
      const idSet = new Set(ids);
      setTrashedPois((trash) => {
        const moving = trash.filter((p) => idSet.has(p.id));
        const newTrash = trash.filter((p) => !idSet.has(p.id));
        setPois((prev) => {
          const next = [
            ...moving.map((m) => ({ ...m, deleted_at: null, updated_at: nowIso })),
            ...prev,
          ];
          persistCache(next, newTrash, nowIso);
          return next;
        });
        return newTrash;
      });
      lastSyncAtRef.current = nowIso;
      if (user) void persistLastSyncAt(user.id, nowIso);
    },
    [user, persistCache],
  );

  const purgePermanently = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await supabase.from("pois").delete().in("id", slice);
        if (error) throw new Error(error.message);
      }
      const idSet = new Set(ids);
      setPois((prev) => {
        const next = prev.filter((p) => !idSet.has(p.id));
        setTrashedPois((trash) => {
          const newTrash = trash.filter((p) => !idSet.has(p.id));
          persistCache(next, newTrash, lastSyncAtRef.current);
          return newTrash;
        });
        return next;
      });
    },
    [persistCache],
  );

  const clearAll = useCallback(async () => {
    if (!user) return;
    const { error } = await supabase
      .from("pois")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    await fullRefresh();
  }, [user, fullRefresh]);

  const addOne = useCallback(
    async (item: PoiInsert) => addMany([item], item.folder_id ?? null),
    [addMany],
  );

  return {
    pois,
    trashedPois,
    loading,
    addMany,
    addOne,
    update,
    moveMany,
    remove,
    removeMany,
    restore,
    purgePermanently,
    clearAll,
    refresh,
    forceFullRefresh,
  };
};

// ===== Helpers =====

const enrichInBackground = async (
  rows: SavedPoi[],
  target: "active" | "trashed",
  setter: React.Dispatch<React.SetStateAction<SavedPoi[]>>,
  persistCache: (a: SavedPoi[], b: SavedPoi[], s?: string | null) => void,
) => {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((p) => p.id);
    try {
      const res = await supabase
        .from("pois")
        .select("id,description,properties")
        .in("id", slice);
      if (res.error || !res.data) continue;
      const byId = new Map<
        string,
        { description: string | null; properties: Record<string, unknown> }
      >();
      for (const row of res.data as Array<{
        id: string;
        description: string | null;
        properties: Record<string, unknown> | null;
      }>) {
        byId.set(row.id, {
          description: row.description ?? null,
          properties: row.properties ?? {},
        });
      }
      setter((prev) => {
        const next = prev.map((p) => {
          const extra = byId.get(p.id);
          return extra ? { ...p, ...extra } : p;
        });
        // Persistir snapshot tras enriquecer.
        if (target === "active") {
          // Need trashed too — but we don't have it here. Skip persist on enrich
          // to keep this helper local. The next mutation/sync will persist.
        }
        return next;
      });
    } catch (err) {
      console.warn("[useSavedPois] enrich chunk failed", err);
    }
  }
  // Trigger one persist after all chunks done — we don't have both lists here,
  // so we leave it: the next sync/mutation will persist enriched data.
  void persistCache;
};
