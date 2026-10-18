/**
 * Salud, Fase 1b — etiquetas, advertencias, niveles de las preguntas y funciones puras de las capas de previsión.
 * Todo texto vive aquí para que panel, popup y ficha digan lo mismo. Regla de redacción: la interfaz NUNCA afirma una causa [NO COMPROBADO];
 * lo que no consta en la fuente se dice como «no declarado» o «no comprobado».
 */
import type { HealthAltaDef } from "@/types/health";
import { ALTA_LABEL, fmtN } from "@/utils/healthScale";
import type { CasenRegionRow, CasenSistema, IsapreComunaRow, IsapreFilters, IsaprePenetracionRow, IsapreSexo } from "@/types/prevision";

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

/** 1b-2: penetración = beneficiarios Isapre (solo lo publicado) / población censada 2024 con el mismo sexo y edad. */
export const FONASA_PENDING = "Fonasa: pendiente (fase C)";
export const WARN_PENETRACION = {
  method: "Penetración = beneficiarios Isapre (cotizantes + cargas, tal como se publican, con supresión de conteos pequeños) ÷ población censada 2024 (INE) del mismo sexo y de la misma edad. Es exacta cuando el valor publicado es exacto y, si no, un rango «entre a % y b %».",
  asymmetry: "Con todas las edades el numerador incluye a quienes no informan edad y, con ambos sexos, a quienes no informan sexo; con 60 años o más EXCLUYE la edad sin información e INCLUYE el sexo sin información (con ambos sexos). El Censo no tiene «sin información»: el denominador es la población con edad y sexo conocidos.",
  dates: "Los períodos difieren: Isapre, cartera vigente a diciembre de 2025; Censo, año 2024.",
  residence: "La comuna de la cartera Isapre no está declarada en la fuente (domicilio, contrato u otra) [NO COMPROBADO]; la del Censo es la de residencia habitual. Pueden no coincidir.",
  noClip: "No se recorta a 100 %: un valor sobre 100 % se muestra tal cual. Puede reflejar diferencias de definición territorial o de fecha entre las dos fuentes, o el efecto de poblaciones muy pequeñas; la causa no está comprobada.",
  noSex: "«Sexo sin información» no tiene penetración: el Censo no tiene ese grupo.",
  noFonasa: "Solo Isapre. Fonasa y los demás sistemas no se incluyen ni se estiman: no hay «resto» ni «sin previsión».",
  cap: (cap: number, max: number) => `El color llega al azul más oscuro en ${fmtPct(cap)} (percentil 95 de las comunas mostradas) para que una comuna extrema no aplane el resto; el máximo publicado es ${fmtPct(max)}. La ventana de cada comuna trae su valor real.`,
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
  { id: "1b-2", text: "Comunas con mayor penetración de beneficiarios Isapre sobre la población censada 2024 (INE)", level: "Respondida con rigor", seal: "Oficial con advertencia", state: "construida" },
  { id: "1b-3", text: "Proporción de cada región que declara Fonasa o Isapre (CASEN 2024)", level: "Estimada con rango", seal: "Estimado", state: "construida" },
  { id: "1b-4", text: "Esa proporción por comuna", level: "No respondible hoy", seal: null, state: "no_respondible" },
  { id: "1b-5", text: "Inscritos Fonasa por comuna, tramo, edad y sexo", level: "No respondible hoy", seal: null, state: "no_respondible" },
] as const;

export const QUESTION_STATE_TEXT: Record<string, string> = {
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

// ───────────────────────────── 1b-2: penetración (escala, textos) ─────────────────────────────
export const PCT_FILL_OPACITY = 0.5;
export const PCT_CAP_PERCENTILE = 0.95;
/** Blanco (menor %) → azul profundo (mayor %), interpolación lineal en RGB. */
export const PCT_WHITE: readonly [number, number, number] = [255, 255, 255];
export const PCT_BLUE: readonly [number, number, number] = [8, 48, 107];

/** Punto medio del rango de penetración; null = sin dato. */
export const pctMid = (r: Pick<IsaprePenetracionRow, "pct_lo" | "pct_hi">): number | null => (r.pct_lo == null || r.pct_hi == null ? null : (r.pct_lo + r.pct_hi) / 2);

export interface PctDomain { /** tope del color */ max: number; /** máximo de los puntos medios */ maxPublished: number; capped: boolean }
const percentile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return lo + 1 < sorted.length ? sorted[lo] + (pos - lo) * (sorted[lo + 1] - sorted[lo]) : sorted[lo];
};
/** Dominio [0, tope]: el tope es el percentil 95 de los puntos medios mostrados (o el máximo si este es menor). null si no hay ninguna comuna con penetración. */
export const pctDomain = (rows: Pick<IsaprePenetracionRow, "pct_lo" | "pct_hi">[] | undefined): PctDomain | null => {
  const v = (rows ?? []).map(pctMid).filter((x): x is number => x != null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const maxPublished = v[v.length - 1];
  const p95 = percentile(v, PCT_CAP_PERCENTILE);
  const max = p95 > 0 ? p95 : maxPublished > 0 ? maxPublished : 1;
  return { max, maxPublished, capped: max < maxPublished };
};

const mix = (t: number): [number, number, number] => PCT_WHITE.map((w, i) => Math.round(w + (PCT_BLUE[i] - w) * t)) as [number, number, number];
/** Color continuo de un % (0 → blanco; ≥ tope → azul profundo). */
export const pctColor = (v: number, max: number): string => {
  const t = max > 0 ? Math.min(Math.max(v / max, 0), 1) : 0;
  const [r, g, b] = mix(t);
  return `rgb(${r}, ${g}, ${b})`;
};
export const PCT_NODATA_COLOR = "#9ca3af";

/** «21,8 %» o «entre 8,9 % y 20,7 %»; «sin dato» si falta. */
export const pctRangeText = (lo: number | null | undefined, hi: number | null | undefined, exact?: boolean | null): string =>
  lo == null || hi == null ? "sin dato" : exact || lo === hi ? fmtPct(lo) : `entre ${fmtPct(lo)} y ${fmtPct(hi)}`;

/** Comunas que se muestran en la capa de penetración: todas las filas con `pct` y, si hay filtro «sin alta», solo las que están en `allowed` (CUT de get_isapre_comuna con ese filtro). */
export const penetracionRowsShown = (rows: IsaprePenetracionRow[] | undefined, allowed: Set<string> | null): IsaprePenetracionRow[] =>
  (rows ?? []).filter((r) => (allowed ? allowed.has(r.cut) : true));
export const countPctOver100 = (rows: IsaprePenetracionRow[] | undefined) => (rows ?? []).filter((r) => (r.pct_hi ?? 0) > 100 || (r.pct_lo ?? 0) > 100);
export const countPctInexact = (rows: IsaprePenetracionRow[] | undefined) => (rows ?? []).filter((r) => r.pct_lo != null && r.exact === false).length;
