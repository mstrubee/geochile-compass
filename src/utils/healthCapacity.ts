/**
 * Capacidad de los hospitales (camas de dotación y ocupación): textos y formato. Nada se infiere, estima ni resta: lo que no llega de la fuente es «sin dato».
 * Pabellones (REM A21) NO se muestran —ni siquiera como «sin dato»— hasta que exista la fuente (otro PR).
 */
import type { HealthCapacity, HealthCapacityField, HealthCapacityOccupancy } from "@/types/health";

export const NO_DATA = "sin dato";

export const CAP_TEXT = {
  avgNote: "promedio del período, no en tiempo real",
  areasNote: "El índice del hospital suma todas las áreas funcionales publicadas: incluye Pensionado, psiquiatría y sociosanitario.",
  totalNote: "El total de camas es la cifra publicada por el DEIS; puede no coincidir con la suma de las áreas.",
  dotacionDef: "Camas de dotación: las asignadas al establecimiento por resolución (DEIS/DIGERA). No es lo mismo que las camas disponibles que usa la ocupación.",
  formula: "Ocupación = Σ días-cama ocupados ÷ Σ días-cama disponibles × 100 (fórmula oficial del DEIS), calculada sobre todas las áreas del período.",
  over100: "Puede superar 100 %: la fuente lo permite.",
  noDenominator: "sin dato (sin días-cama disponibles)",
  publicOnly: "Las camas y la ocupación se reportan al DEIS por la red pública (SNSS); este establecimiento no figura en esas fuentes.",
  fieldLabel: { dotacion: "Camas de dotación", ocupacion: "Ocupación (REM 20)" } satisfies Record<HealthCapacityField, string>,
} as const;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pf = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

export const fmtCount = (n: number | null | undefined) => (n == null ? NO_DATA : nf.format(n));
/** 84,83 → «84,8 %». Sin índice (null) → «sin dato»: jamás «0 %». */
export const fmtPct = (n: number | null | undefined) => (n == null ? NO_DATA : `${pf.format(n)} %`);
/** «2026-08» → «agosto 2026». */
export const monthLabel = (period: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : period;
};
export const dateLabel = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : NO_DATA);

/** «2025 (ene–dic)»; si el año trae menos de 12 meses, «2025 (6 de 12 meses informados)». */
export const yearLabel = (o: HealthCapacityOccupancy) =>
  o.months != null && o.expected_months != null && o.months < o.expected_months ? `${o.year} (${o.months} de ${o.expected_months} meses informados)` : `${o.year} (ene–dic)`;

/** El índice de un período, con el motivo cuando no hay: «sin dato (sin días-cama disponibles)». */
export const indexText = (o: Pick<HealthCapacityOccupancy, "indice" | "disponibles">) =>
  o.indice != null ? fmtPct(o.indice) : o.disponibles === 0 ? CAP_TEXT.noDenominator : NO_DATA;

/** ¿La fuente no incluye a este establecimiento por no ser de la red pública? (solo se dice cuando además no hay ningún dato). */
export const showPublicOnlyNote = (c: HealthCapacity) => c.snss !== true && !c.dotacion && !c.ocupacion_anual && !c.ocupacion_mes;

export const notReadyFields = (c: HealthCapacity): { field: HealthCapacityField; note: string | null }[] =>
  (["dotacion", "ocupacion"] as const).flatMap((f) => (c.client_ready[f]?.client_ready === false ? [{ field: f, note: c.client_ready[f]?.note ?? null }] : []));
