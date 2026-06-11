import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GITHUB_OWNER = "mstrubee";
const GITHUB_REPO  = "geochile-compass";
const WORKFLOW_FILE = "sync_comercio_osm.yml";

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verificar autenticación Supabase
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Disparar el workflow de GitHub Actions
  const githubToken = Deno.env.get("GITHUB_TOKEN");
  if (!githubToken) {
    return new Response(JSON.stringify({ error: "GITHUB_TOKEN no configurado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const ghResp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${githubToken}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (!ghResp.ok) {
    const detail = await ghResp.text();
    return new Response(JSON.stringify({ error: `GitHub API error ${ghResp.status}`, detail }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ message: "Sync disparado correctamente. El workflow de GitHub Actions está en cola." }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
