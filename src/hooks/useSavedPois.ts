import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { PoiInsert, SavedPoi } from "@/types/pois";

export const useSavedPois = () => {
  const { user } = useAuth();
  const [pois, setPois] = useState<SavedPoi[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setPois([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("pois")
      .select(
        "id,name,description,category,color,icon,lat,lng,properties,source_layer,created_at",
      )
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      console.error("load pois failed", error);
      return;
    }
    setPois((data ?? []) as SavedPoi[]);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addMany = useCallback(
    async (items: PoiInsert[]) => {
      if (!user) throw new Error("Debes iniciar sesión");
      if (!items.length) return 0;
      const rows = items.map((p) => ({ ...p, user_id: user.id }));
      const { error, count } = await supabase
        .from("pois")
        .insert(rows, { count: "exact" });
      if (error) throw new Error(error.message);
      await refresh();
      return count ?? rows.length;
    },
    [user, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("pois").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const clearAll = useCallback(async () => {
    if (!user) return;
    const { error } = await supabase
      .from("pois")
      .delete()
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    await refresh();
  }, [user, refresh]);

  return { pois, loading, addMany, remove, clearAll, refresh };
};
