import { supabase } from "@/integrations/supabase/client";
import type { UfValue } from "@/types/analysis";

/**
 * Servicio para conversión de CLP a UF según el valor de UF del PERÍODO
 * de la venta — NO el valor actual.
 *
 * Cómo se usa en el análisis:
 *   const uf = await loadUfMap();
 *   const sales_uf = sales_clp / uf.get("2024-03-01")!;
 *
 * Si para un período no hay UF cargada, devuelve null y el caller
 * decide si excluir ese mes o usar el más cercano.
 */

export type UfMap = Map<string, number>; // period → CLP/UF

let cache: { map: UfMap; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Normaliza cualquier representación de período a "YYYY-MM-01".
 * Supabase puede devolver DATE como "YYYY-MM-DDTHH:mm:ss.sssZ" (ISO UTC) o
 * "YYYY-MM-DD". La edge function sync-uf-values inserta "YYYY-MM-01".
 */
const normalizePeriod = (s: string): string | null => {
  if (!s) return null;
  // ISO con tiempo: "2024-03-01T00:00:00.000Z" → "2024-03-01"
  const dateOnly = s.slice(0, 10);
  // "YYYY-MM-DD" → "YYYY-MM-01" (siempre el primer día del mes)
  const parts = dateOnly.split("-");
  if (parts.length < 2) return null;
  return `${parts[0]}-${parts[1]}-01`;
};

/**
 * Carga (con caché) todos los valores UF disponibles.
 */
export const loadUfMap = async (force = false): Promise<UfMap> => {
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.map;
  }
  const { data, error } = await supabase
    .from("uf_values")
    .select("period, value");
  if (error) {
    console.warn("[loadUfMap] error:", error.message);
    return new Map();
  }
  const map: UfMap = new Map();
  for (const r of (data ?? []) as Array<Pick<UfValue, "period" | "value">>) {
    // Supabase puede devolver DATE como "YYYY-MM-DDTHH:mm:ss.sssZ" (ISO con tiempo)
    // o como "YYYY-MM-DD". Normalizamos siempre a "YYYY-MM-01" para consistencia.
    const period = normalizePeriod(r.period);
    if (period) map.set(period, Number(r.value));
  }
  cache = { map, loadedAt: Date.now() };
  return map;
};

export const invalidateUfCache = () => {
  cache = null;
};

/**
 * Convierte un monto en CLP a UF usando la UF del período (mes-año) dado.
 * Devuelve null si no hay UF para ese período.
 */
export const clpToUf = (
  clp: number,
  period: string,
  ufMap: UfMap,
): number | null => {
  const uf = ufMap.get(period);
  if (!uf || uf <= 0) return null;
  return clp / uf;
};

/**
 * Si no hay UF exacta para `period`, intenta el período más cercano
 * dentro de un rango (default ±2 meses). Útil cuando una UF mensual
 * no se pudo cargar pero las vecinas sí.
 */
export const clpToUfFuzzy = (
  clp: number,
  period: string,
  ufMap: UfMap,
  toleranceMonths = 2,
): { uf: number; usedPeriod: string } | null => {
  const exact = ufMap.get(period);
  if (exact && exact > 0) return { uf: clp / exact, usedPeriod: period };

  const [yStr, mStr] = period.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!isFinite(y) || !isFinite(m)) return null;

  for (let delta = 1; delta <= toleranceMonths; delta++) {
    for (const sign of [-1, 1]) {
      const ym = y * 12 + (m - 1) + sign * delta;
      const yy = Math.floor(ym / 12);
      const mm = (ym % 12) + 1;
      const candidate = `${yy}-${String(mm).padStart(2, "0")}-01`;
      const v = ufMap.get(candidate);
      if (v && v > 0) return { uf: clp / v, usedPeriod: candidate };
    }
  }
  return null;
};

/**
 * Convierte una serie temporal completa de CLP a UF.
 * Devuelve solo los meses con UF disponible (silenciosamente descarta los que no).
 */
export const seriesClpToUf = (
  series: Array<{ period: string; value: number }>,
  ufMap: UfMap,
): Array<{ period: string; uf: number; clp: number; ufRate: number }> => {
  const out: Array<{ period: string; uf: number; clp: number; ufRate: number }> = [];
  for (const p of series) {
    const ufRate = ufMap.get(p.period);
    if (!ufRate || ufRate <= 0) continue;
    out.push({ period: p.period, uf: p.value / ufRate, clp: p.value, ufRate });
  }
  return out;
};

/**
 * Cobertura de UF en un rango de períodos. Útil para advertir al admin
 * "Faltan 4 meses de UF, sincroniza".
 */
export const computeUfCoverage = (
  periods: string[],
  ufMap: UfMap,
): { covered: number; missing: string[]; total: number } => {
  const missing: string[] = [];
  let covered = 0;
  for (const p of periods) {
    if (ufMap.has(p)) covered++;
    else missing.push(p);
  }
  return { covered, missing, total: periods.length };
};

/**
 * Triggea la edge function `sync-uf-values` para refrescar el histórico.
 * Solo admins (la función verifica auth y usa service role internamente).
 */
export const syncUfValues = async (
  fromYear?: number,
  toYear?: number,
): Promise<{ ok: boolean; upserted: number; coverage: Record<string, number>; errors: string[] }> => {
  const { data, error } = await supabase.functions.invoke("sync-uf-values", {
    body: { fromYear, toYear },
  });
  if (error) throw error;
  invalidateUfCache();
  return data as {
    ok: boolean;
    upserted: number;
    coverage: Record<string, number>;
    errors: string[];
  };
};
