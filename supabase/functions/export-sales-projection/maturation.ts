/**
 * Puerto Deno de `src/services/maturationCurveService.ts`.
 *
 * Es una COPIA deliberada y no un import: el servicio del front usa alias de
 * Vite (`@/…`) y el cliente con sesión de usuario, ninguno de los dos
 * disponible en una edge function. La lógica se replica byte a byte para que la
 * cifra que exporta esta función sea la misma que el analista ve en pantalla.
 *
 * Si `maturationCurveService.ts` cambia, hay que reflejarlo acá.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Igual que `DEFAULT_GROWTH_RATE` en salesProjectionService.ts. */
export const DEFAULT_GROWTH_RATE = 0.03;

export interface MaturationCurve {
  rampFactors: number[];
  rates: number[];
  sampleSize: number;
  isFallback: boolean;
  isCustom: boolean;
}

const FALLBACK_RAMP = [0.49, 0.63, 1.0];

export const MATURITY_YEAR = FALLBACK_RAMP.length - 1;

const ratesFromRamp = (ramp: number[]): number[] => {
  const out: number[] = [];
  for (let i = 1; i < ramp.length; i++) {
    if (ramp[i - 1] > 0) out.push(Math.round((ramp[i] / ramp[i - 1] - 1) * 1000) / 1000);
  }
  return out;
};

const fetchCustomRamp = async (
  admin: SupabaseClient,
  folderId: string,
): Promise<number[] | null> => {
  const { data } = await admin
    .from("analysis_settings")
    .select("maturation_ramp")
    .eq("folder_id", folderId)
    .maybeSingle();
  const raw = (data as { maturation_ramp?: unknown } | null)?.maturation_ramp;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const nums = raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length === raw.length ? nums : null;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const fetchMaturationCurve = async (
  admin: SupabaseClient,
  folderId: string,
): Promise<MaturationCurve> => {
  const fallback: MaturationCurve = {
    rampFactors: FALLBACK_RAMP,
    rates: ratesFromRamp(FALLBACK_RAMP),
    sampleSize: 0,
    isFallback: true,
    isCustom: false,
  };
  try {
    const custom = await fetchCustomRamp(admin, folderId);
    if (custom) {
      return {
        rampFactors: custom,
        rates: ratesFromRamp(custom),
        sampleSize: 0,
        isFallback: false,
        isCustom: true,
      };
    }

    const { data: pois } = await admin
      .from("pois")
      .select("id")
      .eq("folder_id", folderId)
      .is("deleted_at", null);
    if (!pois?.length) return fallback;

    const ids = pois.map((p) => p.id);
    const [{ data: metrics }, { data: ufRows }] = await Promise.all([
      admin
        .from("poi_metrics")
        .select("poi_id, period, value")
        .eq("metric_key", "ventas")
        .in("poi_id", ids)
        .order("period", { ascending: true }),
      admin.from("uf_values").select("period, value"),
    ]);
    if (!metrics?.length || !ufRows?.length) return fallback;

    const uf = new Map<string, number>();
    for (const r of ufRows) {
      if (r.value) uf.set(String(r.period).slice(0, 10), Number(r.value));
    }

    const byPoi = new Map<string, Array<{ period: string; uf: number }>>();
    let seriesStart = "9999-12-31";
    for (const m of metrics) {
      const v = Number(m.value ?? 0);
      if (v <= 0) continue;
      const period = String(m.period).slice(0, 10);
      const ufv = uf.get(period);
      if (!ufv) continue;
      const arr = byPoi.get(m.poi_id) ?? [];
      arr.push({ period, uf: v / ufv });
      byPoi.set(m.poi_id, arr);
      if (period < seriesStart) seriesStart = period;
    }

    const perStore: Array<Record<number, number>> = [];
    for (const [, series] of byPoi) {
      const opening = series[0]?.period;
      if (!opening) continue;
      if (opening <= seriesStart) continue;

      const openMs = new Date(opening).getTime();
      const sums: Record<number, { sum: number; n: number }> = {};
      for (const p of series) {
        const years = Math.floor(
          (new Date(p.period).getTime() - openMs) / (365.25 * 24 * 3600 * 1000),
        );
        const b = sums[years] ?? { sum: 0, n: 0 };
        b.sum += p.uf;
        b.n += 1;
        sums[years] = b;
      }
      const avg: Record<number, number> = {};
      for (const [y, b] of Object.entries(sums)) {
        if (b.n >= 6) avg[Number(y)] = b.sum / b.n;
      }
      if (Object.keys(avg).length >= 2) perStore.push(avg);
    }

    if (perStore.length < 2) return fallback;

    const ramps: Array<Record<number, number>> = [];
    for (const s of perStore) {
      const mature = Object.entries(s)
        .filter(([y]) => Number(y) >= MATURITY_YEAR)
        .map(([, v]) => v);
      if (mature.length === 0) continue;
      const steady = mature.reduce((a, b) => a + b, 0) / mature.length;
      if (steady <= 0) continue;
      const f: Record<number, number> = {};
      for (const [y, v] of Object.entries(s)) f[Number(y)] = v / steady;
      ramps.push(f);
    }
    if (ramps.length < 2) return fallback;

    const rampFactors: number[] = [];
    for (let y = 0; y <= MATURITY_YEAR; y++) {
      const xs = ramps.filter((r) => r[y] != null).map((r) => r[y]);
      if (xs.length < 2) break;
      rampFactors.push(Math.round(median(xs) * 1000) / 1000);
    }
    if (rampFactors.length < 2) return fallback;
    rampFactors[rampFactors.length - 1] = 1;

    return {
      rampFactors,
      rates: ratesFromRamp(rampFactors),
      sampleSize: ramps.length,
      isFallback: false,
      isCustom: false,
    };
  } catch (e) {
    console.error("[export-sales-projection] fetchMaturationCurve falló", e);
    return fallback;
  }
};
