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

// Marca reubicada dentro de una carpeta/categoría/raíz (organización personalizada)
export interface BrandOverride {
  cat: ComercialCategoria;
  marca: string;
  parentId: string | null;
}

export interface ComercialTree {
  folders: Carpeta[];
  catOverrides: CatOverride[];
  brandOverrides: BrandOverride[];
}

const EMPTY_TREE: ComercialTree = { folders: [], catOverrides: [], brandOverrides: [] };

// ── Helpers ───────────────────────────────────────────────────────────────────

const LS_KEY = "geochile_comercial_tree_v1";

function lsLoad(): ComercialTree {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "null");
    if (!raw) return { ...EMPTY_TREE };
    // Normaliza estados antiguos que no tenían brandOverrides
    return {
      folders: raw.folders ?? [],
      catOverrides: raw.catOverrides ?? [],
      brandOverrides: raw.brandOverrides ?? [],
    };
  } catch {
    return { ...EMPTY_TREE };
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brandOverridesTable = () => (supabase as any).from("comercial_marca_overrides");

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useComercialFolders() {
  const { user } = useAuth();
  const [tree, setTree]       = useState<ComercialTree>({ ...EMPTY_TREE });
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
      brandOverridesTable().select("cat, marca, parent_id").eq("user_id", user.id),
    ]).then(([f, o, b]: [any, any, any]) => {
      if (f.error || o.error) {
        // Tablas aún no creadas (migración pendiente) → usar localStorage
        console.warn("comercial_carpetas no disponible, usando localStorage:", f.error ?? o.error);
        setTree(lsLoad());
        return;
      }
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
        // tabla de marcas puede no existir aún (migración pendiente):
        // en ese caso recuperamos desde localStorage (moveBrandTo guarda ahí como respaldo)
        // para no perder las marcas movidas al recargar.
        brandOverrides: b.error
          ? (lsLoad().brandOverrides ?? [])
          : (b.data ?? []).map((r: any) => ({
              cat: r.cat as ComercialCategoria,
              marca: r.marca,
              parentId: r.parent_id ?? null,
            })),
      });
    }).catch(() => {
      setTree(lsLoad());
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
    if (error) {
      // Fallback: usar UUID local si la tabla aún no existe
      const id = crypto.randomUUID();
      setTree((prev) => { const next = { ...prev, folders: [...prev.folders, { id, nombre: trimmed, parentId }] }; lsSave(next); return next; });
      return;
    }
    setTree((prev) => {
      const next = { ...prev, folders: [...prev.folders, { id: data.id, nombre: data.nombre, parentId: data.parent_id ?? null }] };
      lsSave(next); // respaldo local: sobrevive a un re-disparo del efecto de carga
      return next;
    });
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
    if (error) console.warn("renameFolder (DB):", error);
    setTree((prev) => { const next = { ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, nombre } : f) }; if (error) lsSave(next); return next; });
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
          brandOverrides: prev.brandOverrides.map((o) =>
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

    // Reparentar marcas huérfanas
    let brandErr: unknown = null;
    const brandOrphans = tree.brandOverrides.filter((o) => dead.has(o.parentId ?? ""));
    if (brandOrphans.length > 0) {
      const { error } = await brandOverridesTable().upsert(
        brandOrphans.map((o) => ({ user_id: user.id, cat: o.cat, marca: o.marca, parent_id: parentId })),
      );
      brandErr = error;
    }

    setTree((prev) => {
      const next = {
        folders: prev.folders.filter((f) => !dead.has(f.id)),
        catOverrides: prev.catOverrides.map((o) =>
          dead.has(o.parentId ?? "") ? { ...o, parentId } : o,
        ),
        brandOverrides: prev.brandOverrides.map((o) =>
          dead.has(o.parentId ?? "") ? { ...o, parentId } : o,
        ),
      };
      // Si la tabla de marcas aún no existe, persistir en localStorage para sobrevivir al recargo
      if (brandErr) lsSave(next);
      return next;
    });
  }, [user, tree.folders, tree.catOverrides, tree.brandOverrides]);

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
    if (error) console.warn("moveFolderTo (DB):", error);
    setTree((prev) => { const next = { ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, parentId: newParentId } : f) }; if (error) lsSave(next); return next; });
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
    if (error) console.warn("moveCatTo (DB):", error);
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

  const moveBrandTo = useCallback(async (cat: ComercialCategoria, marca: string, newParentId: string | null) => {
    // Mover una marca a su propia categoría = quitar el override (vuelve a la lista de la categoría)
    const backHome = newParentId === cat;

    const applyLocal = (prev: ComercialTree): ComercialTree => {
      const without = prev.brandOverrides.filter((o) => !(o.cat === cat && o.marca === marca));
      return {
        ...prev,
        brandOverrides: backHome ? without : [...without, { cat, marca, parentId: newParentId }],
      };
    };

    if (!user) {
      setTree((prev) => { const next = applyLocal(prev); lsSave(next); return next; });
      return;
    }

    const { error } = backHome
      ? await brandOverridesTable().delete().eq("user_id", user.id).eq("cat", cat).eq("marca", marca)
      : await brandOverridesTable().upsert({ user_id: user.id, cat, marca, parent_id: newParentId });
    if (error) console.warn("moveBrandTo (DB):", error);
    setTree((prev) => { const next = applyLocal(prev); if (error) lsSave(next); return next; });
  }, [user]);

  const resetTree = useCallback(async () => {
    const empty: ComercialTree = { ...EMPTY_TREE };
    if (user) {
      await carpetasTable().delete().eq("user_id", user.id);
      await overridesTable().delete().eq("user_id", user.id);
      await brandOverridesTable().delete().eq("user_id", user.id);
    }
    lsSave(empty);
    setTree(empty);
  }, [user]);

  return { tree, loading, createFolder, renameFolder, deleteFolder, moveFolderTo, moveCatTo, moveBrandTo, resetTree };
}
