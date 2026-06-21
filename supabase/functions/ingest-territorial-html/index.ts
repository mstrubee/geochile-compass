// deno-lint-ignore-file no-explicit-any
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { parseSource } from "../_shared/territorial-parser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MIME_BY_TYPE: Record<string, string> = {
  html: "text/html",
  geojson: "application/geo+json",
  kml: "application/vnd.google-earth.kml+xml",
  kmz: "application/vnd.google-earth.kmz",
};

// Archivado a Google Drive deshabilitado: dependía del conector de Lovable.
// El archivo fuente se conserva en Supabase Storage (bucket territorial-sources),
// que es la fuente que la ingesta descarga y procesa.
const uploadToDrive = async (
  _filename: string,
  _bytes: Uint8Array,
  _mimeType: string,
): Promise<string | null> => null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json(401, { error: "unauthorized" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .limit(1);
    if (!roles?.length) return json(403, { error: "forbidden: admin required" });

    const body = await req.json();
    const sourceFileId = String(body.source_file_id || "");
    const groupId = String(body.group_id || "");
    const excluded: string[] = Array.isArray(body.excluded_layers) ? body.excluded_layers : [];
    const dedup: string = body.dedup_strategy || "replace_layer";
    if (!sourceFileId || !groupId) return json(400, { error: "source_file_id and group_id required" });

    const { data: sf, error: sfErr } = await admin
      .from("territorial_source_files")
      .select("*")
      .eq("id", sourceFileId)
      .single();
    if (sfErr || !sf) return json(404, { error: "source file not found" });

    await admin
      .from("territorial_source_files")
      .update({
        status: "processing",
        excluded_layers: excluded,
        dedup_strategy: dedup,
        group_id: groupId,
      })
      .eq("id", sourceFileId);

    const { data: file, error: dlErr } = await admin.storage
      .from("territorial-sources")
      .download(sf.storage_path);
    if (dlErr || !file) {
      await admin
        .from("territorial_source_files")
        .update({ status: "error", error: dlErr?.message || "download failed" })
        .eq("id", sourceFileId);
      return json(500, { error: dlErr?.message || "download failed" });
    }
    const fileType = (sf as any).file_type ?? "html";
    const buffer = await file.arrayBuffer();
    const text = fileType === "kmz" ? "" : new TextDecoder().decode(buffer);
    const scanned = await parseSource(fileType, text, buffer);

    const driveId = await uploadToDrive(
      `${Date.now()}__${sf.original_filename}`,
      new Uint8Array(buffer),
      MIME_BY_TYPE[fileType] ?? "application/octet-stream",
    );

    let totalInserted = 0;
    const summary: Array<{ name: string; count: number }> = [];

    for (const layer of scanned) {
      if (excluded.includes(layer.name)) continue;
      summary.push({ name: layer.name, count: layer.count });

      // Find or create the territorial_layer.
      // Match by source_name (nombre original del archivo) para preservar
      // los renombrados manuales del admin entre re-importaciones.
      const { data: existing } = await admin
        .from("territorial_layers")
        .select("id")
        .eq("group_id", groupId)
        .eq("source_name", layer.name)
        .maybeSingle();
      let layerId = existing?.id as string | undefined;
      if (!layerId) {
        // Fallback: capas legacy creadas antes de tener source_name.
        const { data: legacy } = await admin
          .from("territorial_layers")
          .select("id")
          .eq("group_id", groupId)
          .eq("name", layer.name)
          .is("source_name", null)
          .maybeSingle();
        if (legacy?.id) {
          layerId = legacy.id;
          // Marcamos su source_name para que futuras importaciones lo encuentren.
          await admin
            .from("territorial_layers")
            .update({ source_name: layer.name })
            .eq("id", layerId);
        }
      }
      if (!layerId) {
        const { data: created, error: cErr } = await admin
          .from("territorial_layers")
          .insert({
            group_id: groupId,
            name: layer.name,
            source_name: layer.name,
            source_file_id: sourceFileId,
          })
          .select("id")
          .single();
        if (cErr || !created) continue;
        layerId = created.id;
      }
      // Importante: NO actualizamos `name` si la capa ya existía — preservamos
      // el nombre que el admin pudo haber editado.

      // Dedup strategy
      if (dedup === "replace_layer") {
        await admin.from("territorial_features").delete().eq("layer_id", layerId);
      }

      // Bulk insert in chunks of 500
      const rows = layer.features.map((f) => ({
        layer_id: layerId!,
        external_id: f.external_id,
        name: f.name,
        lat: f.lat,
        lng: f.lng,
        geometry: f.geometry,
        properties: f.properties,
      }));

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        if (dedup === "merge_external_id") {
          // Manual upsert: split rows with external_id (use upsert) vs nulls (just insert)
          const withId = chunk.filter((r) => r.external_id);
          const noId = chunk.filter((r) => !r.external_id);
          if (withId.length) {
            await admin
              .from("territorial_features")
              .upsert(withId, { onConflict: "layer_id,external_id" });
          }
          if (noId.length) {
            await admin.from("territorial_features").insert(noId);
          }
        } else if (dedup === "merge_coords_name") {
          // Delete matching by (lat,lng,name) then insert
          for (const r of chunk) {
            if (r.lat != null && r.lng != null) {
              await admin
                .from("territorial_features")
                .delete()
                .eq("layer_id", layerId!)
                .eq("lat", r.lat)
                .eq("lng", r.lng)
                .eq("name", r.name ?? "");
            }
          }
          await admin.from("territorial_features").insert(chunk);
        } else {
          await admin.from("territorial_features").insert(chunk);
        }
        totalInserted += chunk.length;
      }

      // Update count + bbox
      const lats = layer.features.map((f) => f.lat).filter((v): v is number => v != null);
      const lngs = layer.features.map((f) => f.lng).filter((v): v is number => v != null);
      const bbox =
        lats.length && lngs.length
          ? [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)]
          : null;
      const { count } = await admin
        .from("territorial_features")
        .select("id", { count: "exact", head: true })
        .eq("layer_id", layerId);
      await admin
        .from("territorial_layers")
        .update({ feature_count: count ?? 0, bbox })
        .eq("id", layerId);
    }

    await admin
      .from("territorial_source_files")
      .update({
        status: "done",
        processed_at: new Date().toISOString(),
        gdrive_file_id: driveId,
        layers_summary: summary,
      })
      .eq("id", sourceFileId);

    return json(200, { inserted: totalInserted, layers: summary, gdrive_file_id: driveId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { error: msg });
  }
});
