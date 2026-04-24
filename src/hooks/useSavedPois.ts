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
    const [active, trashed] = await Promise.all([
      supabase
        .from("pois")
        .select(SELECT_COLS)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("pois")
        .select(SELECT_COLS)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
    ]);
    setLoading(false);
    if (active.error) {
      console.error("load pois failed", active.error);
      return;
    }
    setPois((active.data ?? []) as SavedPoi[]);
    setTrashedPois((trashed.data ?? []) as SavedPoi[]);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addMany = useCallback(
    async (items: PoiInsert[], folder_id: string | null = null) => {
      if (!user) throw new Error("Debes iniciar sesión");
      if (!items.length) return 0;
      const rows = items.map((p) => ({
        ...p,
        folder_id: p.folder_id ?? folder_id,
        properties: (p.properties ?? {}) as never,
        user_id: user.id,
      }));
      const { error, count } = await supabase
        .from("pois")
        .insert(rows, { count: "exact" });
      if (error) throw new Error(error.message);
      await refresh();
      return count ?? rows.length;
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
      const { error } = await supabase.from("pois").delete().in("id", ids);
      if (error) throw new Error(error.message);
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
