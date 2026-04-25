import type { IneCommuneStats } from "@/utils/ineScales";
import { COMMUNES } from "@/data/communes";
import { normalizeCommuneName } from "@/services/communeDataService";

/**
 * Carga datos INE por comuna desde `/ine_communes.csv` (opcional).
 *
 * Formato esperado del CSV (header obligatorio, columnas opcionales salvo commune_id):
 *   commune_id,poblacion,superficie_km2,ingreso_promedio,nse
 *   13101,503147,22.4,1850000,C3
 *
 * Si el archivo no existe (404), se hace fallback a los datos hardcoded
 * de `src/data/communes.ts` (52 RM con datos reales).
 *
 * Devuelve un Map indexado por:
 *   - código de comuna (5 dígitos) si vino del CSV
 *   - nombre normalizado (siempre, para emparejar con el GeoJSON)
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
}

let cache: IneIndex | null = null;
let inflight: Promise<IneIndex> | null = null;

const buildFallbackFromCommunes = (): IneIndex => {
  const byName = new Map<string, IneCommuneStats>();
  for (const c of COMMUNES) {
    if (!c.pop && !c.density) continue; // skip placeholders
    byName.set(normalizeCommuneName(c.name), {
      poblacion: c.pop || null,
      superficie_km2: c.area || null,
      densidad: c.density || null,
      ingreso: null,
      nse: NSE_NUM_TO_LABEL[c.nse] ?? null,
    });
  }
  return { byCode: new Map(), byName };
};

const parseCSV = (text: string): IneIndex => {
  const byCode = new Map<string, IneCommuneStats>();
  const byName = new Map<string, IneCommuneStats>();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { byCode, byName };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  const iCode = idx("commune_id");
  const iName = idx("commune_name");
  const iPob = idx("poblacion");
  const iSup = idx("superficie_km2");
  const iIng = idx("ingreso_promedio");
  const iNse = idx("nse");

  if (iCode < 0 && iName < 0) {
    console.warn("[ineService] CSV sin columna commune_id ni commune_name");
    return { byCode, byName };
  }

  const num = (s: string | undefined): number | null => {
    if (!s) return null;
    const n = Number(s.replace(/[^\d.\-]/g, ""));
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

  // Fallback de nombres por código (si el CSV solo trae código necesitamos el GeoJSON)
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (!cols.length) continue;

    const code = iCode >= 0 ? cols[iCode]?.padStart(5, "0") : "";
    const name = iName >= 0 ? cols[iName] : "";
    const poblacion = num(cols[iPob]);
    const superficie = num(cols[iSup]);
    const ingreso = num(cols[iIng]);
    const nse = normNse(cols[iNse]);
    const densidad =
      poblacion != null && superficie != null && superficie > 0 ? poblacion / superficie : null;

    const stats: IneCommuneStats = {
      poblacion,
      superficie_km2: superficie,
      densidad,
      ingreso,
      nse,
    };

    if (code) byCode.set(code, stats);
    if (name) byName.set(normalizeCommuneName(name), stats);
  }

  return { byCode, byName };
};

export const loadIneIndex = async (): Promise<IneIndex> => {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    let csvIndex: IneIndex | null = null;
    try {
      const res = await fetch("/ine_communes.csv");
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && !ct.includes("text/html")) {
        const text = await res.text();
        csvIndex = parseCSV(text);
      }
    } catch (e) {
      console.warn("[ineService] /ine_communes.csv no disponible, usando fallback", e);
    }

    const fallback = buildFallbackFromCommunes();

    // Mezcla: CSV tiene prioridad; fallback rellena lo que falte por nombre.
    const byName = new Map(fallback.byName);
    if (csvIndex) {
      csvIndex.byName.forEach((v, k) => byName.set(k, v));
    }
    const byCode = csvIndex?.byCode ?? new Map();

    cache = { byCode, byName };
    inflight = null;
    return cache;
  })().catch((e) => {
    inflight = null;
    throw e;
  });

  return inflight;
};
