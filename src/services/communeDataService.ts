/**
 * Servicio para exportar/importar la información demográfica de comunas
 * desde y hacia un Excel. Aplica overrides sobre el array `COMMUNES`
 * (definido en src/data/communes.ts) y los persiste en localStorage para
 * que sobrevivan recargas de la sesión del usuario.
 *
 * NOTA: COMMUNES es estático en código, así que mutamos los registros
 * existentes in-place. Comunas que no existen en el array fuente se
 * ignoran al importar (los nombres deben coincidir exactamente).
 */
import * as XLSX from "xlsx";
import { COMMUNES, type Commune, type NSE } from "@/data/communes";

const STORAGE_KEY = "lovable.communeOverrides.v1";

type Overrides = Record<string, Partial<Commune>>;

const NUMERIC_FIELDS: Array<keyof Commune> = [
  "lat",
  "lng",
  "pop",
  "nse",
  "traffic",
  "density",
  "area",
  "hh",
];

/** Carga overrides almacenados y los aplica al array COMMUNES. */
export const applyStoredOverrides = (): number => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const overrides = JSON.parse(raw) as Overrides;
    return applyOverrides(overrides);
  } catch (err) {
    console.warn("[communeDataService] no se pudieron cargar overrides", err);
    return 0;
  }
};

const applyOverrides = (overrides: Overrides): number => {
  let applied = 0;
  for (const c of COMMUNES) {
    const patch = overrides[normalizeKey(c.name)];
    if (!patch) continue;
    for (const field of NUMERIC_FIELDS) {
      const v = patch[field];
      if (typeof v === "number" && Number.isFinite(v)) {
        // Mutación intencional: COMMUNES es la fuente única consumida por
        // toda la app, así que actualizamos sus valores en sitio.
        (c as unknown as Record<string, unknown>)[field] = clampNse(field, v);
      }
    }
    applied++;
  }
  return applied;
};

const clampNse = (field: keyof Commune, v: number): number => {
  if (field !== "nse") return v;
  const n = Math.round(v);
  return (Math.min(5, Math.max(1, n)) as NSE) as number;
};

const normalizeKey = (name: string) =>
  name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Normaliza un nombre de comuna para búsquedas (insensible a mayúsculas y acentos). */
export const normalizeCommuneName = (name: string) => normalizeKey(name);

/** Genera un Excel con un subconjunto arbitrario de comunas. */
export const exportCommunesSubsetToExcel = (
  rows: Commune[],
  filename = "comunas-busqueda.xlsx",
) => {
  const data = rows.map((c) => ({
    Comuna: c.name,
    Latitud: c.lat,
    Longitud: c.lng,
    Población: c.pop,
    "NSE (1=E,5=ABC1)": c.nse,
    "Tráfico (0-100)": c.traffic,
    "Densidad (hab/km²)": c.density,
    "Área (km²)": c.area,
    Hogares: c.hh,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [
    { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
    { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Comunas");
  XLSX.writeFile(wb, filename);
};

/** Genera y descarga un Excel con el snapshot completo de COMMUNES. */
export const exportCommunesToExcel = (filename = "comunas-demografia.xlsx") => {
  const rows = COMMUNES.map((c) => ({
    Comuna: c.name,
    Latitud: c.lat,
    Longitud: c.lng,
    Población: c.pop,
    "NSE (1=E,5=ABC1)": c.nse,
    "Tráfico (0-100)": c.traffic,
    "Densidad (hab/km²)": c.density,
    "Área (km²)": c.area,
    Hogares: c.hh,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  // Ancho de columnas razonable
  ws["!cols"] = [
    { wch: 28 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 20 },
    { wch: 14 },
    { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Comunas");
  XLSX.writeFile(wb, filename);
};

export interface ImportResult {
  matched: number;
  unknown: string[];
  totalRows: number;
}

/**
 * Lee un Excel y aplica los valores como overrides. Hace match por nombre
 * de comuna (insensible a mayúsculas y acentos). Persiste en localStorage
 * para que se mantengan al recargar la página.
 */
export const importCommunesFromExcel = async (
  file: File,
): Promise<ImportResult> => {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("El archivo no contiene hojas");
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const knownNames = new Map(COMMUNES.map((c) => [normalizeKey(c.name), c.name]));
  const overrides: Overrides = readStoredOverrides();
  const unknown: string[] = [];
  let matched = 0;

  for (const row of rows) {
    const name = pickString(row, ["Comuna", "comuna", "name", "Nombre"]);
    if (!name) continue;
    const key = normalizeKey(name);
    const canonical = knownNames.get(key);
    if (!canonical) {
      unknown.push(name);
      continue;
    }
    const patch: Partial<Commune> = {};
    const lat = pickNumber(row, ["Latitud", "lat", "latitude"]);
    const lng = pickNumber(row, ["Longitud", "lng", "lon", "longitude"]);
    const pop = pickNumber(row, ["Población", "Poblacion", "pop", "population"]);
    const nse = pickNumber(row, ["NSE (1=E,5=ABC1)", "NSE", "nse"]);
    const traffic = pickNumber(row, ["Tráfico (0-100)", "Trafico", "traffic"]);
    const density = pickNumber(row, [
      "Densidad (hab/km²)",
      "Densidad",
      "density",
    ]);
    const area = pickNumber(row, ["Área (km²)", "Area", "area"]);
    const hh = pickNumber(row, ["Hogares", "hh", "households"]);

    if (lat !== null) patch.lat = lat;
    if (lng !== null) patch.lng = lng;
    if (pop !== null) patch.pop = pop;
    if (nse !== null) patch.nse = clampNse("nse", nse) as NSE;
    if (traffic !== null) patch.traffic = traffic;
    if (density !== null) patch.density = density;
    if (area !== null) patch.area = area;
    if (hh !== null) patch.hh = hh;

    if (Object.keys(patch).length === 0) continue;
    overrides[normalizeKey(canonical)] = {
      ...(overrides[normalizeKey(canonical)] ?? {}),
      ...patch,
    };
    matched++;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  applyOverrides(overrides);

  return { matched, unknown, totalRows: rows.length };
};

const readStoredOverrides = (): Overrides => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Overrides) : {};
  } catch {
    return {};
  }
};

const pickString = (row: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

const pickNumber = (row: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
};

/** Borra overrides locales (no afecta el código fuente). */
export const clearCommuneOverrides = () => {
  localStorage.removeItem(STORAGE_KEY);
};
