import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { loadPoiCache, savePoiCache } from "@/services/poiCache";
import type { PoiInsert, PoiUpdate, SavedPoi } from "@/types/pois";

// Fase ligera: columnas mínimas para pintar el mapa rápido (sin `properties`
// ni `description` que pueden ser blobs gigantes con KMZ con logos embebidos).
const LIGHT_COLS =
  "id,name,category,color,icon,lat,lng,source_layer,folder_id,created_at,deleted_at";

// Fase de enriquecimiento: trae los campos pesados.
const HEAVY_COLS = "id,description,properties";

const PAGE = 500;

export const useSavedPois = () => {
  const { user } = useAuth();
  const [pois, setPois] = useState<SavedPoi[]>([]);
  const [trashedPois, setTrashedPois] = useState<SavedPoi[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setPois([]);
      setTrashedPois([]);
      return;
    }
    setLoading(true);

    /** Trae paginado en columnas ligeras. Reintenta cada página hasta 3 veces. */
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
          // En la fase ligera no traemos `properties` ni `description`,
          // así que rellenamos con defaults para mantener el tipo `SavedPoi`.
          data = (res.data ?? []).map((row: Record<string, unknown>) => ({
            ...(row as object),
            description: null,
            properties: {},
          })) as SavedPoi[];
        }
        if (data === null) {
          console.error("[useSavedPois] light fetch failed (after retries)", lastError);
          throw new Error(
            lastError instanceof Error
              ? lastError.message
              : "No se pudieron cargar los POIs",
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

    /**
     * Enriquece en background los POIs ya cargados con `description` y
     * `properties` (campos pesados), por chunks de IDs. Se ejecuta sin
     * bloquear: los markers ya están pintados en el mapa.
     */
    const enrichInBackground = async (
      lightPois: SavedPoi[],
      target: "active" | "trashed",
    ) => {
      const CHUNK = 500;
      for (let i = 0; i < lightPois.length; i += CHUNK) {
        const slice = lightPois.slice(i, i + CHUNK).map((p) => p.id);
        try {
          const res = await supabase
            .from("pois")
            .select(HEAVY_COLS)
            .in("id", slice);
          if (res.error || !res.data) continue;
          const byId = new Map<string, { description: string | null; properties: Record<string, unknown> }>();
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
          // Merge en el state correspondiente.
          const setter = target === "active" ? setPois : setTrashedPois;
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

    try {
      const [active, trashed] = await Promise.all([
        fetchAllLight(false),
        fetchAllLight(true),
      ]);
      setPois(active);
      setTrashedPois(trashed);
      // Persistimos snapshot ligero — la próxima carga es instantánea.
      void savePoiCache(user.id, active, trashed);

      // Enriquecimiento en background (no bloquea el render del mapa).
      void enrichInBackground(active, "active").then(() => {
        // Re-persistimos con datos completos al terminar.
        setPois((curr) => {
          setTrashedPois((trashedCurr) => {
            void savePoiCache(user.id, curr, trashedCurr);
            return trashedCurr;
          });
          return curr;
        });
      });
      void enrichInBackground(trashed, "trashed");
    } catch (err) {
      console.error("[useSavedPois.refresh] error", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Al iniciar sesión: hidratar inmediatamente con caché local (modo offline /
  // arranque rápido) y luego refrescar contra la BD en segundo plano.
  useEffect(() => {
    if (!user) {
      setPois([]);
      setTrashedPois([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await loadPoiCache(user.id);
      if (cancelled) return;
      if (cached) {
        setPois(cached.pois);
        setTrashedPois(cached.trashedPois);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Debounce de refresh: cuando se encadenan varias mutaciones (insert masivo,
  // mover, borrar muchos), agrupa los refresh en uno solo a los 150ms.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 150);
  }, [refresh]);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const addMany = useCallback(
    async (items: PoiInsert[], folder_id: string | null = null) => {
      if (!user) throw new Error("Debes iniciar sesión");
      if (!items.length) return 0;

      // Limpieza preventiva: si el icon es un data URL grande (KMZ con logos
      // embebidos), evitamos duplicarlo dentro de `properties` y descartamos
      // claves internas que no aportan a la BD para reducir el payload.
      const sanitize = (p: PoiInsert) => {
        const props = { ...((p.properties ?? {}) as Record<string, unknown>) };
        // Quitar copias del icon dentro de properties (queda en la columna `icon`).
        delete props.icon;
        // Quitar el path interno usado solo durante el import.
        delete props._folderPath;
        return {
          ...p,
          folder_id: p.folder_id ?? folder_id,
          properties: props as never,
          user_id: user.id,
        };
      };

      const rows = items.map(sanitize);

      // Insertar por lotes para evitar payloads gigantes (KMZ con muchos puntos
      // o logos como data URLs) que pueden hacer fallar todo el batch.
      const CHUNK_SIZE = 200;
      let totalInserted = 0;
      const errors: string[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const slice = rows.slice(i, i + CHUNK_SIZE);
        const { error, count } = await supabase
          .from("pois")
          .insert(slice, { count: "exact" });
        if (error) {
          console.error(
            `[addMany] chunk ${i}-${i + slice.length} falló:`,
            error,
          );
          errors.push(error.message);
          continue;
        }
        totalInserted += count ?? slice.length;
      }
      await refresh();
      if (totalInserted === 0 && errors.length) {
        throw new Error(errors[0]);
      }
      return totalInserted;
    },
    [user, refresh],
  );

  const update = useCallback(
    async (id: string, patch: PoiUpdate) => {
      const { error } = await supabase
        .from("pois")
        .update(patch as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
      scheduleRefresh();
    },
    [scheduleRefresh],
  );

  const moveMany = useCallback(
    async (ids: string[], folder_id: string | null) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("pois")
        .update({ folder_id })
        .in("id", ids);
      if (error) throw new Error(error.message);
      scheduleRefresh();
    },
    [scheduleRefresh],
  );

  // Soft delete → mueve a la papelera (30 días)
  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("pois")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
      scheduleRefresh();
    },
    [scheduleRefresh],
  );

  const removeMany = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("pois")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw new Error(error.message);
      scheduleRefresh();
    },
    [scheduleRefresh],
  );

  const restore = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("pois")
        .update({ deleted_at: null })
        .in("id", ids);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const purgePermanently = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      // Borrar en lotes pequeños: un .in("id", [...]) con miles de UUIDs
      // genera una URL gigantesca y el servidor responde 400/414.
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await supabase.from("pois").delete().in("id", slice);
        if (error) {
          console.error(`[purgePermanently] chunk ${i} falló:`, error);
          throw new Error(error.message);
        }
      }
      await refresh();
    },
    [refresh],
  );

  const clearAll = useCallback(async () => {
    if (!user) return;
    const { error } = await supabase
      .from("pois")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    await refresh();
  }, [user, refresh]);

  const addOne = useCallback(
    async (item: PoiInsert) => {
      return addMany([item], item.folder_id ?? null);
    },
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
  };
};
