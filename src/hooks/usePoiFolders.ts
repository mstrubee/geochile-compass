import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { PoiFolder } from "@/types/pois";

const SELECT_COLS = "id,name,parent_id,color,created_at,deleted_at";

export const usePoiFolders = () => {
  const { user } = useAuth();
  const [folders, setFolders] = useState<PoiFolder[]>([]);
  const [trashedFolders, setTrashedFolders] = useState<PoiFolder[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setFolders([]);
      setTrashedFolders([]);
      return;
    }
    setLoading(true);
    const [active, trashed] = await Promise.all([
      supabase
        .from("poi_folders")
        .select(SELECT_COLS)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      supabase
        .from("poi_folders")
        .select(SELECT_COLS)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
    ]);
    setLoading(false);
    if (active.error) {
      console.error("load folders failed", active.error);
      return;
    }
    setFolders((active.data ?? []) as PoiFolder[]);
    setTrashedFolders((trashed.data ?? []) as PoiFolder[]);
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
        .select(SELECT_COLS)
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

  // Soft-delete recursivo: marca la carpeta, sus subcarpetas (cualquier nivel) y todos los POIs dentro.
  const remove = useCallback(
    async (id: string) => {
      if (!user) throw new Error("Debes iniciar sesión");
      // Recoger descendientes ya cargados en memoria
      const { data: allFolders } = await supabase
        .from("poi_folders")
        .select("id,parent_id")
        .eq("user_id", user.id)
        .is("deleted_at", null);
      const all = (allFolders ?? []) as { id: string; parent_id: string | null }[];
      const toDelete = new Set<string>([id]);
      const childrenOf = (pid: string) => all.filter((f) => f.parent_id === pid);
      const walk = (pid: string) => {
        for (const c of childrenOf(pid)) {
          if (!toDelete.has(c.id)) {
            toDelete.add(c.id);
            walk(c.id);
          }
        }
      };
      walk(id);
      const ids = Array.from(toDelete);
      const ts = new Date().toISOString();
      const [r1, r2] = await Promise.all([
        supabase
          .from("poi_folders")
          .update({ deleted_at: ts })
          .in("id", ids),
        supabase
          .from("pois")
          .update({ deleted_at: ts })
          .in("folder_id", ids)
          .is("deleted_at", null),
      ]);
      if (r1.error) throw new Error(r1.error.message);
      if (r2.error) throw new Error(r2.error.message);
      await refresh();
    },
    [user, refresh],
  );

  const restore = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("poi_folders")
        .update({ deleted_at: null })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const purgePermanently = useCallback(
    async (id: string) => {
      if (!user) throw new Error("Debes iniciar sesión");
      // Recoger TODOS los descendientes (incluyendo carpetas en papelera)
      // para eliminarlos en orden hijos→padres y evitar violaciones de FK.
      const { data: allFolders } = await supabase
        .from("poi_folders")
        .select("id,parent_id")
        .eq("user_id", user.id);
      const all = (allFolders ?? []) as { id: string; parent_id: string | null }[];
      const order: string[] = [];
      const visit = (pid: string) => {
        for (const c of all.filter((f) => f.parent_id === pid)) {
          visit(c.id);
        }
        order.push(pid);
      };
      visit(id);

      // Primero, soltar/borrar POIs asociados a estas carpetas en lotes.
      const CHUNK = 100;
      for (let i = 0; i < order.length; i += CHUNK) {
        const slice = order.slice(i, i + CHUNK);
        const { error: pErr } = await supabase
          .from("pois")
          .delete()
          .in("folder_id", slice);
        if (pErr) {
          console.error("[purgeFolder] borrar POIs falló", pErr);
          throw new Error(pErr.message);
        }
      }

      // Luego borrar carpetas hijas→padre.
      for (const fid of order) {
        const { error } = await supabase.from("poi_folders").delete().eq("id", fid);
        if (error) throw new Error(error.message);
      }
      await refresh();
    },
    [user, refresh],
  );

  const move = useCallback(
    async (id: string, parent_id: string | null) => {
      const { error } = await supabase
        .from("poi_folders")
        .update({ parent_id })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  return {
    folders,
    trashedFolders,
    loading,
    create,
    rename,
    remove,
    restore,
    purgePermanently,
    move,
    refresh,
  };
};
