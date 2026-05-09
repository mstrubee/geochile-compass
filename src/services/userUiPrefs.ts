/**
 * Per-user UI preferences (sidebar collapsed sections, KPI orders, etc.)
 *
 * - Hidrata desde localStorage al instante (sin flicker).
 * - Trae el snapshot del servidor en background y notifica a los suscriptores.
 * - Escribe al servidor con debounce (400ms) — agrupa cambios rápidos.
 */
import { supabase } from "@/integrations/supabase/client";

const LS_KEY = "user_ui_prefs_cache_v1";

let cache: Record<string, unknown> = {};
let loadPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const readLocal = (): Record<string, unknown> => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

cache = readLocal();

const persistLocal = () => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    /* noop */
  }
};

const emit = () => listeners.forEach((fn) => fn());

export const subscribePrefs = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const ensurePrefsLoaded = (): Promise<void> => {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      const { data, error } = await supabase
        .from("user_ui_prefs")
        .select("data")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !data) return;
      const remote = (data.data as Record<string, unknown>) ?? {};
      // Server is source of truth for keys it knows about; local-only keys are kept.
      cache = { ...cache, ...remote };
      persistLocal();
      emit();
    } catch {
      /* offline / not signed in — ignore */
    }
  })();
  return loadPromise;
};

export const getPref = <T = unknown>(key: string): T | undefined =>
  cache[key] as T | undefined;

export const setPref = <T>(key: string, value: T) => {
  cache = { ...cache, [key]: value };
  persistLocal();
  emit();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      await supabase
        .from("user_ui_prefs")
        .upsert(
          { user_id: user.id, data: cache as never },
          { onConflict: "user_id" },
        );
    } catch {
      /* network error — local cache still has the change */
    }
  }, 400);
};
