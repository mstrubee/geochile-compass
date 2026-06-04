/**
 * useHeatmapSettings
 * ==================
 * Lee y escribe la configuración visual de capas heatmap desde Supabase.
 * Admin puede ajustar en tiempo real y guardar para todos los usuarios.
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface HeatmapSettings {
  min_zoom: number;
  radius:   number;
  blur:     number;
  opacity:  number;
}

export const DEFAULT_SETTINGS: Record<string, HeatmapSettings> = {
  commercial: { min_zoom: 12, radius: 20, blur: 15, opacity: 0.70 },
  crime:      { min_zoom: 8,  radius: 35, blur: 28, opacity: 0.65 },
};

export function useHeatmapSettings(layerKey: string) {
  const [settings, setSettings] = useState<HeatmapSettings>(
    DEFAULT_SETTINGS[layerKey] ?? DEFAULT_SETTINGS.commercial
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Cargar desde Supabase al montar
  useEffect(() => {
    supabase
      .from("heatmap_layer_settings")
      .select("min_zoom, radius, blur, opacity")
      .eq("layer_key", layerKey)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) { console.warn("[heatmapSettings]", err.message); return; }
        if (data) {
          setSettings({
            min_zoom: Number(data.min_zoom),
            radius:   Number(data.radius),
            blur:     Number(data.blur),
            opacity:  Number(data.opacity),
          });
        }
      });
  }, [layerKey]);

  // Guardar en Supabase (solo admins por RLS)
  const save = useCallback(async (s: HeatmapSettings) => {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("heatmap_layer_settings")
      .upsert({
        layer_key: layerKey,
        ...s,
        updated_at: new Date().toISOString(),
      }, { onConflict: "layer_key" });

    setSaving(false);
    if (err) {
      setError(err.message);
      console.error("[heatmapSettings] save error:", err);
    } else {
      setSettings(s);
    }
  }, [layerKey]);

  return { settings, setSettings, save, saving, error };
}
