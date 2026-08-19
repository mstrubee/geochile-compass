import * as XLSX from "xlsx";
import type { ImportRow, PoiFolderSchema } from "@/types/poiMetrics";
import { normalizeAddress } from "@/utils/addressNormalize";

/**
 * Parser de planilla AutoPlanet (wide-format).
 *
 * Estructura esperada (validada contra `schema.identity_columns`):
 *   - Columnas de identidad: "Centro Sap", "Local", "Nombre Local",
 *     "Dirección", "Comuna", "Gerente Zonal", "Zona"
 *   - Columnas mensuales: cada una es una fecha (datetime) que se
 *     interpreta como "primer día del mes" y representa la métrica
 *     `metric_definitions[0].key` (típicamente "ventas").
 *   - Columnas de resumen: "Máximo Histórico", "Mes Máximo Histórico"
 *     se ignoran (las recalculamos en lectura).
 */

export interface ParsedSheet {
  rows: ImportRow[];
  /** Períodos detectados (ISO YYYY-MM-DD), únicos. */
  periods: string[];
  /** Métricas detectadas (sólo "ventas" en este preset). */
  metricKeys: string[];
  /** Columnas no reconocidas (warnings). */
  unknownColumns: string[];
  /** Columnas de identidad que no aparecieron en el archivo. */
  missingIdentityColumns: string[];
}

const ADDRESS_COL = "Dirección";
const COMUNA_COL = "Comuna";

const SUMMARY_COLS = new Set(["Máximo Historico", "Máximo Histórico", "Mes Máximo Historico", "Mes Máximo Histórico"]);

/** Convierte una celda que contenga una fecha (string, número Excel o Date) a "YYYY-MM-01". */
const cellToPeriod = (cell: unknown): string | null => {
  if (cell == null) return null;
  // Date object
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    const y = cell.getUTCFullYear();
    const m = cell.getUTCMonth() + 1;
    return `${y}-${String(m).padStart(2, "0")}-01`;
  }
  // Excel serial number
  if (typeof cell === "number") {
    // SheetJS provee SSF pero usamos cellDates:true al parsear; igual cubrimos por si acaso.
    const epoch = new Date(Date.UTC(1899, 11, 30)); // Excel epoch (Windows)
    const ms = epoch.getTime() + cell * 86400000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  // String — intentar parsear formatos comunes
  if (typeof cell === "string") {
    const s = cell.trim();
    // "2024-03" / "2024-03-01" / "marzo 2024" / "mar-24"
    const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10);
      if (m >= 1 && m <= 12) return `${y}-${String(m).padStart(2, "0")}-01`;
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    }
  }
  return null;
};

const cellToNumber = (cell: unknown): number | null => {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number") return isFinite(cell) ? cell : null;
  if (typeof cell === "string") {
    const cleaned = cell.replace(/\$/g, "").replace(/\./g, "").replace(/,/g, ".").replace(/\s/g, "");
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }
  return null;
};

const cellToString = (cell: unknown): string => {
  if (cell == null) return "";
  if (typeof cell === "string") return cell.trim();
  if (typeof cell === "number") return String(cell);
  if (cell instanceof Date) return cell.toISOString();
  return String(cell);
};

/** Lee el archivo subido como ArrayBuffer y lo parsea. */
export interface ParseOptions {
  /**
   * Métrica temporal a la que escribir. Por defecto se usa la primera de
   * `metric_definitions` con `kind: "timeseries"` (históricamente "ventas").
   * Se indica explícitamente al importar presupuesto, que viaja por el mismo
   * pipeline pero a otra métrica.
   */
  metricKey?: string;
  /**
   * Año declarado al importar un presupuesto. Habilita reconocer una columna de
   * TOTAL ANUAL cuyo encabezado no es una fecha ("Presupuesto", "Meta 2025",
   * "Total"). Sin esto, un archivo con esa forma no aportaría ningún valor
   * porque la columna quedaría como desconocida.
   */
  annualColumnYear?: number;
}

const COMBINING_MARKS_RE = new RegExp(
  `[${String.fromCharCode(768)}-${String.fromCharCode(879)}]`, "g",
);

/** Palabras que, en una columna sin fecha, indican el total del año. */
const ANNUAL_HEADER_WORDS = ["presupuesto", "meta", "total", "ppto", "budget"];

const isAnnualTotalHeader = (name: string, year: number): boolean => {
  const norm = name
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
    .trim();
  if (!norm) return false;
  // Contiene el año declarado como token de 4 dígitos ("Meta 2025", "2025").
  if (new RegExp(`\\b${year}\\b`).test(norm)) return true;
  // O es una de las palabras típicas de total anual.
  return ANNUAL_HEADER_WORDS.some((w) => norm === w || norm.startsWith(`${w} `));
};

export const parseAutoPlanetSheet = async (
  file: File,
  schema: PoiFolderSchema,
  options?: ParseOptions,
): Promise<ParsedSheet> => parseAutoPlanetBuffer(await file.arrayBuffer(), schema, options);

