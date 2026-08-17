/**
 * list-saved-isochrones
 * =====================
 * Lista las isócronas guardadas para que un sistema externo (leaseflow-pro)
 * deje elegir una y después pida su proyección a `export-sales-projection`.
 *
 * Solo lectura. No escribe nada ni toca comportamiento existente.
 * Auth: header `x-api-key` (ver _shared/export-auth.ts).
 */

import { getAdminClient } from "../_shared/gemini-keys.ts";
import { corsHeaders, json, requireApiKey } from "../_shared/export-auth.ts";

interface Row {
  id: string;
  name: string;
  mode: string;
  minutes: number[] | null;
  center_lat: number | null;
  center_lng: number | null;
  folder_id: string | null;
  projection_settings: { computedAt?: string | null } | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }

  const denied = await requireApiKey(req);
  if (denied) return denied;

  const admin = getAdminClient();
  if (!admin) {
    return json({ error: "service role no configurado" }, 500);
  }

  const folderId = new URL(req.url).searchParams.get("folderId")?.trim() || null;

  // Admin client: `saved_isochrones` tiene RLS por user_id y el caller no es un
  // usuario autenticado de este proyecto.
  let query = admin
    .from("saved_isochrones")
    .select("id, name, mode, minutes, center_lat, center_lng, folder_id, projection_settings")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (folderId) query = query.eq("folder_id", folderId);

  const { data, error } = await query;
  if (error) {
    console.error("[list-saved-isochrones] consulta falló", error);
    return json({ error: "error consultando isócronas" }, 500);
  }

  const rows = (data ?? []) as Row[];

  // El nombre de carpeta se resuelve en una segunda consulta y no con un join
  // embebido: `folder_id` es nullable y con `!inner` las isócronas sin carpeta
  // desaparecerían de la lista.
  const folderIds = [...new Set(rows.map((r) => r.folder_id).filter(Boolean))] as string[];
  const folderNames = new Map<string, string>();
  if (folderIds.length > 0) {
    const { data: folders } = await admin
      .from("isochrone_folders")
      .select("id, name")
      .in("id", folderIds);
    for (const f of (folders ?? []) as Array<{ id: string; name: string }>) {
      folderNames.set(f.id, f.name);
    }
  }

  return json(
    rows.map((r) => {
      const computedAt = r.projection_settings?.computedAt ?? null;
      return {
        id: r.id,
        name: r.name,
        folderName: r.folder_id ? folderNames.get(r.folder_id) ?? null : null,
        mode: r.mode,
        minutes: r.minutes ?? [],
        centerLat: r.center_lat,
        centerLng: r.center_lng,
        hasProjection: !!computedAt,
        computedAt,
      };
    }),
  );
});
