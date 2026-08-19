/**
 * scripts/propose-budget.ts
 * ────────────────────────
 * Genera una PROPUESTA de presupuesto para un año, como Excel listo para
 * revisar y editar.
 *
 * La idea deliberada: no escribe metas en la base. Produce el mismo formato que
 * acepta "Importar presupuesto", así el flujo es
 *
 *     proponer → revisar/ajustar en Excel → importar
 *
 * en vez de un botón que fija metas en silencio. Un presupuesto es una decisión
 * de negocio; el pronóstico es solo el punto de partida informado.
 *
 * El pronóstico usa `salesForecast` (nivel desestacionalizado de los últimos 12
 * meses × estacionalidad de la red × tendencia), medido en 7,16% de error a un
 * mes vista — ver scripts/backtest-forecast.ts.
 *
 *   npm run proponer:presupuesto -- --anio 2027
 *   npm run proponer:presupuesto -- --anio 2027 --crecimiento 5
 */
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { forecastCalendarYear } from "@/services/salesForecast";
import { computeSeasonalFactors } from "@/services/budgetDistribution";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}`);
  return v;
};
const argValue = (flag: string): string | undefined => {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${flag}`);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${flag}=`))?.slice(flag.length + 3);
};

const YEAR = Number(argValue("anio") ?? new Date().getFullYear() + 1);
/** Ajuste comercial sobre el pronóstico, en % (ej. 5 = meta 5% sobre lo esperado). */
const GROWTH = Number(argValue("crecimiento") ?? 0);
const OUT = argValue("salida") ?? `propuesta_presupuesto_${YEAR}.xlsx`;

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const main = async (): Promise<void> => {
  const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: schemas, error: schErr } = await admin
    .from("poi_folder_schemas")
    .select("folder_id")
    .eq("import_enabled", true);
  if (schErr) throw new Error(schErr.message);
  const folderId = argValue("folder") ?? (schemas ?? [])[0]?.folder_id;
  if (!folderId) throw new Error("No hay carpeta con importación habilitada");

  // Ventas (paginado: PostgREST corta en 1000).
  const ventas: Array<{ poi_id: string; period: string; value: number }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("poi_metrics")
      .select("poi_id, period, value")
      .eq("metric_key", "ventas")
      .order("period")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Array<{ poi_id: string; period: string; value: number }>;
    ventas.push(...page);
    if (page.length < 1000) break;
  }

  const { data: pois, error: poisErr } = await admin
    .from("pois")
    .select("id, name")
    .eq("folder_id", folderId)
    .is("deleted_at", null);
  if (poisErr) throw new Error(poisErr.message);

  // Atributos de identidad, para que el Excel salga con las mismas columnas
  // que espera el importador.
  const poiIds = (pois ?? []).map((p) => p.id);
  const attrs: Array<{ poi_id: string; attr_key: string; attr_value: string | null }> = [];
  for (let i = 0; i < poiIds.length; i += 40) {
    const { data } = await admin
      .from("poi_attributes")
      .select("poi_id, attr_key, attr_value")
      .in("poi_id", poiIds.slice(i, i + 40));
    attrs.push(...((data ?? []) as typeof attrs));
  }
  const attrOf = (poiId: string, key: string): string =>
    attrs.find((a) => a.poi_id === poiId && a.attr_key === key)?.attr_value ?? "";

  const factors = computeSeasonalFactors(
    ventas.map((v) => ({ period: String(v.period).slice(0, 10), value: Number(v.value) })),
  );

  const byStore = new Map<string, Array<{ period: string; value: number }>>();
  for (const v of ventas) {
    if (!byStore.has(v.poi_id)) byStore.set(v.poi_id, []);
    byStore.get(v.poi_id)!.push({ period: String(v.period).slice(0, 10), value: Number(v.value) });
  }

  const factor = 1 + GROWTH / 100;
  const header = ["Local", "Nombre Local", "Centro Sap", ...MESES, `Total ${YEAR}`];
  const rows: Array<Array<string | number>> = [];
  const sinHistoria: string[] = [];

  for (const p of pois ?? []) {
    const serie = byStore.get(p.id) ?? [];
    const fc = forecastCalendarYear(serie, factors, YEAR);
    if (fc.length !== 12) {
      sinHistoria.push(p.name);
      continue;
    }
    const valores = fc.map((f) => Math.round(f.value * factor));
    rows.push([
      attrOf(p.id, "Local"),
      p.name,
      attrOf(p.id, "Centro Sap"),
      ...valores,
      valores.reduce((a, b) => a + b, 0),
    ]);
  }

  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Propuesta ${YEAR}`);
  writeFileSync(OUT, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

  const total = rows.reduce((s, r) => s + Number(r[r.length - 1]), 0);
  console.log(`propuesta de presupuesto ${YEAR}`);
  console.log(`  ${rows.length} locales · total ${(total / 1e6).toFixed(0)} MM`);
  if (GROWTH) console.log(`  ajuste comercial aplicado: ${GROWTH > 0 ? "+" : ""}${GROWTH}%`);
  if (sinHistoria.length) {
    console.log(`  ⚠ ${sinHistoria.length} local(es) sin 12 meses de historia, quedaron FUERA:`);
    for (const n of sinHistoria) console.log(`      ${n}`);
    console.log("    (no se inventa una meta sin historia suficiente; agrégalas a mano)");
  }
  console.log(`\narchivo: ${OUT}`);
  console.log("Revísalo, ajusta lo que corresponda, y cárgalo con");
  console.log(`  clic derecho en la carpeta → Importar presupuesto → año ${YEAR}`);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
