/**
 * Salud, Fase 1b — etiquetas, advertencias, niveles de las preguntas y funciones puras de las capas de previsión.
 * Todo texto vive aquí para que panel, popup y ficha digan lo mismo. Regla de redacción: la interfaz NUNCA afirma una causa [NO COMPROBADO];
 * lo que no consta en la fuente se dice como «no declarado» o «no comprobado».
 */
import type { HealthAltaDef } from "@/types/health";
import { ALTA_LABEL, fmtN } from "@/utils/healthScale";
import type { CasenRegionRow, CasenSistema, IsapreComunaRow, IsapreFilters, IsapreSexo } from "@/types/prevision";

export const SEXO_LABEL: Record<IsapreSexo, string> = { F: "Mujeres", M: "Hombres", SI: "Sexo sin información" };
export const MIN_TRAMO_LABEL: Record<number, string> = { 0: "Todas las edades", 12: "60 años o más (sin la edad sin información)" };

/** Nivel de respuesta (regla 9) y sello (regla 2): ejes independientes. */
export const ISAPRE_LEVEL_SEAL = { level: "Respondida con rigor (conteo del archivo oficial, con supresión de conteos pequeños)", seal: "Oficial con advertencia" } as const;
export const CASEN_LEVEL_SEAL = { level: "Estimada con rango (intervalo de confianza del 95 %)", seal: "Estimado" } as const;

export const WARN_ISAPRE = {
  scope: "Cuenta beneficiarios (cotizantes + cargas) del Sistema Isapre. NO incluye Fonasa ni otros sistemas: no es la población de la comuna ni su cobertura de salud.",
  provisional: "Información PROVISIONAL: el archivo oficial la declara «sujeta a modificación».",
  comuna: "La fuente no declara qué comuna es (domicilio, contrato u otra): no se interpreta como «donde vive» ni «donde se atiende».",
  age60: "«60 años o más» suma los tramos de 60-64 a 100 o más: EXCLUYE a quienes no informan edad e INCLUYE a quienes no informan sexo.",
  period: "El período de los datos (cartera vigente a diciembre de 2025) no es la fecha de publicación ni la de extracción, y difiere de la fecha de los establecimientos.",
  suppression: (n: number) => `Los conteos de 1 a ${n - 1} personas por celda NO se publican (se muestra «<${n}»). El valor de una comuna es exacto cuando lo publicado lo determina (totales de grupo y residuo) y, si no, un rango «entre a y b». Es una política de presentación de esta plataforma; la fuente no declara una norma de supresión.`,
  color: "El color usa el punto medio del rango; el valor exacto o el rango están en la ventana de cada comuna.",
  zero: "0 = el archivo trae 0 beneficiarios para esa comuna con ese filtro (cero publicado). «Sin dato» = la comuna no figura en el archivo: no es lo mismo que 0.",
  noAccess: "«Sin hospital de alta complejidad en la comuna» NO significa sin acceso: la población puede atenderse en comunas vecinas.",
  notClientReady: "Capa aún NO apta para clientes (client_ready = false): no entra a informes ni exportaciones.",
} as const;

export const WARN_CASEN = {
  estimate: "Estimación de una encuesta (CASEN 2024), no un conteo: cada valor tiene error muestral y se muestra como rango. No se pinta sobre las comunas: la encuesta no es representativa a ese nivel.",
  method: "El intervalo se calcula con el diseño muestral (linealización de Taylor, 1 nivel de conglomerados) y se contrastó con el tabulado oficial; el error estándar es cálculo de esta plataforma.",
  notPublishable: "Sin valor: menos de 60 casos muestrales, o marcada «no fiable» por el tabulado oficial.",
  noSum: "No se suma con Isapre ni con Fonasa de otras fuentes: son poblaciones y períodos distintos.",
  license: "Licencia de uso de la base por confirmar.",
} as const;

