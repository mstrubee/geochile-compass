/**
 * Exporta un listado simple de locales de una carpeta de POIs (con subcarpetas),
 * una fila por local, como Excel (.xlsx, con hoja de metadatos) o CSV.
 *
 * Los valores vienen de la planilla importada (poi_attributes). Solo cuando el
 * dato falta se calcula por coordenadas (comuna) y la región siempre sale de las
 * coordenadas. Nunca se inventa un valor: si no hay dato, la celda queda vacía.
 */
import * as XLSX from "xlsx";
import { POI_STATUS_LABEL, type PoiFolder, type SavedPoi } from "@/types/pois";
import { reverseGeocodeCommune } from "@/utils/communeReverseGeocode";
import { compareNatural } from "@/utils/naturalSort";
import type { ExportResult } from "@/services/exportFolderDataset";
import {
  collectFolderIds,
  fetchPoiAttributes,
  folderPathOf,
  makeCsvEscape,
  slugify,
  triggerDownload,
} from "@/services/exportFolderShared";

export type LocalesFormat = "xlsx" | "csv";

const ATTR = {
  local: "Local",
  centroSap: "Centro Sap",
  nombre: "Nombre Local",
  direccion: "Dirección",
  comuna: "Comuna",
} as const;

/** Nombres oficiales (con tildes) por código de región INE; codigos_territoriales.csv los trae sin tildes. */
export const REGION_NAMES: Record<string, string> = {
  "01": "Tarapacá",
  "02": "Antofagasta",
  "03": "Atacama",
  "04": "Coquimbo",
  "05": "Valparaíso",
  "06": "Libertador General Bernardo O'Higgins",
  "07": "Maule",
  "08": "Biobío",
  "09": "La Araucanía",
  "10": "Los Lagos",
  "11": "Aysén del General Carlos Ibáñez del Campo",
  "12": "Magallanes y de la Antártica Chilena",
  "13": "Región Metropolitana de Santiago",
  "14": "Los Ríos",
  "15": "Arica y Parinacota",
  "16": "Ñuble",
};

export const regionNameFromCode = (code: string | null | undefined): string =>
  (code && REGION_NAMES[code.slice(0, 2)]) || "";

/** Minúsculas, sin tildes y con espacios colapsados: para comparar nombres de comuna. */
export const normalizeName = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Fecha y hora en America/Santiago: `date` = YYYYMMDD (para el nombre de archivo), `dateTime` = "YYYY-MM-DD HH:mm:ss". */
export const santiagoStamp = (d: Date): { date: string; dateTime: string } => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return {
    date: `${p("year")}${p("month")}${p("day")}`,
    dateTime: `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}:${p("second")}`,
  };
};

