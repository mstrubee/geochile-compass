import { supabase } from "@/integrations/supabase/client";

export type TerritorialRole = "competencia" | "complementario" | "ancla" | "irrelevante";

export const ROLE_WEIGHTS: Record<TerritorialRole, number> = {
  competencia: -1.0,
  complementario: 0.5,
  ancla: 1.5,
  irrelevante: 0.0,
};

export const ROLE_LABELS: Record<TerritorialRole, string> = {
  competencia: "Competencia",
  complementario: "Complementario",
  ancla: "Ancla",
  irrelevante: "Irrelevante",
};

export const ALL_ROLES: TerritorialRole[] = [
  "competencia",
  "complementario",
  "ancla",
  "irrelevante",
];

/**
 * Defaults por slug de categoría territorial. Se usan cuando no hay
 * fila en folder_layer_roles para esa categoría.
 */
export const DEFAULT_GROUP_ROLES: Record<string, TerritorialRole> = {
  servitecas: "competencia",
  "mejoramiento-hogar": "competencia",
  farmacias: "complementario",
  "supermercados-grandes": "complementario",
  "supermercados-regional": "complementario",
  "estaciones-servicio": "complementario",
  "parque-automotriz": "complementario",
  talleres: "ancla",
  "tiendas-conveniencia": "irrelevante",
  retail: "irrelevante",
  "otros-locales": "irrelevante",
  "sin-clasificar": "irrelevante",
};

export interface FolderLayerRoleRow {
  id: string;
  folder_id: string;
  group_id: string | null;
  layer_id: string | null;
  role: TerritorialRole;
  weight_override: number | null;
  created_at: string;
  updated_at: string;
}

export const fetchFolderLayerRoles = async (folderId: string): Promise<FolderLayerRoleRow[]> => {
  const { data, error } = await supabase
    .from("folder_layer_roles")
    .select("*")
    .eq("folder_id", folderId);
  if (error) throw error;
  return (data ?? []) as unknown as FolderLayerRoleRow[];
};

export interface RolePayload {
  /** Una de las dos: group_id (regla de categoría) o layer_id (override por capa). */
  group_id?: string | null;
  layer_id?: string | null;
  role: TerritorialRole;
}

/**
 * Bumpea config_version de la carpeta en analysis_settings. Esto invalida el
 * caché de features (poi_features_cache.config_version) y obliga a recomputar
 * features en la próxima corrida del batch.
 *
 * Idempotente y best-effort: si la carpeta no tiene fila en analysis_settings
 * todavía, no falla — simplemente no hay caché que invalidar.
 */
export const bumpAnalysisConfigVersion = async (folderId: string): Promise<void> => {
  // Leer versión actual (si existe) y subirla en una segunda llamada para
  // evitar depender de RPCs. Si no existe la fila, no hacemos nada.
  const { data, error } = await supabase
    .from("analysis_settings")
    .select("config_version")
    .eq("folder_id", folderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;

  const next = (data.config_version ?? 0) + 1;
  const upd = await supabase
    .from("analysis_settings")
    .update({ config_version: next, updated_at: new Date().toISOString() })
    .eq("folder_id", folderId);
  if (upd.error) throw upd.error;
};

/**
 * Reemplaza el set completo de roles para una carpeta POI:
 * 1. Borra todas las filas existentes (folder_id = X)
 * 2. Inserta el nuevo set.
 * 3. Bumpea analysis_settings.config_version → invalida poi_features_cache.
 *
 * Esto evita inconsistencias por el UNIQUE COALESCE(group_id, layer_id) cuando
 * el usuario quita un override o cambia un rol de categoría, y garantiza que
 * la próxima corrida de "Calcular features territoriales" recalcule en lugar
 * de saltar por cache hit.
 */
export const saveFolderLayerRoles = async (
  folderId: string,
  rows: RolePayload[],
): Promise<void> => {
  const del = await supabase.from("folder_layer_roles").delete().eq("folder_id", folderId);
  if (del.error) throw del.error;

  if (rows.length) {
    const toInsert = rows.map((r) => ({
      folder_id: folderId,
      group_id: r.group_id ?? null,
      layer_id: r.layer_id ?? null,
      role: r.role,
      weight_override: null,
    }));

    const ins = await supabase.from("folder_layer_roles").insert(toInsert);
    if (ins.error) throw ins.error;
  }

  // Invalidar cache de features (no bloqueante si falla — logueamos).
  try {
    await bumpAnalysisConfigVersion(folderId);
  } catch (e) {
    console.warn("[folderLayerRoles] no se pudo bumpear config_version:", e);
  }
};
