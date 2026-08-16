import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type {
  IsochroneFolder,
  SavedIsochrone,
  SaveIsochronePayload,
} from "@/types/savedIsochrones";
import type { IsoMode } from "@/types/isochrones";

type Row = Record<string, unknown>;

const rowToIso = (r: Row): SavedIsochrone => ({
  id: r.id as string,
  user_id: r.user_id as string,
  folder_id: (r.folder_id as string | null) ?? null,
  name: r.name as string,
  mode: r.mode as IsoMode,
  minutes: (r.minutes as number[]) ?? [],
  center_lat: Number(r.center_lat),
  center_lng: Number(r.center_lng),
  color: (r.color as string | null) ?? null,
  features: (r.features as Feature<Polygon | MultiPolygon, { value: number }>[]) ?? [],
  source_poi_id: (r.source_poi_id as string | null) ?? null,
  source_lat: r.source_lat == null ? null : Number(r.source_lat),
  source_lng: r.source_lng == null ? null : Number(r.source_lng),
  notes: (r.notes as string | null) ?? null,
  projection_settings:
    (r.projection_settings as SavedIsochrone["projection_settings"]) ?? null,
  created_at: r.created_at as string,
  updated_at: r.updated_at as string,
  deleted_at: (r.deleted_at as string | null) ?? null,
});

const rowToFolder = (r: Row): IsochroneFolder => ({
  id: r.id as string,
  user_id: r.user_id as string,
  name: r.name as string,
  parent_id: (r.parent_id as string | null) ?? null,
  color: (r.color as string | null) ?? null,
  created_at: r.created_at as string,
  updated_at: r.updated_at as string,
  deleted_at: (r.deleted_at as string | null) ?? null,
});

export const useSavedIsochrones = () => {
  const { user } = useAuth();
  const [savedIsos, setSavedIsos] = useState<SavedIsochrone[]>([]);
  const [folders, setFolders] = useState<IsochroneFolder[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setSavedIsos([]);
      setFolders([]);
      return;
    }
    setLoading(true);
    try {
      const [isosRes, foldersRes] = await Promise.all([
        supabase
          .from("saved_isochrones")
          .select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("isochrone_folders")
          .select("*")
          .is("deleted_at", null)
          .order("name", { ascending: true }),
      ]);
      if (!isosRes.error) setSavedIsos((isosRes.data ?? []).map(rowToIso));
      if (!foldersRes.error) setFolders((foldersRes.data ?? []).map(rowToFolder));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveIsochrone = useCallback(
    async (payload: SaveIsochronePayload) => {
      if (!user) throw new Error("Debes iniciar sesión");
      const { data, error } = await supabase
        .from("saved_isochrones")
        .insert({
          user_id: user.id,
          folder_id: payload.folder_id,
          name: payload.name,
          mode: payload.mode,
          minutes: payload.minutes,
          center_lat: payload.center_lat,
          center_lng: payload.center_lng,
          color: payload.color,
          features: payload.features as never,
          source_poi_id: payload.source_poi_id ?? null,
          source_lat: payload.source_lat ?? null,
          source_lng: payload.source_lng ?? null,
          notes: payload.notes ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const inserted = data ? rowToIso(data as Row) : null;
      // Update optimista: agregar la isócrona al estado local de inmediato,
      // así el sidebar la muestra sin esperar al refetch.
      if (inserted) {
        setSavedIsos((prev) =>
          prev.some((s) => s.id === inserted.id) ? prev : [inserted, ...prev],
        );
      }
      // Refetch en background para sincronizar cualquier diferencia con BD.
      void refresh();
      return inserted;
    },
    [user, refresh],
  );

  const updateIso = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<SavedIsochrone, "name" | "folder_id" | "color" | "notes" | "projection_settings">
      >,
    ) => {
      const { error } = await supabase
        .from("saved_isochrones")
        .update(patch as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const removeIso = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("saved_isochrones").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const createFolder = useCallback(
    async (name: string, parentId: string | null = null, color: string | null = null) => {
      if (!user) throw new Error("Debes iniciar sesión");
      const { data, error } = await supabase
        .from("isochrone_folders")
        .insert({ user_id: user.id, name, parent_id: parentId, color })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const created = data ? rowToFolder(data as Row) : null;
      if (created) {
        setFolders((prev) =>
          prev.some((f) => f.id === created.id) ? prev : [...prev, created],
        );
      }
      void refresh();
      return created;
    },
    [user, refresh],
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      const { error } = await supabase
        .from("isochrone_folders")
        .update({ name })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const moveFolder = useCallback(
    async (id: string, parentId: string | null) => {
      const { error } = await supabase
        .from("isochrone_folders")
        .update({ parent_id: parentId })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("isochrone_folders").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh],
  );

  return {
    savedIsos,
    folders,
    loading,
    refresh,
    saveIsochrone,
    updateIso,
    removeIso,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
  };
};
