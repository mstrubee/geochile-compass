import { supabase } from "@/integrations/supabase/client";

/**
 * Definiciones comerciales por carpeta: parámetros de negocio que no salen de
 * los datos sino de cómo opera la cadena, y que el admin ajusta sin tocar la
 * aplicación.
 */

/**
 * Castigo por defecto del formato Express.
 *
 * Un Express vende menos que un local estándar, pero la superficie todavía no
 * es una variable del modelo, así que se corrige por fuera con un valor fijo.
 * Se usa cuando la carpeta no tiene uno propio definido.
 */
export const DEFAULT_EXPRESS_ADJUST_PCT = -20;

/** Ajuste Express de la carpeta, o el valor por defecto si no lo definieron. */
export const fetchExpressAdjustPct = async (
  folderId: string,
): Promise<number> => {
  const { data } = await supabase
    .from("analysis_settings")
    .select("express_adjust_pct")
    .eq("folder_id", folderId)
    .maybeSingle();
  const raw = (data as { express_adjust_pct?: unknown } | null)?.express_adjust_pct;
  const n = Number(raw);
  return Number.isFinite(n) && raw !== null ? n : DEFAULT_EXPRESS_ADJUST_PCT;
};

/** Guarda el ajuste Express. `null` vuelve al valor por defecto de la app. */
export const saveExpressAdjustPct = async (
  folderId: string,
  pct: number | null,
): Promise<void> => {
  const { error } = await supabase
    .from("analysis_settings")
    .upsert(
      { folder_id: folderId, express_adjust_pct: pct } as never,
      { onConflict: "folder_id" },
    );
  if (error) throw error;
};
