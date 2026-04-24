import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { PoiFolder } from "@/types/pois";

export const usePoiFolders = () => {
  const { user } = useAuth();
  const [folders, setFolders] = useState<PoiFolder[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setFolders([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("poi_folders")
      .select("id,name,parent_id,color,created_at")
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) {
      console.error("load folders failed", error);
      return;
    }
    setFolders((data ?? []) as PoiFolder[]);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string, parent_id: string | null = null, color: string | null = null) => {
      if (!user) throw new Error("Debes iniciar sesión");
      const { data, error } = await supabase
        .from("poi_folders")
        .insert({ name, parent_id, color, user_id: user.id })
        .select("id,name,parent_id,color,created_at")
        .single();
      if (error) throw new Error(error.message);
      await refresh();
      return data as PoiFolder;
    },
    [user, refresh],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const { error } = await supabase.from("poi_folders").update({ name }).eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("poi_folders").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  return { folders, loading, create, rename, remove, refresh };
};