/** Preguntas de la fase y su nivel (regla 9). Texto único para panel y ficha. */
export interface QuestionInfo { id: string; text: string; level: string; seal: string | null; state: "construida" | "en_espera" | "no_respondible" }
export const QUESTIONS: readonly QuestionInfo[] = [
  { id: "1b-1", text: "Beneficiarios Isapre de 60 años o más en comunas sin hospital de alta complejidad en la comuna", level: "Respondida con rigor", seal: "Oficial con advertencia", state: "construida" },
  { id: "1b-2", text: "Comunas con mayor proporción de beneficiarios Isapre sobre la población del Censo 2024", level: "Respondida con rigor", seal: "Oficial con advertencia", state: "en_espera" },
  { id: "1b-3", text: "Proporción de cada región que declara Fonasa o Isapre (CASEN 2024)", level: "Estimada con rango", seal: "Estimado", state: "construida" },
  { id: "1b-4", text: "Esa proporción por comuna", level: "No respondible hoy", seal: null, state: "no_respondible" },
  { id: "1b-5", text: "Inscritos Fonasa por comuna, tramo, edad y sexo", level: "No respondible hoy", seal: null, state: "no_respondible" },
] as const;

export const QUESTION_STATE_TEXT: Record<string, string> = {
  "1b-2": "En espera: falta la población comunal del Censo 2024. Sin ese denominador no se calcula ninguna proporción.",
  "1b-4": "No respondible hoy: la CASEN no es representativa a nivel comunal; no se estima ni se reparte la proporción regional entre comunas.",
  "1b-5": "No respondible hoy: faltan los archivos de Fonasa. No se creó nada que dependa de ellos.",
};

/** «n» o «entre a y b» (cuando hay celdas suprimidas). */
export const rangeText = (lo: number, hi: number, exact = lo === hi): string => (exact || lo === hi ? fmtN(lo) : `entre ${fmtN(lo)} y ${fmtN(hi)}`);
export const midpoint = (r: Pick<IsapreComunaRow, "n_lo" | "n_hi">): number => (r.n_lo + r.n_hi) / 2;

export const isapreFilterLabel = (f: IsapreFilters): string => {
  const parts = [MIN_TRAMO_LABEL[f.minTramo] ?? `desde el tramo ${f.minTramo}`, f.sexo ? SEXO_LABEL[f.sexo] : "ambos sexos"];
  if (f.sinAlta) parts.push(`solo comunas sin ${ALTA_LABEL[f.sinAlta].toLowerCase()} en la comuna`);
  return parts.join(" · ");
};

export const totalRange = (rows: IsapreComunaRow[] | undefined) => (rows ?? []).reduce((a, r) => ({ lo: a.lo + r.n_lo, hi: a.hi + r.n_hi }), { lo: 0, hi: 0 });
export const countInexact = (rows: IsapreComunaRow[] | undefined) => (rows ?? []).filter((r) => !r.exact).length;

export const SISTEMA_LABEL: Record<CasenSistema, string> = {
  fonasa: "Sistema público (Fonasa)", isapre: "Isapre", ffaa: "FF.AA. y del Orden", ninguno: "Ninguno (particular)", otro: "Otro sistema", nosabe: "No sabe",
};
export const SISTEMAS_SHOWN: readonly CasenSistema[] = ["fonasa", "isapre"];

const pf = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtPct = (v: number | null | undefined) => (v == null ? "sin dato" : `${pf.format(v)} %`);

/** Rango del intervalo de confianza, primero; el centro, después. Sin valores si no es publicable. */
export const casenRangeText = (r: Pick<CasenRegionRow, "publishable" | "pct" | "ci_lo" | "ci_hi" | "reason">): string =>
  r.publishable && r.ci_lo != null && r.ci_hi != null
    ? `entre ${fmtPct(r.ci_lo)} y ${fmtPct(r.ci_hi)}${r.pct != null ? ` (centro ${fmtPct(r.pct)})` : ""}`
    : `no publicable${r.reason ? `: ${r.reason}` : ""}`;

export interface CasenRegionTable { region_cut: string; region_name: string; bySistema: Partial<Record<CasenSistema, CasenRegionRow>> }
export const casenByRegion = (rows: CasenRegionRow[] | undefined): CasenRegionTable[] => {
  const m = new Map<string, CasenRegionTable>();
  for (const r of rows ?? []) {
    const e = m.get(r.region_cut) ?? { region_cut: r.region_cut, region_name: r.region_name, bySistema: {} };
    e.bySistema[r.sistema] = r;
    m.set(r.region_cut, e);
  }
  return [...m.values()].sort((a, b) => a.region_cut.localeCompare(b.region_cut));
};
export const casenCounts = (rows: CasenRegionRow[] | undefined) => ({
  total: (rows ?? []).length, publishable: (rows ?? []).filter((r) => r.publishable).length,
});
export const altaOptions: readonly HealthAltaDef[] = ["hospital", "ampliada"];
