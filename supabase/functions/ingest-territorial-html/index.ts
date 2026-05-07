// deno-lint-ignore-file no-explicit-any
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
interface ScannedLayer {
  name: string;
  count: number;
  features: Array<{
    external_id: string | null;
    name: string | null;
    lat: number | null;
    lng: number | null;
    geometry: any;
    properties: Record<string, unknown>;
  }>;
}

const parseHtml = (html: string): ScannedLayer[] => {
  const layers = new Map<string, ScannedLayer>();
  const ensure = (name: string) => {
    if (!layers.has(name)) layers.set(name, { name, count: 0, features: [] });
    return layers.get(name)!;
  };
  const folderRe = /<Folder\b[^>]*>([\s\S]*?)<\/Folder>/gi;
  const placemarkRe = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  const nameRe = /<name>([\s\S]*?)<\/name>/i;
  const coordRe = /<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/i;
  const idRe = /<Placemark\s+id=["']([^"']+)["']/i;
  const matches = [...html.matchAll(folderRe)];
  if (matches.length) {
    for (const m of matches) {
      const inner = m[1];
      const folderName = (inner.match(/^[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1] || "Capa").trim();
      const layer = ensure(folderName);
      const pms = [...inner.matchAll(placemarkRe)];
      for (const pm of pms) {
        const pmHtml = pm[0];
        const body = pm[1];
        const nameMatch = body.match(nameRe);
        const coordMatch = body.match(coordRe);
        const idMatch = pmHtml.match(idRe);
        if (!coordMatch) continue;
        const coordStr = coordMatch[1].trim();
        const tuples = coordStr.split(/\s+/).map((t) => {
          const [lng, lat] = t.split(",").map(Number);
          return [lng, lat];
        }).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
        if (!tuples.length) continue;
        const isPoint = tuples.length === 1;
        const geometry = isPoint
          ? { type: "Point", coordinates: tuples[0] }
          : { type: "LineString", coordinates: tuples };
        layer.features.push({
          external_id: idMatch?.[1] ?? null,
          name: nameMatch?.[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? null,
          lat: isPoint ? tuples[0][1] : null,
          lng: isPoint ? tuples[0][0] : null,
          geometry,
          properties: {},
        });
        layer.count++;
      }
    }
  }
  if (!layers.size) {
    const varRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[[\s\S]*?\]);/g;
    for (const m of html.matchAll(varRe)) {
      const varName = m[1];
      let arr: any;
      try {
        const cleaned = m[2].replace(/,(\s*[}\]])/g, "$1");
        arr = JSON.parse(cleaned);
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      const layer = ensure(varName);
      for (const obj of arr) {
        if (!obj || typeof obj !== "object") continue;
        const lat = Number(obj.lat ?? obj.latitude ?? obj.LAT);
        const lng = Number(obj.lng ?? obj.lon ?? obj.longitude ?? obj.LON ?? obj.LNG);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        layer.features.push({
          external_id: obj.id != null ? String(obj.id) : null,
          name: obj.name ?? obj.Name ?? obj.title ?? null,
          lat,
          lng,
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: obj,
        });
        layer.count++;
      }
    }
  }
  return Array.from(layers.values()).filter((l) => l.count > 0);
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GOOGLE_DRIVE_API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const uploadToDrive = async (filename: string, html: string): Promise<string | null> => {
  if (!LOVABLE_API_KEY || !GOOGLE_DRIVE_API_KEY) return null;
  try {
    const boundary = "----lvbnd" + crypto.randomUUID();
    const metadata = {
      name: filename,
      description: "GeoPlanet territorial source",
    };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: text/html\r\n\r\n` +
      html +
      `\r\n--${boundary}--`;
    const resp = await fetch(
      "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!resp.ok) {
      console.warn("Drive upload failed", resp.status, await resp.text());
      return null;
    }
    const j = await resp.json();
    return j.id ?? null;
  } catch (e) {
    console.warn("Drive upload error", e);
    return null;
  }
};

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
    const html = await file.text();
    const scanned = parseHtml(html);

    const driveId = await uploadToDrive(`${Date.now()}__${sf.original_filename}`, html);

    let totalInserted = 0;
    const summary: Array<{ name: string; count: number }> = [];

    for (const layer of scanned) {
      if (excluded.includes(layer.name)) continue;
      summary.push({ name: layer.name, count: layer.count });

      // Find or create the territorial_layer
      const { data: existing } = await admin
        .from("territorial_layers")
        .select("id")
        .eq("group_id", groupId)
        .eq("name", layer.name)
        .maybeSingle();
      let layerId = existing?.id as string | undefined;
      if (!layerId) {
        const { data: created, error: cErr } = await admin
          .from("territorial_layers")
          .insert({ group_id: groupId, name: layer.name, source_file_id: sourceFileId })
          .select("id")
          .single();
        if (cErr || !created) continue;
        layerId = created.id;
      }

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