export interface LocalesRow {
  numLocal: string;
  nombre: string;
  direccion: string;
  comuna: string;
  region: string;
  lat: number | null;
  lng: number | null;
  estado: string;
  carpeta: string;
  /** Trazabilidad para la hoja Metadatos; no se escribe en el listado. */
  source: {
    numLocal: "Local" | "Centro Sap" | null;
    nombre: "atributo" | "poi";
    direccion: "atributo" | "address" | "direccion" | null;
    comuna: "planilla" | "coordenadas" | null;
  };
  /** Comuna calculada por coordenadas (null si el punto cae fuera de los límites comunales). */
  comunaCoordenadas: string | null;
  /** La comuna de la planilla no coincide con la calculada por coordenadas. */
  discrepancia: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const hasCoords = (p: SavedPoi) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Arma las filas (ya ordenadas) del listado de locales. */
export const buildLocalesRows = async (
  pois: SavedPoi[],
  attrsByPoi: Map<string, Map<string, string>>,
  folderById: Map<string, PoiFolder>,
  includeFolder: boolean,
): Promise<LocalesRow[]> => {
  const rows = await Promise.all(
    pois.map(async (p): Promise<LocalesRow> => {
      const attr = (key: string) => (attrsByPoi.get(p.id)?.get(key) ?? "").trim();
      const props = (p.properties ?? {}) as Record<string, unknown>;

      const local = attr(ATTR.local);
      const centroSap = local ? "" : attr(ATTR.centroSap);
      const nombreAttr = attr(ATTR.nombre);
      const dirAttr = attr(ATTR.direccion);
      const dirAddress = dirAttr ? "" : str(props.address);
      const dirDireccion = dirAttr || dirAddress ? "" : str(props.direccion);
      const comunaAttr = attr(ATTR.comuna);

      const geo = hasCoords(p) ? await reverseGeocodeCommune(p.lat, p.lng) : null;

      return {
        numLocal: local || centroSap,
        nombre: nombreAttr || p.name,
        direccion: dirAttr || dirAddress || dirDireccion,
        comuna: comunaAttr || geo?.name || "",
        region: regionNameFromCode(geo?.region_codigo),
        lat: hasCoords(p) ? Number(p.lat.toFixed(6)) : null,
        lng: hasCoords(p) ? Number(p.lng.toFixed(6)) : null,
        estado: POI_STATUS_LABEL[p.operational_status ?? "operativo"] ?? String(p.operational_status),
        carpeta: includeFolder ? folderPathOf(p.folder_id, folderById) : "",
        source: {
          numLocal: local ? "Local" : centroSap ? "Centro Sap" : null,
          nombre: nombreAttr ? "atributo" : "poi",
          direccion: dirAttr ? "atributo" : dirAddress ? "address" : dirDireccion ? "direccion" : null,
          comuna: comunaAttr ? "planilla" : geo ? "coordenadas" : null,
        },
        comunaCoordenadas: geo?.name ?? null,
        discrepancia: !!comunaAttr && !!geo && normalizeName(comunaAttr) !== normalizeName(geo.name),
      };
    }),
  );
  return rows.sort((a, b) => compareNatural(a.numLocal, b.numLocal) || compareNatural(a.nombre, b.nombre));
};

const HEADERS = ["N° local", "Nombre", "Dirección", "Comuna", "Región", "Latitud", "Longitud", "Estado", "Carpeta"];
const headersFor = (includeFolder: boolean) => (includeFolder ? HEADERS : HEADERS.slice(0, -1));

/** Un N° local es numérico solo si el número reproduce el texto (así "007" conserva sus ceros). */
const numericLocal = (s: string): number | null => {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && String(n) === s ? n : null;
};

/** CSV del listado: BOM UTF-8, separador ";" y "." decimal con 6 decimales en lat/lng. */
export const localesToCsv = (rows: LocalesRow[], includeFolder: boolean): string => {
  const esc = makeCsvEscape(",;");
  const lines = [headersFor(includeFolder).map(esc).join(";")];
  for (const r of rows) {
    const cells: unknown[] = [
      r.numLocal,
      r.nombre,
      r.direccion,
      r.comuna,
      r.region,
      r.lat === null ? "" : r.lat.toFixed(6),
      r.lng === null ? "" : r.lng.toFixed(6),
      r.estado,
    ];
    if (includeFolder) cells.push(r.carpeta);
    lines.push(cells.map(esc).join(";"));
  }
  return "﻿" + lines.join("\r\n");
};

const LAT_LNG_FORMAT = "0.000000";

const buildLocalesSheet = (rows: LocalesRow[], includeFolder: boolean): XLSX.WorkSheet => {
  const headers = headersFor(includeFolder);
  const aoa: Array<Array<string | number | null>> = [headers];
  for (const r of rows) {
    const cells: Array<string | number | null> = [
      numericLocal(r.numLocal) ?? (r.numLocal || null),
      r.nombre || null,
      r.direccion || null,
      r.comuna || null,
      r.region || null,
      r.lat,
      r.lng,
      r.estado,
    ];
    if (includeFolder) cells.push(r.carpeta || null);
    aoa.push(cells);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  for (let i = 1; i < aoa.length; i++) {
    for (const c of [5, 6]) {
      const cell = ws[XLSX.utils.encode_cell({ r: i, c })];
      if (cell && cell.t === "n") cell.z = LAT_LNG_FORMAT;
    }
  }
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: headers.length - 1 } }),
  };
  ws["!cols"] = headers.map((_, c) => ({
    wch: Math.min(60, Math.max(8, ...aoa.map((row) => String(row[c] ?? "").length)) + 2),
  }));
  return ws;
};

const countBy = <T,>(rows: LocalesRow[], pick: (r: LocalesRow) => T): Map<T, number> => {
  const m = new Map<T, number>();
  for (const r of rows) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1);
  return m;
};

