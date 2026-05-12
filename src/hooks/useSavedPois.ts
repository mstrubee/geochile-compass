import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { rowSyncStamp, savePoiCache } from "@/services/poiCache";
import type { PoiInsert, PoiUpdate, SavedPoi } from "@/types/pois";

// Columnas ligeras para pintar el mapa rápido (sin `properties` ni
// `description` que pueden ser blobs gigantes con KMZ con logos embebidos).
const LIGHT_COLS =
  "id,name,category,color,icon,lat,lng,source_layer,folder_id,created_at,updated_at,deleted_at";

const PAGE = 250;
// Debounce para escritura del caché en IndexedDB.
const PERSIST_DEBOUNCE_MS = 250;

type LightRow = Record<string, unknown>;
const toSavedPoi = (row: LightRow): SavedPoi =>
  ({
    ...(row as object),
    description: null,
    properties: {},
  }) as SavedPoi;

interface SyncSummary {
  row_count: number;
  max_updated_at: string | null;
  checksum: string;
}

const fetchSyncSummary = async (): Promise<SyncSummary | null> => {
  try {
    // RPC tipado dinámicamente: la función no está aún en types.ts pero existe en BD.
    const { data, error } = await (
      supabase.rpc as unknown as (
        fn: string,
      ) => Promise<{ data: SyncSummary[] | null; error: { message: string } | null }>
    )("poi_sync_summary");
    if (error) {
      console.warn("[useSavedPois] poi_sync_summary RPC failed", error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    return {
      row_count: Number(row.row_count ?? 0),
      max_updated_at: row.max_updated_at ?? null,
      checksum: row.checksum ?? "",
    };
  } catch (err) {
    console.warn("[useSavedPois] poi_sync_summary threw", err);
    return null;
  }
};

export const useSavedPois = () => {
  const { user, loading: authLoading } = useAuth();
  const [pois, setPois] = useState<SavedPoi[]>([]);
  const [trashedPois, setTrashedPois] = useState<SavedPoi[]>([]);
  const [folderCounts, setFolderCounts] = useState<Map<string | null, number>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(false);

  // Snapshot interno del último lastSyncAt confirmado para este user.
  const lastSyncAtRef = useRef<string | null>(null);
  // Cola de sync: garantiza que solo corre uno a la vez.
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  // Contador de mutaciones en vuelo: el sync espera a que llegue a 0.
  const pendingMutationsRef = useRef(0);
  // Para detectar bucles fullRefresh→summary mismatch→fullRefresh.
  const lastFullRefreshAtRef = useRef(0);
  // Cancelación de hidrataciones cruzadas entre cambios de user.
  const userIdRef = useRef<string | null>(null);
  // Refs vivas de pois/trashed para que syncDelta no use closures stale.
  const poisRef = useRef<SavedPoi[]>([]);
  const trashedRef = useRef<SavedPoi[]>([]);
  useEffect(() => {
    poisRef.current = pois;
  }, [pois]);
  useEffect(() => {
    trashedRef.current = trashedPois;
  }, [trashedPois]);

  // ===== Persistencia única en cada cambio de state (debounced) =====
  // CRÍTICO: nunca escribir un snapshot vacío encima de uno con datos.
  // Si el estado actual está vacío, dejamos el caché como estaba para que un
  // arranque posterior pueda recuperar los datos reales.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user) return;
    if (authLoading) return;
    // No persistir snapshots vacíos: probablemente venimos de un arranque
    // sin sesión o de un error de red. Esperamos a tener datos reales.
    if (pois.length === 0 && trashedPois.length === 0) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const uid = user.id;
    const snapshotPois = pois;
    const snapshotTrash = trashedPois;
    const snapshotSync = lastSyncAtRef.current;
    persistTimerRef.current = setTimeout(() => {
      void savePoiCache(uid, snapshotPois, snapshotTrash, snapshotSync);
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [user, authLoading, pois, trashedPois]);

  // ===== Refresh full (paginado, fallback / primera vez / botón manual) =====
  const fullRefreshImpl = useCallback(async (): Promise<void> => {
    if (!user) {
      setPois([]);
      setTrashedPois([]);
      return;
    }
    lastFullRefreshAtRef.current = Date.now();
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

      if (!activeOk || !active) {
        console.error(
          "[useSavedPois.fullRefresh] active fetch failed, keeping cached state",
          activeRes.status === "rejected" ? activeRes.reason : null,
        );
        return;
      }

      // SOSPECHOSO: el servidor devuelve 0 POI activos pero localmente tenemos
      // datos. Casi seguro es una consulta hecha sin sesión válida (token
      // anónimo) o un error transitorio. Conservamos el snapshot bueno y
      // reintentamos en el próximo ciclo en vez de borrar la UI.
      if (active.length === 0 && poisRef.current.length > 0) {
        console.warn(
          `[useSavedPois.fullRefresh] server returned 0 active POIs but local has ${poisRef.current.length}; keeping local snapshot`,
        );
        return;
      }

      // Confirmar lastSyncAt con el max real desde el servidor (evita drift de reloj).
      const summary = await fetchSyncSummary();
      let stamp: string | null = summary?.max_updated_at ?? null;
      if (!stamp && (active.length > 0 || trashed.length > 0)) {
        stamp = [...active, ...trashed].reduce(
          (m, r) => {
            const s = rowSyncStamp(r);
            return s > m ? s : m;
          },
          new Date(0).toISOString(),
        );
      }
      // Si no hay filas y la RPC no devolvió stamp, NO persistir epoch:
      // dejaríamos el caché contaminado y el próximo arranque pediría un
      // delta sobre toda la historia, garantizado a hacer timeout.
      lastSyncAtRef.current = stamp;
      poisRef.current = active;
      trashedRef.current = trashed;
      setPois(active);
      setTrashedPois(trashed);

      // Enriquecimiento heavy en background.
      void enrichInBackground(active, setPois);
      if (trashedOk) void enrichInBackground(trashed, setTrashedPois);
    } catch (err) {
      console.error("[useSavedPois.fullRefresh] error", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // ===== Verificación de integridad (count + checksum) =====
  const verifyIntegrity = useCallback(
    async (currentPois: SavedPoi[], currentTrashed: SavedPoi[]): Promise<boolean> => {
      const summary = await fetchSyncSummary();
      if (!summary) return true; // si la RPC falla, no forzamos refresh
      const localCount = currentPois.length + currentTrashed.length;
      // SOSPECHOSO: el servidor dice 0 pero local tiene datos. Casi seguro la
      // RPC corrió sin sesión válida (auth.uid() = null). NO forzamos refresh
      // ni borramos nada — esperamos al próximo ciclo con sesión correcta.
      if (summary.row_count === 0 && localCount > 0) {
        console.warn(
          `[useSavedPois] integrity check returned 0 but local has ${localCount}; ignoring (likely missing auth)`,
        );
        return true;
      }
      if (summary.row_count !== localCount) {
        console.warn(
          `[useSavedPois] integrity mismatch: server=${summary.row_count} local=${localCount} → fullRefresh`,
        );
        return false;
      }
      // Confirmar lastSyncAt al max del servidor.
      if (summary.max_updated_at) {
        lastSyncAtRef.current = summary.max_updated_at;
      }
      return true;
    },
    [],
  );

  // ===== Sync delta (paginado) =====
  const syncDeltaImpl = useCallback(async (): Promise<void> => {
    if (!user) return;
    // Si hay mutaciones en vuelo, esperamos un tick para no pisar updates locales.
    if (pendingMutationsRef.current > 0) {
      await new Promise((r) => setTimeout(r, 100));
      if (pendingMutationsRef.current > 0) return; // skip; se reintentará
    }

    const since = lastSyncAtRef.current;
    if (!since) {
      await fullRefreshImpl();
      return;
    }

    try {
      // Paginar el delta: filas con updated_at > since, ordenadas asc.
      const changed: SavedPoi[] = [];
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("pois")
          .select(LIGHT_COLS)
          .gt("updated_at", since)
          .order("updated_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) {
          console.warn("[useSavedPois.syncDelta] page error → fullRefresh fallback", error.message);
          const sinceLast = Date.now() - lastFullRefreshAtRef.current;
          if (sinceLast > 30_000) {
            await fullRefreshImpl();
          }
          return;
        }
        const page = (data ?? []).map((r) => toSavedPoi(r as LightRow));
        changed.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }

      let nextPois = poisRef.current;
      let nextTrash = trashedRef.current;
      if (changed.length) {
        const activeIncoming = changed.filter((r) => !r.deleted_at);
        const trashedIncoming = changed.filter((r) => !!r.deleted_at);
        const incomingIds = new Set(changed.map((r) => r.id));
        nextPois = [...activeIncoming, ...poisRef.current.filter((p) => !incomingIds.has(p.id))];
        nextTrash = [...trashedIncoming, ...trashedRef.current.filter((p) => !incomingIds.has(p.id))];
        setPois(nextPois);
        setTrashedPois(nextTrash);
        if (activeIncoming.length) void enrichInBackground(activeIncoming, setPois);
        if (trashedIncoming.length) void enrichInBackground(trashedIncoming, setTrashedPois);
      }

      // Verificación de integridad: detecta hard-deletes y desincronías.
      // Usa refs vivas (post-setState el ref aún no se actualiza, pero nextPois
      // ya refleja el estado que acabamos de aplicar).
      const ok = await verifyIntegrity(nextPois, nextTrash);
      if (!ok) {
        // Evitar bucle: solo un fullRefresh cada 30s como mucho.
        const sinceLast = Date.now() - lastFullRefreshAtRef.current;
        if (sinceLast > 30_000) {
          await fullRefreshImpl();
        } else {
          console.warn("[useSavedPois] integrity mismatch but recent fullRefresh, skipping");
        }
      }
    } catch (err) {
      console.warn("[useSavedPois.syncDelta] threw, ignoring", err);
    }
  }, [user, fullRefreshImpl, verifyIntegrity]);

  // ===== Wrappers que serializan ejecuciones =====
  const runSerialized = useCallback(
    async (job: () => Promise<void>): Promise<void> => {
      while (syncInFlightRef.current) {
        try {
          await syncInFlightRef.current;
        } catch {
          /* noop */
        }
      }
      const p = (async () => {
        try {
          await job();
        } finally {
          syncInFlightRef.current = null;
        }
      })();
      syncInFlightRef.current = p;
      await p;
    },
    [],
  );

  const syncDelta = useCallback(
    () => runSerialized(syncDeltaImpl),
    [runSerialized, syncDeltaImpl],
  );
  const fullRefresh = useCallback(
    () => runSerialized(fullRefreshImpl),
    [runSerialized, fullRefreshImpl],
  );

  const loadFolders = useCallback(
    async (folderIds: Array<string | null>): Promise<void> => {
      if (!user) return;
      const unique = Array.from(new Set(folderIds));
      if (unique.length === 0) return;
      setLoading(true);
      try {
        const loaded: SavedPoi[] = [];
        const fetchPage = async (ids: string[], nullFolder: boolean) => {
          let from = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            let q = supabase
              .from("pois")
              .select(LIGHT_COLS)
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
              .order("id", { ascending: true })
              .range(from, from + PAGE - 1);
            q = nullFolder ? q.is("folder_id", null) : q.in("folder_id", ids);
            const { data, error } = await q;
            if (error) throw new Error(error.message);
            const page = (data ?? []).map((row) => toSavedPoi(row as LightRow));
            loaded.push(...page);
            if (page.length < PAGE) break;
            from += PAGE;
          }
        };
        const ids = unique.filter((id): id is string => typeof id === "string");
        for (let i = 0; i < ids.length; i += 100) {
          await fetchPage(ids.slice(i, i + 100), false);
        }
        if (unique.includes(null)) await fetchPage([], true);
        const requested = new Set(unique);
        setPois((prev) => {
          const kept = prev.filter((p) => !requested.has(p.folder_id));
          return [...kept, ...loaded];
        });
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  // ===== Conteos por carpeta (RPC agregada, no carga POIs) =====
  const loadFolderCounts = useCallback(async (): Promise<void> => {
    if (!user) return;
    try {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
        ) => Promise<{
          data: Array<{ folder_id: string | null; cnt: number | string }> | null;
          error: { message: string } | null;
        }>
      )("poi_counts_by_folder");
      if (error) {
        console.warn("[useSavedPois] poi_counts_by_folder failed", error.message);
        return;
      }
      const m = new Map<string | null, number>();
      (data ?? []).forEach((row) => {
        m.set(row.folder_id ?? null, Number(row.cnt ?? 0));
      });
      setFolderCounts(m);
    } catch (err) {
      console.warn("[useSavedPois] poi_counts_by_folder threw", err);
    }
  }, [user]);

  // ===== Bootstrap ligero: no cargamos POIs al iniciar =====
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setPois([]);
      setTrashedPois([]);
      setFolderCounts(new Map());
      lastSyncAtRef.current = null;
      userIdRef.current = null;
      return;
    }
    userIdRef.current = user.id;
    setPois([]);
    setTrashedPois([]);
    poisRef.current = [];
    trashedRef.current = [];
    lastSyncAtRef.current = null;
    void loadFolderCounts();
  }, [user, authLoading, loadFolderCounts]);

  // Public refresh = sync delta. Para forzar full → forceFullRefresh.
  const refresh = useCallback(async () => {
    await syncDelta();
  }, [syncDelta]);

  const forceFullRefresh = useCallback(async () => {
    await fullRefresh();
  }, [fullRefresh]);

  // ===== Helper para envolver mutaciones (counter + advance lastSyncAt) =====
  const trackMutation = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      pendingMutationsRef.current += 1;
      try {
        return await fn();
      } finally {
        pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
        // Refrescar conteos por carpeta tras cualquier mutación.
        void loadFolderCounts();
      }
    },
    [loadFolderCounts],
  );

  const bumpSync = useCallback((iso: string) => {
    if (!lastSyncAtRef.current || iso > lastSyncAtRef.current) {
      lastSyncAtRef.current = iso;
    }
  }, []);

  // ===== Mutaciones (optimistas; persistencia vía effect) =====

  const addMany = useCallback(
    async (
      items: PoiInsert[],
      folder_id: string | null = null,
      _opts?: { deferRefresh?: boolean },
    ) => {
      if (!user) throw new Error("Debes iniciar sesión");
      if (!items.length) return 0;
      return trackMutation(async () => {
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
          for (const r of inserted) bumpSync(rowSyncStamp(r));
          setPois((prev) => [...inserted, ...prev]);
        }
        if (totalInserted === 0 && errors.length) throw new Error(errors[0]);
        return totalInserted;
      });
    },
    [user, trackMutation, bumpSync],
  );

  const update = useCallback(
    async (id: string, patch: PoiUpdate) => {
      return trackMutation(async () => {
        const { data, error } = await supabase
          .from("pois")
          .update(patch as never)
          .eq("id", id)
          .select("updated_at")
          .single();
        if (error) throw new Error(error.message);
        const nowIso = (data?.updated_at as string) ?? new Date().toISOString();
        bumpSync(nowIso);
        setPois((prev) =>
          prev.map((p) =>
            p.id === id ? ({ ...p, ...patch, updated_at: nowIso } as SavedPoi) : p,
          ),
        );
      });
    },
    [trackMutation, bumpSync],
  );

  const moveMany = useCallback(
    async (ids: string[], folder_id: string | null) => {
      if (!ids.length) return;
      return trackMutation(async () => {
        const { error } = await supabase
          .from("pois")
          .update({ folder_id })
          .in("id", ids);
        if (error) throw new Error(error.message);
        const nowIso = new Date().toISOString();
        bumpSync(nowIso);
        const idSet = new Set(ids);
        setPois((prev) =>
          prev.map((p) =>
            idSet.has(p.id) ? ({ ...p, folder_id, updated_at: nowIso } as SavedPoi) : p,
          ),
        );
      });
    },
    [trackMutation, bumpSync],
  );

  const remove = useCallback(
    async (id: string) => {
      return trackMutation(async () => {
        const nowIso = new Date().toISOString();
        const { error } = await supabase
          .from("pois")
          .update({ deleted_at: nowIso })
          .eq("id", id);
        if (error) throw new Error(error.message);
        bumpSync(nowIso);
        let moving: SavedPoi | undefined;
        setPois((prev) => {
          moving = prev.find((p) => p.id === id);
          return prev.filter((p) => p.id !== id);
        });
        setTrashedPois((trash) =>
          moving
            ? [{ ...moving, deleted_at: nowIso, updated_at: nowIso }, ...trash]
            : trash,
        );
      });
    },
    [trackMutation, bumpSync],
  );

  const removeMany = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      return trackMutation(async () => {
        const nowIso = new Date().toISOString();
        const { error } = await supabase
          .from("pois")
          .update({ deleted_at: nowIso })
          .in("id", ids);
        if (error) throw new Error(error.message);
        bumpSync(nowIso);
        const idSet = new Set(ids);
        let moving: SavedPoi[] = [];
        setPois((prev) => {
          moving = prev.filter((p) => idSet.has(p.id));
          return prev.filter((p) => !idSet.has(p.id));
        });
        setTrashedPois((trash) => [
          ...moving.map((m) => ({ ...m, deleted_at: nowIso, updated_at: nowIso })),
          ...trash,
        ]);
      });
    },
    [trackMutation, bumpSync],
  );

  const restore = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      return trackMutation(async () => {
        const { error } = await supabase
          .from("pois")
          .update({ deleted_at: null })
          .in("id", ids);
        if (error) throw new Error(error.message);
        const nowIso = new Date().toISOString();
        bumpSync(nowIso);
        const idSet = new Set(ids);
        let moving: SavedPoi[] = [];
        setTrashedPois((trash) => {
          moving = trash.filter((p) => idSet.has(p.id));
          return trash.filter((p) => !idSet.has(p.id));
        });
        setPois((prev) => [
          ...moving.map((m) => ({ ...m, deleted_at: null, updated_at: nowIso })),
          ...prev,
        ]);
      });
    },
    [trackMutation, bumpSync],
  );

  const purgePermanently = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      return trackMutation(async () => {
        const CHUNK = 100;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const { error } = await supabase.from("pois").delete().in("id", slice);
          if (error) throw new Error(error.message);
        }
        const idSet = new Set(ids);
        setPois((prev) => prev.filter((p) => !idSet.has(p.id)));
        setTrashedPois((trash) => trash.filter((p) => !idSet.has(p.id)));
      });
    },
    [trackMutation],
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
    void loadFolderCounts();
  }, [user, fullRefresh, loadFolderCounts]);

  const addOne = useCallback(
    async (item: PoiInsert) => addMany([item], item.folder_id ?? null),
    [addMany],
  );

  return {
    pois,
    trashedPois,
    folderCounts,
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
    loadFolders,
    loadFolderCounts,
  };
};

// ===== Helpers =====

const enrichInBackground = async (
  rows: SavedPoi[],
  setter: React.Dispatch<React.SetStateAction<SavedPoi[]>>,
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
      setter((prev) =>
        prev.map((p) => {
          const extra = byId.get(p.id);
          return extra ? { ...p, ...extra } : p;
        }),
      );
    } catch (err) {
      console.warn("[useSavedPois] enrich chunk failed", err);
    }
  }
};
