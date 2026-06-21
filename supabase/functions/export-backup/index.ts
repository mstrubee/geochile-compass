// Edge function: full-backup export of public schema tables.
// - GET /export-backup            -> ZIP with one .json per table + _manifest.json
// - GET /export-backup?list=1     -> JSON list of exportable tables with row counts
// - GET /export-backup?table=NAME -> JSON file with all rows of that table (paged)
//
// Requires admin role. Uses SERVICE_ROLE to bypass RLS.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
// deno-lint-ignore no-explicit-any
import JSZip from "npm:jszip@3.10.1";

const PAGE_SIZE = 1000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });

async function listTables(admin: ReturnType<typeof createClient>): Promise<string[]> {
  // Lee tablas del esquema public desde information_schema vía PostgREST RPC alternativa:
  // No tenemos una RPC dedicada; usamos pg_meta-style query via REST is not available,
  // así que asumimos un set conocido a través de pg_catalog mediante una function ya existente.
  // Fallback: usamos una consulta directa con .from('pg_tables') no disponible en PostgREST.
  // Por eso definimos la lista solicitando información a una RPC; si no existe, devolvemos error claro.
  const { data, error } = await admin.rpc("list_public_tables");
  if (error) throw new Error(`list_public_tables RPC missing: ${error.message}`);
  return (data as Array<{ table_name: string }>)
    .map((r) => r.table_name)
    .filter((n) => !n.startsWith("_"))
    .sort();
}

async function countRows(admin: ReturnType<typeof createClient>, table: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function fetchAllRows(
  admin: ReturnType<typeof createClient>,
  table: string,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await admin.from(table).select("*").range(from, to);
    if (error) throw new Error(`fetch ${table} [${from}-${to}]: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Authorize: must be admin
    const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) return json({ error: `role check: ${roleErr.message}` }, 500);
    if (!isAdmin) return json({ error: "Forbidden: admin only" }, 403);

    const url = new URL(req.url);
    const wantList = url.searchParams.get("list");
    const wantTable = url.searchParams.get("table");

    const tables = await listTables(admin);

    if (wantList) {
      const counts: Array<{ table: string; rows: number }> = [];
      for (const t of tables) {
        try {
          counts.push({ table: t, rows: await countRows(admin, t) });
        } catch (e) {
          counts.push({ table: t, rows: -1, /* @ts-ignore */ error: String(e) });
        }
      }
      return json({ tables: counts });
    }

    if (wantTable) {
      if (!tables.includes(wantTable)) return json({ error: `Unknown table: ${wantTable}` }, 400);
      const rows = await fetchAllRows(admin, wantTable);
      return new Response(JSON.stringify({ table: wantTable, rows: rows.length, data: rows }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${wantTable}.json"`,
        },
      });
    }

    // Full ZIP
    const zip = new JSZip();
    const manifest: Record<string, number> = {};
    for (const t of tables) {
      const rows = await fetchAllRows(admin, t);
      manifest[t] = rows.length;
      zip.file(`${t}.json`, JSON.stringify(rows));
    }
    zip.file(
      "_manifest.json",
      JSON.stringify(
        { generated_at: new Date().toISOString(), tables: manifest },
        null,
        2,
      ),
    );
    const blob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return new Response(blob, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="backup_${stamp}.zip"`,
      },
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
