/**
 * useComercialCategorias
 * ─────────────────────────
 * Carga y gestiona las categorías de la Red Comercial Nacional desde la tabla
 * `comercial_categorias`. Soporta CRUD completo y reordenamiento via sort_order.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoriaEntry {
  id:          number;
  key:         string;
  label_es:    string;
  icon_emoji:  string;
  color_hex:   string;
  osm_tags:    unknown;
  sort_order:  number;
  activo:      boolean;
  created_at:  string | null;
}

export interface CategoriaInsert {
  key:        string;
  label_es:   string;
  icon_emoji?: string;
  color_hex?:  string;
  osm_tags?:   unknown;
  sort_order?: number;
  activo?:     boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useComercialCategorias(onlyActivo = true) {
  const [categorias, setCategorias] = useState<CategoriaEntry[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);

  // ── Carga ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("comercial_categorias")
      .select("*")
      .order("sort_order")
      .order("label_es");

    if (onlyActivo) q = (q as ReturnType<typeof q.eq>).eq("activo", true);

    const { data, error } = await q;
    if (error) console.error("useComercialCategorias load:", error.message);
    else setCategorias((data ?? []) as CategoriaEntry[]);
    setLoading(false);
  }, [onlyActivo]);

  useEffect(() => { load(); }, [load]);

  // ── Insert ─────────────────────────────────────────────────────────────────

  const insert = useCallback(async (entry: CategoriaInsert): Promise<boolean> => {
    setSaving(true);
    const maxOrder = categorias.length ? Math.max(...categorias.map(c => c.sort_order)) : 0;
    const { error } = await supabase.from("comercial_categorias").insert({
      ...entry,
      icon_emoji: entry.icon_emoji ?? "📍",
      color_hex:  entry.color_hex  ?? "#6B7280",
      sort_order: entry.sort_order ?? maxOrder + 1,
      activo:     entry.activo ?? true,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(`Categoría "${entry.label_es}" creada`);
    await load();
    return true;
  }, [load, categorias]);

  // ── Update ─────────────────────────────────────────────────────────────────

  const update = useCallback(async (id: number, patch: Partial<CategoriaInsert>): Promise<boolean> => {
    setSaving(true);
    const { error } = await supabase.from("comercial_categorias").update(patch).eq("id", id);
    setSaving(false);
    if (error) { toast.error(error.message); return false; }
    await load();
    return true;
  }, [load]);

  // ── Delete ─────────────────────────────────────────────────────────────────

  const remove = useCallback(async (id: number): Promise<boolean> => {
    setSaving(true);
    const { error } = await supabase.from("comercial_categorias").delete().eq("id", id);
    setSaving(false);
    if (error) { toast.error(error.message); return false; }
    toast.success("Categoría eliminada");
    await load();
    return true;
  }, [load]);

  // ── Toggle activo ──────────────────────────────────────────────────────────

  const toggleActivo = useCallback(async (id: number, activo: boolean): Promise<boolean> => {
    const { error } = await supabase.from("comercial_categorias").update({ activo }).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    setCategorias(prev => prev.map(c => c.id === id ? { ...c, activo } : c));
    return true;
  }, []);

  // ── Reorder (drag-and-drop) ────────────────────────────────────────────────

  const reorder = useCallback(async (ordered: CategoriaEntry[]): Promise<boolean> => {
    // Actualización optimista
    setCategorias(ordered.map((c, i) => ({ ...c, sort_order: i + 1 })));

    // Persistir en DB (en paralelo, un update por fila)
    const results = await Promise.all(
      ordered.map((cat, i) =>
        supabase.from("comercial_categorias").update({ sort_order: i + 1 }).eq("id", cat.id)
      )
    );
    const failed = results.find(r => r.error);
    if (failed?.error) {
      toast.error("Error guardando orden: " + failed.error.message);
      await load(); // revertir
      return false;
    }
    return true;
  }, [load]);

  return { categorias, loading, saving, reload: load, insert, update, remove, toggleActivo, reorder };
}
