/**
 * useBrandCatalog — CRUD para la tabla brand_catalog.
 * Permite al admin agregar, editar y eliminar reglas de normalización de marcas OSM.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface BrandEntry {
  id:             number;
  raw_name:       string;
  marca_estandar: string;
  categoria:      string;
  subcategoria:   string | null;
  color_hex:      string | null;
  icon_emoji:     string | null;
  logo_url:       string | null;
  activo:         boolean | null;
  created_at:     string | null;
}

export interface BrandInsert {
  raw_name:       string;
  marca_estandar: string;
  categoria:      string;
  subcategoria?:  string | null;
  color_hex?:     string;
  icon_emoji?:    string;
  logo_url?:      string | null;
  activo?:        boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useBrandCatalog(categoriaFilter?: string | null) {
  const [entries,  setEntries]  = useState<BrandEntry[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // ── Carga ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("brand_catalog")
      .select("*")
      .order("marca_estandar")
      .order("raw_name") as any;

    if (categoriaFilter) q = q.eq("categoria", categoriaFilter);

    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setEntries((data ?? []) as BrandEntry[]);
    setLoading(false);
  }, [categoriaFilter]);

  useEffect(() => { load(); }, [load]);

  // ── Insert ───────────────────────────────────────────────────────────────

  const insert = useCallback(async (entry: BrandInsert): Promise<boolean> => {
    setSaving(true);
    const { error: err } = await supabase.from("brand_catalog").insert({
      ...entry,
      activo: entry.activo ?? true,
    });
    setSaving(false);
    if (err) { toast.error(err.message); return false; }
    toast.success(`Marca "${entry.marca_estandar}" agregada`);
    await load();
    return true;
  }, [load]);

  // ── Update ───────────────────────────────────────────────────────────────

  const update = useCallback(async (id: number, patch: Partial<BrandInsert>): Promise<boolean> => {
    setSaving(true);
    const { error: err } = await supabase.from("brand_catalog").update(patch).eq("id", id);
    setSaving(false);
    if (err) { toast.error(err.message); return false; }
    toast.success("Marca actualizada");
    await load();
    return true;
  }, [load]);

  // ── Delete ───────────────────────────────────────────────────────────────

  const remove = useCallback(async (id: number): Promise<boolean> => {
    setSaving(true);
    const { error: err } = await supabase.from("brand_catalog").delete().eq("id", id);
    setSaving(false);
    if (err) { toast.error(err.message); return false; }
    toast.success("Marca eliminada");
    await load();
    return true;
  }, [load]);

  // ── Bulk upsert ──────────────────────────────────────────────────────────

  const bulkInsert = useCallback(async (rows: BrandInsert[]): Promise<boolean> => {
    if (!rows.length) return true;
    setSaving(true);
    const { error: err } = await supabase
      .from("brand_catalog")
      .upsert(rows.map(r => ({ ...r, activo: r.activo ?? true })), { onConflict: "raw_name" });
    setSaving(false);
    if (err) { toast.error(err.message); return false; }
    toast.success(`${rows.length} marcas guardadas`);
    await load();
    return true;
  }, [load]);

  // ── Toggle activo ────────────────────────────────────────────────────────

  const toggleActivo = useCallback(async (id: number, activo: boolean): Promise<boolean> => {
    const { error: err } = await supabase.from("brand_catalog").update({ activo }).eq("id", id);
    if (err) { toast.error(err.message); return false; }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, activo } : e));
    return true;
  }, []);

  return { entries, loading, saving, error, reload: load, insert, update, remove, bulkInsert, toggleActivo };
}
