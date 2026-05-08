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

    const fileType = (sf as any).file_type ?? "html";
    const buffer = fileType === "kmz" ? await file.arrayBuffer() : null;
    const text = fileType === "kmz" ? "" : await file.text();
    const scanned = await parseSource(fileType, text, buffer);
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
