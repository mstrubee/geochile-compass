import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { PoiInsert, PoiUpdate, SavedPoi } from "@/types/pois";

const SELECT_COLS =
  "id,name,description,category,color,icon,lat,lng,properties,source_layer,folder_id,created_at,deleted_at";

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
    // Supabase limita a 1000 filas por consulta por defecto. Paginamos en
    // bloques para traer absolutamente todos los POIs del usuario sin tope.
    const PAGE = 1000;
    const fetchAllPaged = async (deleted: boolean): Promise<SavedPoi[]> => {
      const all: SavedPoi[] = [];
      let from = 0;
      // Loop hasta que un page devuelva menos de PAGE filas.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let q = supabase
          .from("pois")
          .select(SELECT_COLS)
          .order(deleted ? "deleted_at" : "created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        q = deleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
        const { data, error } = await q;
        if (error) {
          console.error("load pois failed", error);
          break;
        }
        const batch = (data ?? []) as SavedPoi[];
        all.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };
    const [active, trashed] = await Promise.all([
      fetchAllPaged(false),
      fetchAllPaged(true),
    ]);
    setLoading(false);
    setPois(active);
    setTrashedPois(trashed);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      const { error } = await supabase.from("pois").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const moveMany = useCallback(
    async (ids: string[], folder_id: string | null) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("pois")
        .update({ folder_id })
        .in("id", ids);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  // Soft delete → mueve a la papelera (30 días)
  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("pois")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const removeMany = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("pois")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
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

  return {
    pois,
    trashedPois,
    loading,
    addMany,
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
