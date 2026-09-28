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
 * Se usa cuando la carpeta no tiene uno propio definido. Es un castigo FIJO,
 * independiente del ajuste manual por gasto exógeno: los dos se suman, no se
 * reemplazan (ver ProjectionSection en AnalysisPanel.tsx).
 */
export const DEFAULT_EXPRESS_ADJUST_PCT = -30;

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

/**
 * Velocidades por defecto para estimar el tiempo en auto.
 *
 * El ruteador entrega la distancia real y qué parte de la ruta es autopista;
 * el tiempo se calcula con estas velocidades y no con el modelo del ruteador,
 * que supone tránsito libre y queda optimista para decidir una inversión.
 */
export const DEFAULT_DRIVE_SPEEDS = { urbanKmh: 28, highwayKmh: 90 };

export interface DriveSpeeds { urbanKmh: number; highwayKmh: number }

/** Velocidades de la carpeta, o las de la app si no las definieron. */
export const fetchDriveSpeeds = async (folderId: string): Promise<DriveSpeeds> => {
  const { data } = await supabase
    .from("analysis_settings")
    .select("drive_speed_urban_kmh, drive_speed_highway_kmh")
    .eq("folder_id", folderId)
    .maybeSingle();
  const row = data as {
    drive_speed_urban_kmh?: unknown;
    drive_speed_highway_kmh?: unknown;
  } | null;
  const num = (v: unknown, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    urbanKmh: num(row?.drive_speed_urban_kmh, DEFAULT_DRIVE_SPEEDS.urbanKmh),
    highwayKmh: num(row?.drive_speed_highway_kmh, DEFAULT_DRIVE_SPEEDS.highwayKmh),
  };
};

/** Guarda las velocidades de la carpeta. */
export const saveDriveSpeeds = async (
  folderId: string,
  speeds: DriveSpeeds,
): Promise<void> => {
  const { error } = await supabase
    .from("analysis_settings")
    .upsert(
      {
        folder_id: folderId,
        drive_speed_urban_kmh: speeds.urbanKmh,
        drive_speed_highway_kmh: speeds.highwayKmh,
      } as never,
      { onConflict: "folder_id" },
    );
  if (error) throw error;
};

/**
 * Carpeta que conviene mostrar preseleccionada.
 *
 * Alfabéticamente la primera es Agroplanet, pero las definiciones comerciales
 * casi siempre se ajustan sobre la red de Autoplanet.
 */
export const defaultCommercialFolder = <T extends { name: string }>(
  folders: T[],
): T | undefined =>
  folders.find((f) => f.name.trim().toLowerCase() === "autoplanet") ?? folders[0];
