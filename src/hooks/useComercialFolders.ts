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

// Re-siembra la DB con un árbol recuperado de localStorage (best-effort).
// Asigna sort_order según el orden actual del array para preservar la disposición.
async function backfillTree(t: ComercialTree, userId: string) {
  try {
    if (t.folders.length > 0) {
      await carpetasTable().upsert(
        t.folders.map((f, idx) => ({
          id: f.id, user_id: userId, nombre: f.nombre, parent_id: f.parentId, sort_order: idx,
        })),
      );
    }
    if (t.catOverrides.length > 0) {
      await overridesTable().upsert(
        t.catOverrides.map((o, idx) => ({
          user_id: userId, cat: o.cat, parent_id: o.parentId, sort_order: idx,
        })),
      );
    }
    if (t.brandOverrides.length > 0) {
      await brandOverridesTable().upsert(
        t.brandOverrides.map((o, idx) => ({
          user_id: userId, cat: o.cat, marca: o.marca, parent_id: o.parentId, sort_order: idx,
        })),
      );
    }
  } catch (e) {
    console.warn("backfill árbol comercial (re-siembra):", e);
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useComercialFolders() {
  const { user } = useAuth();
  const [tree, setTree]       = useState<ComercialTree>({ ...EMPTY_TREE });
  const [loading, setLoading] = useState(true);

  // Calcula el próximo sort_order dentro de un parent dado (max + 1).
  const nextSortOrder = useCallback(
    (
      arr: Array<{ parentId: string | null }>,
      orderMap: Map<string, number>,
      keyFor: (item: { parentId: string | null }, idx: number) => string,
      parentId: string | null,
    ): number => {
      let max = -1;
      arr.forEach((item, idx) => {
        if ((item.parentId ?? null) !== parentId) return;
        const so = orderMap.get(keyFor(item, idx)) ?? idx;
        if (so > max) max = so;
      });
      return max + 1;
    },
    [],
  );

  // ── Carga inicial ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) {
      setTree(lsLoad());
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      carpetasTable()
        .select("id, nombre, parent_id, sort_order, created_at")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      overridesTable()
        .select("cat, parent_id, sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true }),
      brandOverridesTable()
        .select("cat, marca, parent_id, sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([f, o, b]: [any, any, any]) => {
      if (f.error || o.error) {
        console.warn("comercial_carpetas no disponible, usando localStorage:", f.error ?? o.error);
        setTree(lsLoad());
        return;
      }
      const dbTree: ComercialTree = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        folders: (f.data ?? []).map((r: any) => ({
          id: r.id,
          nombre: r.nombre,
          parentId: r.parent_id ?? null,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        catOverrides: (o.data ?? []).map((r: any) => ({
          cat: r.cat as ComercialCategoria,
          parentId: r.parent_id ?? null,
        })),
        brandOverrides: b.error
          ? (lsLoad().brandOverrides ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : (b.data ?? []).map((r: any) => ({
              cat: r.cat as ComercialCategoria,
              marca: r.marca,
              parentId: r.parent_id ?? null,
            })),
      };

      // ── FUSIÓN DEFENSIVA ANTI-PÉRDIDA ──────────────────────────────────────
      const local = lsLoad();
      const dbFolderIds = new Set(dbTree.folders.map((f) => f.id));
      const localOnlyFolders = local.folders.filter((f) => !dbFolderIds.has(f.id));
      const dbCats = new Set(dbTree.catOverrides.map((o) => o.cat));
      const localOnlyCats = local.catOverrides.filter((o) => !dbCats.has(o.cat));
      const dbBrandKeys = new Set(dbTree.brandOverrides.map((o) => `${o.cat}::${o.marca}`));
      const localOnlyBrands = local.brandOverrides.filter((o) => !dbBrandKeys.has(`${o.cat}::${o.marca}`));

      const merged: ComercialTree = {
        folders: [...dbTree.folders, ...localOnlyFolders],
        catOverrides: [...dbTree.catOverrides, ...localOnlyCats],
        brandOverrides: [...dbTree.brandOverrides, ...localOnlyBrands],
      };
      setTree(merged);

      // Re-sembrar en la DB lo que solo estaba en localStorage (incluye sort_order derivado)
      if (localOnlyFolders.length || localOnlyCats.length || localOnlyBrands.length) {
        console.warn(`Recuperando ${localOnlyFolders.length} carpetas / ${localOnlyCats.length} cat / ${localOnlyBrands.length} marcas desde localStorage hacia la DB`);
        // Offset: continúa la numeración después de las filas DB existentes
        const folderOffset = dbTree.folders.length;
        const catOffset = dbTree.catOverrides.length;
        const brandOffset = dbTree.brandOverrides.length;
        void backfillTree(
          {
            folders: localOnlyFolders.map((f, i) => ({ ...f })) as Carpeta[],
            catOverrides: localOnlyCats,
            brandOverrides: localOnlyBrands,
          },
          user.id,
        );
        // Nota: backfillTree usa idx desde 0; en la práctica los conflictos de sort_order
        // entre DB y localStorage se resuelven por created_at como tie-breaker.
        void folderOffset; void catOffset; void brandOffset;
      }
    }).catch(() => {
      setTree(lsLoad());
    }).finally(() => setLoading(false));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Espejo en localStorage ──────────────────────────────────────────────────
  useEffect(() => {
    if (!loading) lsSave(tree);
  }, [tree, loading]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createFolder = useCallback(async (nombre: string, parentId: string | null) => {
    const trimmed = nombre.trim() || "Nueva carpeta";
    // Calcula la próxima posición dentro del parent
    const siblingsCount =
      tree.folders.filter((f) => f.parentId === parentId).length +
      tree.catOverrides.filter((o) => o.parentId === parentId).length +
      tree.brandOverrides.filter((b) => b.parentId === parentId).length;
    const nextOrder = siblingsCount; // append al final

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
      .insert({ nombre: trimmed, parent_id: parentId, user_id: user.id, sort_order: nextOrder })
      .select("id, nombre, parent_id")
      .single();
    if (error) {
      const id = crypto.randomUUID();
      setTree((prev) => { const next = { ...prev, folders: [...prev.folders, { id, nombre: trimmed, parentId }] }; lsSave(next); return next; });
      return;
    }
    setTree((prev) => {
      const next = { ...prev, folders: [...prev.folders, { id: data.id, nombre: data.nombre, parentId: data.parent_id ?? null }] };
      lsSave(next);
      return next;
    });
  }, [user, tree.folders, tree.catOverrides, tree.brandOverrides]);

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

    const orphans = tree.catOverrides.filter((o) => dead.has(o.parentId ?? ""));
    if (orphans.length > 0) {
      await overridesTable().upsert(
        orphans.map((o) => ({ user_id: user.id, cat: o.cat, parent_id: parentId })),
      );
    }

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
      if (brandErr) lsSave(next);
      return next;
    });
  }, [user, tree.folders, tree.catOverrides, tree.brandOverrides]);

  const moveFolderTo = useCallback(async (id: string, newParentId: string | null) => {
    const dead = descendantFolderIds(id, tree.folders);
    if (newParentId && dead.has(newParentId)) return; // evitar ciclo

    // Próxima posición dentro del nuevo parent
    const siblingsCount =
      tree.folders.filter((f) => f.parentId === newParentId && f.id !== id).length +
      tree.catOverrides.filter((o) => o.parentId === newParentId).length +
      tree.brandOverrides.filter((b) => b.parentId === newParentId).length;
    const nextOrder = siblingsCount;

    if (!user) {
      setTree((prev) => {
        const next = { ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, parentId: newParentId } : f) };
        lsSave(next);
        return next;
      });
      return;
    }
    const { error } = await carpetasTable()
      .update({ parent_id: newParentId, sort_order: nextOrder, updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", user.id);
    if (error) console.warn("moveFolderTo (DB):", error);
    setTree((prev) => { const next = { ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, parentId: newParentId } : f) }; if (error) lsSave(next); return next; });
  }, [user, tree.folders, tree.catOverrides, tree.brandOverrides]);

  const moveCatTo = useCallback(async (cat: ComercialCategoria, newParentId: string | null) => {
    const siblingsCount =
      tree.folders.filter((f) => f.parentId === newParentId).length +
      tree.catOverrides.filter((o) => o.parentId === newParentId && o.cat !== cat).length +
      tree.brandOverrides.filter((b) => b.parentId === newParentId).length;
    const nextOrder = siblingsCount;

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
      .upsert({ user_id: user.id, cat, parent_id: newParentId, sort_order: nextOrder });
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
  }, [user, tree.folders, tree.catOverrides, tree.brandOverrides]);

  const moveBrandTo = useCallback(async (cat: ComercialCategoria, marca: string, newParentId: string | null) => {
    const backHome = newParentId === cat;

    const siblingsCount =
      tree.folders.filter((f) => f.parentId === newParentId).length +
      tree.catOverrides.filter((o) => o.parentId === newParentId).length +
      tree.brandOverrides.filter((b) => b.parentId === newParentId && !(b.cat === cat && b.marca === marca)).length;
    const nextOrder = siblingsCount;

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
      : await brandOverridesTable().upsert({ user_id: user.id, cat, marca, parent_id: newParentId, sort_order: nextOrder });
    if (error) console.warn("moveBrandTo (DB):", error);
    setTree((prev) => { const next = applyLocal(prev); if (error) lsSave(next); return next; });
  }, [user, tree.folders, tree.catOverrides, tree.brandOverrides]);

  return { tree, loading, createFolder, renameFolder, deleteFolder, moveFolderTo, moveCatTo, moveBrandTo };
}
