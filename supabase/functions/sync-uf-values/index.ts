// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * sync-uf-values
 * --------------
 * Sincroniza el histórico mensual de UF (CLP por UF) desde mindicador.cl
 * a la tabla `public.uf_values`. Política:
 *  · Para cada mes, guarda el valor del PRIMER DÍA HÁBIL del mes.
 *  · Backfill desde 2019-01 (cubre toda la historia AutoPlanet).
 *  · Idempotente: hace upsert, así puede re-correrse cuantas veces sea.
 *
 * Auth: requiere SERVICE_ROLE para escribir bypassing RLS, así cualquier
 * admin desde el browser puede invocarla sin tener que escribir desde
 * sesión usuaria.
 *
 * Triggered desde el cliente (botón admin) o agendado mensualmente.
 *
 * mindicador.cl endpoints:
 *   GET https://mindicador.cl/api/uf/YYYY  → lista de valores diarios del año
 *   GET https://mindicador.cl/api/uf/dd-mm-yyyy → valor de ese día
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const START_YEAR = 2019;

interface MindicadorYearItem {
  fecha: string; // ISO 8601, e.g. "2024-03-01T03:00:00.000Z"
  valor: number;
}

interface MindicadorYearResponse {
  version: string;
  autor: string;
  codigo: string;
  nombre: string;
  unidad_medida: string;
  serie: MindicadorYearItem[];
}

const fetchYear = async (year: number): Promise<MindicadorYearItem[]> => {
  const url = `https://mindicador.cl/api/uf/${year}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`mindicador ${year}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as MindicadorYearResponse;
  return json.serie ?? [];
};

/**
 * De una lista de valores diarios saca un valor por mes (el primer
 * día hábil disponible — la API ya viene ordenada desc por fecha).
 */
const reduceToMonthly = (
  items: MindicadorYearItem[],
): Array<{ period: string; value: number }> => {
  const byMonth = new Map<string, MindicadorYearItem>();
  // Ordeno asc para quedarme con el primero de cada mes.
  const sorted = [...items].sort(
    (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
  );
  for (const it of sorted) {
    const d = new Date(it.fecha);
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(ym)) byMonth.set(ym, it);
  }
  const out: Array<{ period: string; value: number }> = [];
  byMonth.forEach((v, ym) => {
    out.push({ period: `${ym}-01`, value: v.valor });
  });
  return out;
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return new Response(
        JSON.stringify({ error: "Service role no configurado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = (await req.json().catch(() => ({}))) as {
      fromYear?: number;
      toYear?: number;
    };
    const now = new Date();
    const fromYear = Math.max(2019, body.fromYear ?? START_YEAR);
    const toYear = body.toYear ?? now.getUTCFullYear();

    let totalUpserted = 0;
    const errors: string[] = [];
    const seriePorAño: Record<string, number> = {};

    for (let y = fromYear; y <= toYear; y++) {
      try {
        const items = await fetchYear(y);
        const monthly = reduceToMonthly(items);
        if (monthly.length === 0) {
          errors.push(`${y}: sin datos`);
          continue;
        }
        const rows = monthly.map((m) => ({
          period: m.period,
          value: m.value,
          source: "mindicador",
        }));
        const { error } = await supabase
          .from("uf_values")
          .upsert(rows, { onConflict: "period" });
        if (error) {
          errors.push(`${y}: ${error.message}`);
          continue;
        }
        totalUpserted += rows.length;
        seriePorAño[String(y)] = rows.length;
      } catch (e) {
        errors.push(`${y}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return new Response(
      JSON.stringify({
        ok: errors.length === 0,
        upserted: totalUpserted,
        coverage: seriePorAño,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("sync-uf-values fatal:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
