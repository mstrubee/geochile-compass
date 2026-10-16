/**
 * Qué períodos se pueden elegir, derivado de lo que REALMENTE está publicado (get_layer_provenance):
 *  - año: los años COMPLETOS del archivo anual (el año en curso no aparece: no es comparable con un año entero);
 *  - acumulado/mes: los meses desde `load_from` hasta `period_end` del archivo mensual.
 */
import { PERMIT_SOURCE_KEYS, type LayerProvenanceRow, type PermitSelection } from "@/types/permits";

const ymd = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return { y, m, d };
};

export const findSource = (rows: LayerProvenanceRow[] | undefined, key: string) => rows?.find((r) => r.source_key === key);

/** Años completos publicados en el archivo anual (p. ej. 2002..2025). */
export const availableYears = (annual: LayerProvenanceRow | undefined): number[] => {
  if (!annual?.period_start || !annual.period_end) return [];
  const start = ymd(annual.period_start).y;
  const end = ymd(annual.period_end);
  const lastComplete = end.m === 12 && end.d >= 31 ? end.y : end.y - 1;
  const from = annual.load_from ? Math.max(start, ymd(annual.load_from).y) : start;
  return Array.from({ length: Math.max(0, lastComplete - from + 1) }, (_, i) => from + i);
};

export interface MonthRange { from: { y: number; m: number }; to: { y: number; m: number } }

/** Meses cargados del archivo mensual. */
export const monthRange = (monthly: LayerProvenanceRow | undefined): MonthRange | null => {
  if (!monthly?.period_end) return null;
  const to = ymd(monthly.period_end);
  const fromSrc = monthly.load_from ?? monthly.period_start;
  if (!fromSrc) return null;
  const from = ymd(fromSrc);
  return { from: { y: from.y, m: from.m }, to: { y: to.y, m: to.m } };
};

export const monthYears = (r: MonthRange | null): number[] =>
  r ? Array.from({ length: r.to.y - r.from.y + 1 }, (_, i) => r.from.y + i) : [];

/** Meses elegibles de un año: acotados por el primer mes cargado y por el último publicado. */
export const monthsOfYear = (r: MonthRange | null, year: number, mode: "ytd" | "month"): number[] => {
  if (!r || year < r.from.y || year > r.to.y) return [];
  const lo = year === r.from.y ? r.from.m : 1;
  const hi = year === r.to.y ? r.to.m : 12;
  // un acumulado desde enero solo es válido si el año tiene enero cargado
  if (mode === "ytd" && lo > 1) return [];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
};

export const sourceKeyFor = (mode: PermitSelection["mode"]) => (mode === "year" ? PERMIT_SOURCE_KEYS.year : PERMIT_SOURCE_KEYS.month);

/** Selección inicial: el último año completo del anual; si no hay anual, el último mes del mensual. */
export const defaultSelection = (
  prov: LayerProvenanceRow[] | undefined,
  defaults?: Partial<Pick<PermitSelection, "metric" | "destination">>,
): PermitSelection | null => {
  const base = { metric: defaults?.metric ?? "units", destination: defaults?.destination ?? "housing_total", display: "value" as const };
  const years = availableYears(findSource(prov, PERMIT_SOURCE_KEYS.year));
  if (years.length) return { mode: "year", year: years[years.length - 1], month: null, ...base };
  const r = monthRange(findSource(prov, PERMIT_SOURCE_KEYS.month));
  if (r) return { mode: "month", year: r.to.y, month: r.to.m, ...base };
  return null;
};

/** Ajusta una selección al cambiar de modo/año para que siga siendo válida. */
export const normalizeSelection = (s: PermitSelection, prov: LayerProvenanceRow[] | undefined): PermitSelection => {
  if (s.mode === "year") {
    const years = availableYears(findSource(prov, PERMIT_SOURCE_KEYS.year));
    const year = years.includes(s.year) ? s.year : years[years.length - 1] ?? s.year;
    return { ...s, year, month: null };
  }
  const r = monthRange(findSource(prov, PERMIT_SOURCE_KEYS.month));
  const ys = monthYears(r).filter((y) => monthsOfYear(r, y, s.mode as "ytd" | "month").length > 0);
  const year = ys.includes(s.year) ? s.year : ys[ys.length - 1] ?? s.year;
  const ms = monthsOfYear(r, year, s.mode as "ytd" | "month");
  const month = s.month != null && ms.includes(s.month) ? s.month : ms[ms.length - 1] ?? null;
  return { ...s, year, month };
};
