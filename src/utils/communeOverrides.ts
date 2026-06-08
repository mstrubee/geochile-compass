/**
 * communeOverrides.ts
 * ===================
 * Gestión de posiciones personalizadas de globos de comunas.
 *
 * Estrategia dual: localStorage (caché inmediata) + Supabase (fuente de verdad).
 * Supabase persiste entre sesiones y dispositivos.
 */

import { supabase } from "@/integrations/supabase/client";

const LS_KEY = "commune_coord_overrides_v1";

export type CoordOverride  = { lat: number; lng: number };
export type CoordOverrides = Record<string, CoordOverride>;

// ── localStorage ──────────────────────────────────────────────────────────────

export const loadCommuneOverrides = (): CoordOverrides => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CoordOverrides;
  } catch {
    return {};
  }
};

const persistLS = (all: CoordOverrides): void => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* quota */ }
};

// ── Supabase ──────────────────────────────────────────────────────────────────

/** Carga overrides desde Supabase (fuente de verdad). */
export const loadCommuneOverridesFromSupabase = async (): Promise<CoordOverrides> => {
  try {
    const { data, error } = await supabase
      .from("commune_coord_overrides")
      .select("name, lat, lng");
    if (error) { console.warn("[communeOverrides]", error.message); return {}; }
    const result: CoordOverrides = {};
    for (const row of data ?? [])
      result[row.name] = { lat: Number(row.lat), lng: Number(row.lng) };
    // Sincronizar localStorage con lo que vino de Supabase
    const merged = { ...loadCommuneOverrides(), ...result };
    persistLS(merged);
    return result;
  } catch (e) {
    console.warn("[communeOverrides] Supabase load failed:", e);
    return {};
  }
};

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Guarda nueva posición.
 * - localStorage: inmediato (sin espera)
 * - Supabase: en background (persiste entre sesiones/dispositivos)
 */
export const saveCommuneOverride = (name: string, lat: number, lng: number): void => {
  // 1. localStorage inmediato
  const all = loadCommuneOverrides();
  all[name] = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  persistLS(all);

  // 2. Supabase en background
  void supabase
    .from("commune_coord_overrides")
    .upsert({ name, lat: +lat.toFixed(6), lng: +lng.toFixed(6) }, { onConflict: "name" })
    .then(({ error }) => {
      if (error) console.warn("[communeOverrides] save error:", error.message);
    });
};

export const clearCommuneOverride = (name: string): void => {
  const all = loadCommuneOverrides();
  delete all[name];
  persistLS(all);

  void supabase
    .from("commune_coord_overrides")
    .delete()
    .eq("name", name)
    .then(({ error }) => {
      if (error) console.warn("[communeOverrides] delete error:", error.message);
    });
};

export const exportOverridesAsJson = (): string =>
  JSON.stringify(loadCommuneOverrides(), null, 2);
