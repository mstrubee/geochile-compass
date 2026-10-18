import type { IneCommuneStats } from "@/utils/ineScales";
import { loadPoblacionIndex, normName } from "@/services/poblacionService";
import type { PoblacionIndex } from "@/types/poblacion";

/**
 * Estadísticas por comuna para las capas y los análisis.
 *
 * POBLACIÓN: SIEMPRE del Censo 2024 (INE), leída de la base por `poblacionService` (única fuente). `/ine_communes.csv` ya NO trae población; si la base no tiene la captura
 * o falla, `poblacion` es `null` («sin dato») y `densidad` también: no hay valores de respaldo ni cifras en el código.
 *
 * SUPERFICIE, INGRESO y NSE siguen viniendo de `/ine_communes.csv` (formato: commune_id,commune_name,superficie_km2,ingreso_promedio,nse). Esas columnas NO tienen fuente
 * documentada ([NO COMPROBADO], ver «Datos sin fuente» del PR); la DENSIDAD = población censada / esa superficie hereda esa limitación.
 *
 * Devuelve un Map indexado por código de comuna (5 dígitos) y por nombre normalizado (CSV, Censo y alias), que apuntan al mismo objeto.
 */

const NSE_NUM_TO_LABEL: Record<number, IneCommuneStats["nse"]> = {
  1: "E",
  2: "D",
  3: "C3",
  4: "C2",
  5: "ABC1",
};

export interface IneIndex {
  byCode: Map<string, IneCommuneStats>;
  byName: Map<string, IneCommuneStats>;
  /** Estado de la lectura de la población censada: `ok`, `empty` (la base no tiene captura) o `error`. Fuera de `ok`, toda población es «sin dato». */
  poblacion: PoblacionIndex;
}

interface CsvRow { code: string; name: string; superficie: number | null; ingreso: number | null; nse: IneCommuneStats["nse"] }

let cache: IneIndex | null = null;
let inflight: Promise<IneIndex> | null = null;

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const normNse = (s: string | undefined): IneCommuneStats["nse"] => {
  if (!s) return null;
  const k = s.trim().toUpperCase();
  if (k === "ABC1" || k === "C2" || k === "C3" || k === "D" || k === "E") return k;
  const n = Number(k);
  if (n >= 1 && n <= 5) return NSE_NUM_TO_LABEL[n];
  return null;
};

/** Lee superficie, ingreso y NSE. IGNORA cualquier columna de población que traiga el archivo. */
export const parseCSV = (text: string): CsvRow[] => {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  const iCode = idx("commune_id");
  const iName = idx("commune_name");
  const iSup = idx("superficie_km2");
  const iIng = idx("ingreso_promedio");
  const iNse = idx("nse");
  if (iCode < 0) {
    console.warn("[ineService] CSV sin columna commune_id");
    return [];
  }
  const out: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const code = cols[iCode]?.padStart(5, "0");
    if (!code || code === "00000") continue;
    out.push({ code, name: iName >= 0 ? cols[iName] ?? "" : "", superficie: num(cols[iSup]), ingreso: num(cols[iIng]), nse: normNse(cols[iNse]) });
  }
  return out;
};

/** Une población censada (por CUT) con superficie/ingreso/NSE del CSV. Sin población en la base → `poblacion` y `densidad` en null. */
export const buildIneIndex = (rows: CsvRow[], pob: PoblacionIndex): IneIndex => {
  const byCode = new Map<string, IneCommuneStats>();
  const byName = new Map<string, IneCommuneStats>();
  const make = (code: string, r?: CsvRow): IneCommuneStats => {
    const poblacion = pob.byCut.get(code)?.total ?? null;
    const superficie = r?.superficie ?? null;
    return { poblacion, superficie_km2: superficie, densidad: poblacion != null && superficie != null && superficie > 0 ? poblacion / superficie : null, ingreso: r?.ingreso ?? null, nse: r?.nse ?? null };
  };
  for (const r of rows) {
    const stats = make(r.code, r);
    byCode.set(r.code, stats);
    if (r.name) byName.set(normName(r.name), stats);
    const cen = pob.byCut.get(r.code);
    if (cen) byName.set(normName(cen.comuna), stats);
  }
  for (const [cut, cen] of pob.byCut) {
    if (!byCode.has(cut)) {
      const stats = make(cut);
      byCode.set(cut, stats);
      byName.set(normName(cen.comuna), stats);
    }
  }
  // nombres con los que la app conoce a la comuna (CSV de códigos territoriales, alias): apuntan al MISMO objeto por CUT
  for (const [name, cen] of pob.byName) {
    const stats = byCode.get(cen.cut);
    if (stats && !byName.has(name)) byName.set(name, stats);
  }
  return { byCode, byName, poblacion: pob };
};

export const loadIneIndex = async (): Promise<IneIndex> => {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    let rows: CsvRow[] = [];
    try {
      const res = await fetch("/ine_communes.csv");
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && !ct.includes("text/html")) rows = parseCSV(await res.text());
    } catch (e) {
      console.warn("[ineService] /ine_communes.csv no disponible: superficie, ingreso y NSE quedan sin dato", e);
    }
    const pob = await loadPoblacionIndex();
    const idx = buildIneIndex(rows, pob);
    // solo se cachea cuando la población llegó: si falló o está vacía, el próximo llamado vuelve a leer la base
    if (pob.status === "ok") cache = idx;
    return idx;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
};

/** Solo para pruebas. */
export const resetIneCache = () => {
  cache = null;
  inflight = null;
};