/**
 * Igual que parseAutoPlanetSheet pero desde un buffer crudo, sin depender del
 * tipo `File` del navegador. Lo usa la sincronización automática desde Drive,
 * que corre en Node (ver scripts/sync-drive-sales.ts).
 */
export const parseAutoPlanetBuffer = (
  buf: ArrayBuffer | Uint8Array,
  schema: PoiFolderSchema,
  options?: ParseOptions,
): ParsedSheet => {
  const wb = XLSX.read(buf, { cellDates: true, type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("La planilla no tiene hojas legibles.");

  // Convertir a AOA preservando los tipos crudos (incluye Date).
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });
  if (!aoa.length) throw new Error("La planilla está vacía.");

  const headerRow = aoa[0] as unknown[];
  const dataRows = aoa.slice(1);

  const identityCols = new Set(schema.identity_columns);
  const staticCols = new Set(schema.static_columns);
  // Métrica destino: la pedida explícitamente (ej. presupuesto) o, por
  // compatibilidad, la primera de tipo timeseries (históricamente "ventas").
  const tsMetric = options?.metricKey
    ? schema.metric_definitions.find((m) => m.key === options.metricKey && m.kind === "timeseries")
    : schema.metric_definitions.find((m) => m.kind === "timeseries");
  if (!tsMetric) {
    throw new Error(
      options?.metricKey
        ? `El esquema de la carpeta no define la métrica temporal "${options.metricKey}".`
        : "El esquema de la carpeta no tiene métrica temporal definida.",
    );
  }

  // Clasificar columnas
  type ColMap =
    | { kind: "identity"; name: string }
    | { kind: "static"; name: string }
    | { kind: "period"; period: string }
    | { kind: "ignore" }
    | { kind: "unknown"; name: string };

  const colMap: ColMap[] = headerRow.map((h) => {
    const name = cellToString(h);
    if (!name) return { kind: "ignore" };
    if (SUMMARY_COLS.has(name)) return { kind: "ignore" };
    // Una columna puede ser identity Y static a la vez (e.g. "Centro Sap").
    if (identityCols.has(name) || staticCols.has(name)) {
      return { kind: identityCols.has(name) ? "identity" : "static", name };
    }
    // ¿Es un encabezado de período (Date)?
    const period = cellToPeriod(h);
    if (period) return { kind: "period", period };
    // Presupuesto con año declarado explícitamente: la columna del total anual
    // puede venir sin fecha en el encabezado ("Presupuesto", "Meta", "Total").
    // Se acepta como el total del año declarado, y así el año lo manda quien
    // importa en vez de depender de cómo esté escrito el encabezado.
    if (options?.annualColumnYear && isAnnualTotalHeader(name, options.annualColumnYear)) {
      return { kind: "period", period: `${options.annualColumnYear}-01-01` };
    }
    return { kind: "unknown", name };
  });

  // Validación
  const seenIdentity = new Set<string>();
  for (const c of colMap) if (c.kind === "identity") seenIdentity.add(c.name);
  const missingIdentity = schema.identity_columns.filter((c) => !seenIdentity.has(c));

  const periods = new Set<string>();
  const unknownCols: string[] = [];
  for (const c of colMap) {
    if (c.kind === "period") periods.add(c.period);
    if (c.kind === "unknown") unknownCols.push(c.name);
  }

  // Procesar filas
  const rows: ImportRow[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] as unknown[];
    const identity: Record<string, string> = {};
    const staticAttrs: Record<string, string> = {};
    const metrics: ImportRow["metrics"] = [];

    let rawAddress = "";
    let comuna: string | null = null;

    for (let j = 0; j < colMap.length; j++) {
      const cm = colMap[j];
      const v = row[j];
      if (cm.kind === "identity") {
        const s = cellToString(v);
        identity[cm.name] = s;
        if (cm.name === ADDRESS_COL) rawAddress = s;
        if (cm.name === COMUNA_COL) comuna = s || null;
        // identity también se guarda como static si está en static_columns (e.g. Centro Sap).
        if (staticCols.has(cm.name)) staticAttrs[cm.name] = s;
      } else if (cm.kind === "static") {
        staticAttrs[cm.name] = cellToString(v);
      } else if (cm.kind === "period") {
        const num = cellToNumber(v);
        if (num != null) metrics.push({ key: tsMetric.key, period: cm.period, value: num });
      }
    }

    // Saltar filas completamente vacías.
    const hasIdentity = Object.values(identity).some((v) => v && v.trim().length > 0);
    if (!hasIdentity && metrics.length === 0) continue;

    rows.push({
      rowIndex: i,
      identity,
      rawAddress,
      normalizedAddress: normalizeAddress(rawAddress),
      comuna,
      staticAttrs,
      metrics,
    });
  }

  return {
    rows,
    periods: Array.from(periods).sort(),
    metricKeys: [tsMetric.key],
    unknownColumns: unknownCols,
    missingIdentityColumns: missingIdentity,
  };
};
