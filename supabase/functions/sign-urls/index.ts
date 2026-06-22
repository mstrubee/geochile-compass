import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const files = [
    "1778207836656-mapa_talleres_tiendas_1.html",
    "1778211396226-mapa_talleres_tiendas_1.geojson",
    "1778513580408-sabana_parque_clientes.json",
  ];
  const out: Record<string, string | null> = {};
  for (const f of files) {
    const { data, error } = await supabase.storage
      .from("territorial-sources")
      .createSignedUrl(f, 3600);
    out[f] = error ? `ERROR: ${error.message}` : data!.signedUrl;
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
