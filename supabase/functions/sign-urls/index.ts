// Firma URLs de 1 h de archivos fijos del bucket PRIVADO `territorial-sources` con service_role.
// Antes no validaba a nadie: cualquiera con la URL obtenía los enlaces. Ahora exige un JWT de usuario con rol
// administrador (../_shared/edge-auth.ts). Nada en src/ ni en supabase/ la llama (solo la nombra el README).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeRequest } from "../_shared/edge-auth.ts";
import { userAuthDeps } from "../_shared/edge-auth-deps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await authorizeRequest(req, { kind: "admin" }, userAuthDeps());
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
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
