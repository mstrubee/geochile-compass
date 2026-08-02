import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildStreetCatalog } from "./overpassClient.ts";

/**
 * Cachea el catalogo de calles por comuna en Supabase (tablas street_catalog
 * / street_catalog_status). Se construye una sola vez por comuna vía
 * Overpass y se reutiliza indefinidamente - las calles de una comuna no
 * cambian de una corrida de geocodificacion a la siguiente.
 */
export const getOrBuildStreetCatalog = async (admin: SupabaseClient, comuna: string): Promise<string[]> => {
  const { data: status } = await admin
    .from("street_catalog_status")
    .select("comuna, street_count")
    .eq("comuna", comuna)
    .maybeSingle();

  if (status) {
    if (status.street_count === 0) return [];
    const { data: rows } = await admin.from("street_catalog").select("calle").eq("comuna", comuna);
    return (rows ?? []).map((r: { calle: string }) => r.calle);
  }

  let calles: string[] = [];
  let error: string | null = null;
  try {
    calles = await buildStreetCatalog(comuna);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (calles.length) {
    const rows = calles.map((calle) => ({ comuna, calle, source: "overpass" }));
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await admin.from("street_catalog").upsert(rows.slice(i, i + CHUNK), { onConflict: "comuna,calle" });
    }
  }

  await admin
    .from("street_catalog_status")
    .upsert([{ comuna, street_count: calles.length, error }], { onConflict: "comuna" });

  return calles;
};
