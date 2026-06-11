/**
 * useCustomLayers.ts
 * ───────────────────
 * Hook para cargar, guardar y eliminar capas personalizadas desde Supabase.
 * Las capas se guardan en la tabla `custom_layers` (JSONB con FeatureCollection).
 *
 * Tabla requerida (aplicar en Supabase SQL Editor):
 *
 *   CREATE TABLE IF NOT EXISTS custom_layers (
 *     id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
 *     name          text    NOT NULL,
 *     color_hex     text    NOT NULL DEFAULT '#3B82F6',
 *     icon_emoji    text    DEFAULT '📍',
 *     geojson       jsonb   NOT NULL,
 *     feature_count int     DEFAULT 0,
 *     activo        boolean DEFAULT true,
 *     created_at    timestamptz DEFAULT now()
 *   );
 *   ALTER TABLE custom_layers ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "public_read"  ON custom_layers FOR SELECT USING (true);
 *   CREATE POLICY "auth_write"   ON custom_layers FOR ALL   USING (auth.role() = 'authenticated');
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { FeatureCollection } from "geojson";
import type { UserLayer } from "@/types/userLayers";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface CustomLayer {
  id: string;
  name: string;
  color_hex: string;
  icon_emoji: string;
  geojson: FeatureCollection;
  feature_count: number;
  activo: boolean;
  created_at: string;
}

export interface CustomLayerInsert {
  name: string;
  color_hex: string;
  icon_emoji?: string;
  geojson: FeatureCollection;
  feature_count: number;
}

// Acceso sin tipos generados (tabla nueva no está en supabase/types.ts)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = () => (supabase as any).from("custom_layers");

// ── Conversión a UserLayer (para el mapa) ─────────────────────────────────────

export function toUserLayer(cl: CustomLayer, visible: boolean): UserLayer {
  return {
    id: `cl_${cl.id}`,
    name: cl.name,
    color: cl.color_hex,
    visible,
    data: cl.geojson,
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useCustomLayers() {
  const [layers, setLayers] = useState<CustomLayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  // Visibilidad local (no persiste, vuelve al valor `activo` al recargar)
  const [visMap, setVisMap] = useState<Record<string, boolean>>({});

  // ── Cargar desde DB ──────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await tbl()
        .select("id,name,color_hex,icon_emoji,feature_count,activo,created_at")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setLayers((data ?? []) as CustomLayer[]);
    } catch (e) {
      // La tabla aún no existe → ignorar silenciosamente
      const msg = (e as { message?: string }).message ?? String(e);
      if (!msg.includes('relation "custom_layers" does not exist')) {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ── Guardar nueva capa ───────────────────────────────────────────────────

  const addLayer = useCallback(async (meta: CustomLayerInsert): Promise<string | null> => {
    try {
      const { data, error: err } = await tbl()
        .insert({
          name:          meta.name,
          color_hex:     meta.color_hex,
          icon_emoji:    meta.icon_emoji ?? "📍",
          geojson:       meta.geojson,
          feature_count: meta.feature_count,
        })
        .select("id")
        .single();
      if (err) throw err;
      await reload();
      return (data as { id: string }).id;
    } catch (e) {
      throw new Error((e as { message?: string }).message ?? "Error al guardar la capa");
    }
  }, [reload]);

  // ── Eliminar ─────────────────────────────────────────────────────────────

  const deleteLayer = useCallback(async (id: string) => {
    await tbl().delete().eq("id", id);
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setVisMap((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  // ── Toggle visibilidad local ─────────────────────────────────────────────

  const toggleVisibility = useCallback((id: string) => {
    setVisMap((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  }, []);

  // ── Capas en formato UserLayer para el mapa ──────────────────────────────

  const asUserLayers: UserLayer[] = layers
    .filter((l) => l.activo)
    .map((l) => toUserLayer(l, visMap[l.id] ?? true));

  return {
    layers,
    loading,
    error,
    asUserLayers,
    addLayer,
    deleteLayer,
    toggleVisibility,
    visMap,
    reload,
  };
}
