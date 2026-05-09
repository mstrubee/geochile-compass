import { supabase } from "@/integrations/supabase/client";
import type { AnalysisSettings, ComplementWeightRule } from "@/types/analysis";

/**
 * CRUD de la configuración de análisis por carpeta y de las reglas
 * globales/por-carpeta de pesos para complementarios.
 */

/* ------------------ Analysis settings ------------------ */

export const fetchAnalysisSettings = async (
  folderId: string,
): Promise<AnalysisSettings | null> => {
  const { data, error } = await supabase
    .from("analysis_settings")
    .select("*")
    .eq("folder_id", folderId)
    .maybeSingle();
  if (error) {
    console.warn("[fetchAnalysisSettings]", error.message);
    return null;
  }
  return (data ?? null) as AnalysisSettings | null;
};

export const upsertAnalysisSettings = async (
  s: Partial<AnalysisSettings> & { folder_id: string },
): Promise<AnalysisSettings> => {
  const { data, error } = await supabase
    .from("analysis_settings")
    .upsert(s, { onConflict: "folder_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as AnalysisSettings;
};

/**
 * Bumps `config_version` para invalidar las cachés
 * `poi_features_cache` y `poi_performance_analysis`.
 */
export const bumpConfigVersion = async (folderId: string): Promise<number> => {
  const current = await fetchAnalysisSettings(folderId);
  const next = (current?.config_version ?? 0) + 1;
  await upsertAnalysisSettings({ folder_id: folderId, config_version: next });
  return next;
};

/* ------------------ Complement weight rules ------------------ */

export const fetchComplementRules = async (
  folderId: string | null,
): Promise<ComplementWeightRule[]> => {
  // Trae las globales (folder_id IS NULL) + las específicas de la carpeta.
  let query = supabase
    .from("complement_weight_rules")
    .select("*")
    .eq("enabled", true)
    .order("priority", { ascending: true });
  if (folderId) {
    query = query.or(`folder_id.is.null,folder_id.eq.${folderId}`);
  } else {
    query = query.is("folder_id", null);
  }
  const { data, error } = await query;
  if (error) {
    console.warn("[fetchComplementRules]", error.message);
    return [];
  }
  return (data ?? []) as unknown as ComplementWeightRule[];
};

export const upsertComplementRule = async (
  r: Partial<ComplementWeightRule> & { pattern: string; weight: number },
): Promise<ComplementWeightRule> => {
  const { data, error } = await supabase
    .from("complement_weight_rules")
    .upsert(r)
    .select("*")
    .single();
  if (error) throw error;
  return data as ComplementWeightRule;
};

export const deleteComplementRule = async (id: string): Promise<void> => {
  const { error } = await supabase
    .from("complement_weight_rules")
    .delete()
    .eq("id", id);
  if (error) throw error;
};

/* ------------------ Aplicación de reglas ------------------ */

/**
 * Pre-compila las reglas a `RegExp` y las ordena por priority asc.
 * Ejecutar este paso una vez por sesión (caché en componente / hook).
 */
export interface CompiledRule {
  id: string;
  regex: RegExp;
  weight: number;
  label: string | null;
  priority: number;
  folder_id: string | null;
}

export const compileRules = (rules: ComplementWeightRule[]): CompiledRule[] => {
  const compiled: CompiledRule[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    let regex: RegExp;
    try {
      // Si el patrón ya viene con flags inline (?i), lo dejamos. Si no,
      // lo agregamos a mano para case-insensitive por defecto.
      const hasFlag = /^\(\?[a-z]+\)/.test(r.pattern);
      regex = hasFlag ? new RegExp(r.pattern) : new RegExp(r.pattern, "i");
    } catch (e) {
      console.warn(`[compileRules] regex inválido id=${r.id}:`, r.pattern);
      continue;
    }
    compiled.push({
      id: r.id,
      regex,
      weight: r.weight,
      label: r.label,
      priority: r.priority,
      folder_id: r.folder_id,
    });
  }
  return compiled.sort((a, b) => a.priority - b.priority);
};

/**
 * Devuelve el peso que aplica al texto entregado. Default 0.3 si no
 * matchea ninguna regla (= "complemento neutro").
 */
export interface RuleMatch {
  weight: number;
  label: string;
  matched: boolean;
  ruleId: string | null;
}

export const matchRule = (
  text: string,
  compiled: CompiledRule[],
  defaultWeight = 0.3,
  defaultLabel = "Genérico",
): RuleMatch => {
  if (!text) return { weight: defaultWeight, label: defaultLabel, matched: false, ruleId: null };
  for (const r of compiled) {
    if (r.regex.test(text)) {
      return {
        weight: r.weight,
        label: r.label ?? "Match",
        matched: true,
        ruleId: r.id,
      };
    }
  }
  return { weight: defaultWeight, label: defaultLabel, matched: false, ruleId: null };
};
