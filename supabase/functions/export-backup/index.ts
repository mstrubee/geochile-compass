// Edge function: paginated export of public schema tables.
// - GET /export-backup?list=1                       -> JSON list of exportable tables with row counts
// - GET /export-backup?table=NAME&offset=N&limit=M  -> plain JSON array with that range of rows
//
// Requires admin role. Uses SERVICE_ROLE to bypass RLS.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });

async function listTables(admin: ReturnType<typeof createClient>): Promise<string[]> {
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

    if (!wantTable) {
      return json(
        {
          error:
            "Provide ?table=NAME&offset=N&limit=M to fetch a page, or ?list=1 to list tables. Full ZIP export was removed (resource limits).",
          tables,
        },
        400,
      );
    }

    if (!tables.includes(wantTable)) return json({ error: `Unknown table: ${wantTable}` }, 400);

    const offsetRaw = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const limit = Math.min(
      Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const to = offset + limit - 1;

    const { data, error } = await admin.from(wantTable).select("*").range(offset, to);
    if (error) return json({ error: `fetch ${wantTable} [${offset}-${to}]: ${error.message}` }, 500);

    const rows = data ?? [];
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-Table": wantTable,
        "X-Offset": String(offset),
        "X-Limit": String(limit),
        "X-Returned": String(rows.length),
      },
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
