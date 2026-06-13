import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ComercialCategoria } from "@/types/comercial";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Carpeta {
  id: string;
  nombre: string;
  parentId: string | null;
}

export interface CatOverride {
  cat: ComercialCategoria;
  parentId: string | null;
}

export interface ComercialTree {
  folders: Carpeta[];
  catOverrides: CatOverride[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LS_KEY = "geochile_comercial_tree_v1";

function lsLoad(): ComercialTree {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "null") ?? { folders: [], catOverrides: [] };
  } catch {
    return { folders: [], catOverrides: [] };
  }
}
function lsSave(s: ComercialTree) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

export function descendantFolderIds(rootId: string, folders: Carpeta[]): Set<string> {
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    visited.add(cur);
    folders.filter((f) => f.parentId === cur).forEach((f) => queue.push(f.id));
  }
  return visited;
}

// Supabase table helpers (tablas no están en tipos auto-generados)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const carpetasTable  = () => (supabase as any).from("comercial_carpetas");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const overridesTable = () => (supabase as any).from("comercial_cat_overrides");

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useComercialFolders() {
  const { user } = useAuth();
  const [tree, setTree]       = useState<ComercialTree>({ folders: [], catOverrides: [] });
  const [loading, setLoading] = useState(true);

  // ── Carga inicial ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) {
      setTree(lsLoad());
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      carpetasTable().select("id, nombre, parent_id").eq("user_id", user.id),
      overridesTable().select("cat, parent_id").eq("user_id", user.id),
    ]).then(([f, o]: [any, any]) => {
      setTree({
        folders: (f.data ?? []).map((r: any) => ({
          id: r.id,
          nombre: r.nombre,
          parentId: r.parent_id ?? null,
        })),
        catOverrides: (o.data ?? []).map((r: any) => ({
          cat: r.cat as ComercialCategoria,
          parentId: r.parent_id ?? null,
        })),
      });
    }).finally(() => setLoading(false));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createFolder = useCallback(async (nombre: string, parentId: string | null) => {
    const trimmed = nombre.trim() || "Nueva carpeta";
    if (!user) {
      const id = crypto.randomUUID();
      setTree((prev) => {
        const next = { ...prev, folders: [...prev.folders, { id, nombre: trimmed, parentId }] };
        lsSave(next);
        return next;
      });
      return;
    }
    const { data, error } = await carpetasTable()
      .insert({ nombre: trimmed, parent_id: parentId, user_id: user.id })
      .select("id, nombre, parent_id")
      .single();
    if (error) { console.error("createFolder:", error); return; }
    setTree((prev) => ({
      ...prev,
      folders: [...prev.folders, { id: data.id, nombre: data.nombre, parentId: data.parent_id ?? null }],
    }));
  }, [user]);

  const renameFolder = useCallback(async (id: string, nombre: string) => {
    if (!user) {
      setTree((prev) => {
        const next = { ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, nombre } : f) };
        lsSave(next);
        return next;
      });
      return;
    }
    const { error } = await carpetasTable()
      .update({ nombre, updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", user.id);
    if (error) { console.error("renameFolder:", error); return; }
    setTree((prev) => ({ ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, nombre } : f) }));
  }, [user]);

  const deleteFolder = useCallback(async (id: string, parentId: string | null) => {
    const dead = descendantFolderIds(id, tree.folders);

    if (!user) {
      setTree((prev) => {
        const next = {
          folders: prev.folders.filter((f) => !dead.has(f.id)),
          catOverrides: prev.catOverrides.map((o) =>
            dead.has(o.parentId ?? "") ? { ...o, parentId } : o,
          ),
        };
        lsSave(next);
        return next;
      });
      return;
    }

    await carpetasTable().delete().in("id", Array.from(dead)).eq("user_id", user.id);

    // Reparentar categorías huérfanas
    const orphans = tree.catOverrides.filter((o) => dead.has(o.parentId ?? ""));
    if (orphans.length > 0) {
      await overridesTable().upsert(
        orphans.map((o) => ({ user_id: user.id, cat: o.cat, parent_id: parentId })),
      );
    }

    setTree((prev) => ({
      folders: prev.folders.filter((f) => !dead.has(f.id)),
      catOverrides: prev.catOverrides.map((o) =>
        dead.has(o.parentId ?? "") ? { ...o, parentId } : o,
      ),
    }));
  }, [user, tree.folders, tree.catOverrides]);

  const moveFolderTo = useCallback(async (id: string, newParentId: string | null) => {
    const dead = descendantFolderIds(id, tree.folders);
    if (newParentId && dead.has(newParentId)) return; // evitar ciclo

    if (!user) {
      setTree((prev) => {
        const next = { ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, parentId: newParentId } : f) };
        lsSave(next);
        return next;
      });
      return;
    }
    const { error } = await carpetasTable()
      .update({ parent_id: newParentId, updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", user.id);
    if (error) { console.error("moveFolderTo:", error); return; }
    setTree((prev) => ({ ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, parentId: newParentId } : f) }));
  }, [user, tree.folders]);

  const moveCatTo = useCallback(async (cat: ComercialCategoria, newParentId: string | null) => {
    if (!user) {
      setTree((prev) => {
        const exists = prev.catOverrides.find((o) => o.cat === cat);
        const next = {
          ...prev,
          catOverrides: exists
            ? prev.catOverrides.map((o) => o.cat === cat ? { ...o, parentId: newParentId } : o)
            : [...prev.catOverrides, { cat, parentId: newParentId }],
        };
        lsSave(next);
        return next;
      });
      return;
    }
    const { error } = await overridesTable()
      .upsert({ user_id: user.id, cat, parent_id: newParentId });
    if (error) { console.error("moveCatTo:", error); return; }
    setTree((prev) => {
      const exists = prev.catOverrides.find((o) => o.cat === cat);
      return {
        ...prev,
        catOverrides: exists
          ? prev.catOverrides.map((o) => o.cat === cat ? { ...o, parentId: newParentId } : o)
          : [...prev.catOverrides, { cat, parentId: newParentId }],
      };
    });
  }, [user]);

  return { tree, loading, createFolder, renameFolder, deleteFolder, moveFolderTo, moveCatTo };
}
