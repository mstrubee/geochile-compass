import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SYNC_TOKEN = Deno.env.get("SYNC_API_TOKEN") ?? ""
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  if (req.headers.get("Authorization") !== `Bearer ${SYNC_TOKEN}`)
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors })

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  )

  const body = await req.json()
  const { action } = body

  if (action === "get_existing_ids") {
    const { data, error } = await sb
      .from("comercio_poi").select("osm_id,osm_version")
      .eq("categoria", body.categoria).eq("eliminado", false)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors })
    return new Response(JSON.stringify({ ok: true, data }), { headers: cors })
  }

  if (action === "upsert") {
    const { error } = await sb.from("comercio_poi").upsert(body.records, { onConflict: "osm_id" })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors })
    return new Response(JSON.stringify({ ok: true, n: body.records.length }), { headers: cors })
  }

  if (action === "soft_delete") {
    if (!body.osm_ids?.length) return new Response(JSON.stringify({ ok: true, n: 0 }), { headers: cors })
    const { error } = await sb.from("comercio_poi")
      .update({ eliminado: true })
      .eq("categoria", body.categoria)
      .in("osm_id", body.osm_ids)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors })
    return new Response(JSON.stringify({ ok: true }), { headers: cors })
  }

  if (action === "seed_catalog") {
    const { error } = await sb.from("brand_catalog")
      .upsert(body.entries, { onConflict: "raw_name" })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors })
    return new Response(JSON.stringify({ ok: true, n: body.entries.length }), { headers: cors })
  }

  if (action === "get_catalog") {
    const { data, error } = await sb
      .from("brand_catalog")
      .select("raw_name, marca_estandar, categoria, subcategoria, color_hex, icon_emoji")
      .eq("activo", true)
      .order("raw_name")
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors })
    return new Response(JSON.stringify({ data }), { status: 200, headers: cors })
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: cors })
})