const buildMetadataSheet = (
  folder: PoiFolder,
  rows: LocalesRow[],
  includeFolder: boolean,
  exportedAt: string,
): XLSX.WorkSheet => {
  const n = (m: Map<unknown, number>, k: unknown) => m.get(k) ?? 0;
  const local = countBy(rows, (r) => r.source.numLocal);
  const nombre = countBy(rows, (r) => r.source.nombre);
  const dir = countBy(rows, (r) => r.source.direccion);
  const comuna = countBy(rows, (r) => r.source.comuna);
  const sinRegion = rows.filter((r) => !r.region).length;
  const discrepancias = rows
    .map((r, i) => ({ r, fila: i + 2 })) // fila 1 de «Locales» son los encabezados
    .filter(({ r }) => r.discrepancia);

  const aoa: Array<Array<string | number | null>> = [
    ["Listado de locales · metadatos"],
    [],
    ["Carpeta exportada", folder.name],
    ["Alcance", includeFolder ? "La carpeta y todas sus subcarpetas" : "La carpeta (no tiene subcarpetas)"],
    ["Fecha y hora de exportación (America/Santiago)", exportedAt],
    ["N° de locales", rows.length],
    [],
    ["Fuente de cada columna"],
    ["Columna", "Filas por origen", "Fuente"],
    [
      "N° local",
      `Local: ${n(local, "Local")} · Centro Sap: ${n(local, "Centro Sap")} · vacío: ${n(local, null)}`,
      "Planilla importada: atributo «Local»; si falta, «Centro Sap». Sin ninguno queda vacío.",
    ],
    [
      "Nombre",
      `Planilla: ${n(nombre, "atributo")} · nombre del POI: ${n(nombre, "poi")}`,
      "Planilla importada: atributo «Nombre Local»; si falta, el nombre del POI.",
    ],
    [
      "Dirección",
      `Planilla: ${n(dir, "atributo")} · propiedades del POI: ${n(dir, "address") + n(dir, "direccion")} · vacío: ${n(dir, null)}`,
      "Planilla importada: atributo «Dirección»; si falta, propiedades del POI (address / direccion).",
    ],
    [
      "Comuna",
      `Planilla: ${n(comuna, "planilla")} · calculada: ${n(comuna, "coordenadas")} · vacío: ${n(comuna, null)}`,
      "Planilla importada: atributo «Comuna»; si falta, calculada por coordenadas con los límites comunales INE.",
    ],
    [
      "Región",
      `Calculada: ${rows.length - sinRegion} · sin dato: ${sinRegion}`,
      "Calculada por coordenadas con los límites comunales INE (región de la comuna que contiene el punto).",
    ],
    ["Latitud / Longitud", "", "Coordenadas del POI, 6 decimales."],
    ["Estado", "", "Estado operativo del POI en la plataforma."],
  ];
  if (includeFolder) aoa.push(["Carpeta", "", "Ruta de la carpeta del POI en la plataforma."]);

  aoa.push([], [`Discrepancias de comuna (planilla vs. coordenadas): ${discrepancias.length}`]);
  if (discrepancias.length === 0) {
    aoa.push(["Sin discrepancias."]);
  } else {
    aoa.push(["En la hoja «Locales» se conserva la comuna de la planilla; la Región sale de las coordenadas."]);
    aoa.push(["Fila en «Locales»", "N° local", "Nombre", "Comuna (planilla)", "Comuna (coordenadas)", "Región (coordenadas)"]);
    for (const { r, fila } of discrepancias) {
      aoa.push([fila, r.numLocal || null, r.nombre, r.comuna, r.comunaCoordenadas, r.region || null]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 46 }, { wch: 52 }, { wch: 40 }, { wch: 24 }, { wch: 24 }, { wch: 30 }];
  return ws;
};

export const buildLocalesWorkbook = (
  folder: PoiFolder,
  rows: LocalesRow[],
  includeFolder: boolean,
  exportedAt: string,
): XLSX.WorkBook => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildLocalesSheet(rows, includeFolder), "Locales");
  XLSX.utils.book_append_sheet(wb, buildMetadataSheet(folder, rows, includeFolder, exportedAt), "Metadatos");
  return wb;
};

const ATTR_KEYS = Object.values(ATTR);

export const exportFolderLocales = async (
  folder: PoiFolder,
  allFolders: PoiFolder[],
  allPois: SavedPoi[],
  format: LocalesFormat,
): Promise<ExportResult> => {
  const targetFolders = collectFolderIds(folder.id, allFolders);
  const folderById = new Map(allFolders.map((f) => [f.id, f] as const));
  const includeFolder = targetFolders.size > 1;

  const poisInScope = allPois.filter((p) => !p.deleted_at && p.folder_id && targetFolders.has(p.folder_id));
  if (poisInScope.length === 0) {
    throw new Error("La carpeta no contiene POIs activos");
  }

  const attrRows = await fetchPoiAttributes(
    poisInScope.map((p) => p.id),
    ATTR_KEYS,
  );
  const attrsByPoi = new Map<string, Map<string, string>>();
  for (const r of attrRows) {
    let m = attrsByPoi.get(r.poi_id);
    if (!m) {
      m = new Map();
      attrsByPoi.set(r.poi_id, m);
    }
    m.set(r.attr_key, r.attr_value ?? "");
  }

  let rows: LocalesRow[];
  try {
    rows = await buildLocalesRows(poisInScope, attrsByPoi, folderById, includeFolder);
  } catch (err) {
    throw new Error(
      `No se pudieron calcular las comunas por coordenadas: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const now = santiagoStamp(new Date());
  const base = `locales_${slugify(folder.name)}_${now.date}`;
  const columns = headersFor(includeFolder).length;

  if (format === "xlsx") {
    const wb = buildLocalesWorkbook(folder, rows, includeFolder, now.dateTime);
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    triggerDownload(blob, `${base}.xlsx`);
    return { rows: rows.length, columns, filename: `${base}.xlsx` };
  }

  const blob = new Blob([localesToCsv(rows, includeFolder)], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${base}.csv`);
  return { rows: rows.length, columns, filename: `${base}.csv` };
};
