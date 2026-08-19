/**
 * scripts/backtest-forecast.ts
 * ───────────────────────────
 * Mide qué tan bien pronostica `salesForecast` sobre la historia real, con un
 * backtest rolling: para cada uno de los últimos N meses, pronostica usando
 * SOLO la historia previa a ese mes (incluidos los factores estacionales, que
 * se recalculan con datos previos) y compara contra lo que pasó de verdad.
 *
 * Vale correrlo de nuevo cuando entren varios meses nuevos: si el error se
 * degrada, el método hay que revisarlo.
 *
 *   npm run backtest:pronostico
 *   npm run backtest:pronostico -- --meses 24
 */
import { createClient } from "@supabase/supabase-js";
import { forecastStore } from "@/services/salesForecast";
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

const MESES_TEST = Number(argValue("meses") ?? 12);

const main = async (): Promise<void> => {
  const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Paginar: PostgREST corta en 1000 filas.
  const all: Array<{ poi_id: string; period: string; value: number }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("poi_metrics")
      .select("poi_id, period, value")
      .eq("metric_key", "ventas")
      .order("period")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Array<{ poi_id: string; period: string; value: number }>;
    all.push(...page);
    if (page.length < 1000) break;
  }
  console.log(`${all.length} observaciones de ventas\n`);

  const byStore = new Map<string, Array<{ period: string; value: number }>>();
  for (const r of all) {
    const period = String(r.period).slice(0, 10);
    if (!byStore.has(r.poi_id)) byStore.set(r.poi_id, []);
    byStore.get(r.poi_id)!.push({ period, value: Number(r.value) });
  }
  const periods = [...new Set(all.map((r) => String(r.period).slice(0, 10)))].sort();
  const test = periods.slice(-MESES_TEST);
  console.log(`evaluando ${test.length} meses: ${test[0]} → ${test[test.length - 1]}\n`);

  const evaluar = (useTrend: boolean, label: string): number => {
    const errs: number[] = [];
    for (const t of test) {
      const previos = all
        .filter((r) => String(r.period).slice(0, 10) < t)
        .map((r) => ({ period: String(r.period).slice(0, 10), value: Number(r.value) }));
      const factors = computeSeasonalFactors(previos);
      for (const [, serie] of byStore) {
        const real = serie.find((s) => s.period === t)?.value;
        if (real == null || real === 0) continue;
        const hist = serie.filter((s) => s.period < t);
        const f = forecastStore(hist, factors, { horizon: 1, useTrend });
        if (!f.length) continue;
        errs.push(Math.abs(f[0].value - real) / Math.abs(real));
      }
    }
    if (!errs.length) {
      console.log(`  ${label}: sin datos suficientes`);
      return Infinity;
    }
    const mape = (100 * errs.reduce((a, b) => a + b, 0)) / errs.length;
    const sorted = [...errs].sort((a, b) => a - b);
    console.log(
      `  ${label.padEnd(38)} MAPE ${mape.toFixed(2)}%  mediana ${(100 * sorted[Math.floor(sorted.length / 2)]).toFixed(2)}%  (n=${errs.length})`,
    );
    return mape;
  };

  console.log("error al predecir el mes siguiente:\n");
  const conTendencia = evaluar(true, "nivel desestacionalizado + tendencia");
  const sinTendencia = evaluar(false, "nivel desestacionalizado, sin tendencia");

  console.log("\nreferencia: promedio móvil simple 12m × estacionalidad = 7,60%");
  console.log(
    conTendencia < sinTendencia
      ? `\n→ la tendencia ayuda (${(sinTendencia - conTendencia).toFixed(2)} puntos). useTrend: true es correcto.`
      : `\n→ la tendencia NO ayuda (${(conTendencia - sinTendencia).toFixed(2)} puntos peor). Conviene useTrend: false por defecto.`,
  );
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
