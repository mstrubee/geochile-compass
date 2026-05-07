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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Best-effort HTML parser for Leaflet / Google My Maps style files.
 * Looks for:
 *   1. KML <Folder><name>...</name><Placemark>...</Placemark></Folder>
 *   2. JS arrays of objects with lat/lng-like fields, grouped by var name.
 *   3. Loose <Placemark> blocks under no folder → "Sin carpeta".
 */
export const parseHtml = (html: string): ScannedLayer[] => {
  const layers = new Map<string, ScannedLayer>();
  const ensure = (name: string) => {
    if (!layers.has(name)) layers.set(name, { name, count: 0, features: [] });
    return layers.get(name)!;
  };

  // ---------- KML Folders ----------
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
        // Could be "lng,lat,alt lng,lat,alt ..." for lines/polygons
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

  // ---------- JS arrays of {lat,lng,...} ----------
  if (!layers.size) {
    const varRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(\[[\s\S]*?\]);/g;
    for (const m of html.matchAll(varRe)) {
      const varName = m[1];
      let arr: any;
      try {
        // Strip trailing commas
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
    if (!roles?.length) return json(403, { error: "forbidden: admin role required" });

    const body = await req.json();
    const sourceFileId = String(body.source_file_id || "");
    if (!sourceFileId) return json(400, { error: "source_file_id required" });

    const { data: sf, error: sfErr } = await admin
      .from("territorial_source_files")
      .select("*")
      .eq("id", sourceFileId)
      .single();
    if (sfErr || !sf) return json(404, { error: "source file not found" });

    await admin.from("territorial_source_files").update({ status: "scanning" }).eq("id", sourceFileId);

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
    const summary = scanned.map((l) => ({ name: l.name, count: l.count }));

    await admin
      .from("territorial_source_files")
      .update({ status: "scanned", layers_summary: summary })
      .eq("id", sourceFileId);

    return json(200, { layers: summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { error: msg });
  }
});
