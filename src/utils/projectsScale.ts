/**
 * Parte 4 — escalas, etiquetas y formatos de las capas de permisos georreferenciados (INE), recepciones finales (INE) y proyectos SEIA.
 * Todo texto de advertencia vive aquí para que paneles, leyendas y popups digan lo mismo.
 */
import type { PermitPrecision, PermitUso, PointGeoStatus, ProjectGeoStatus } from "@/types/projects";

const nf = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
export const fmtInt = (v: number | null | undefined) => (v == null ? "sin dato" : nf.format(v));
export const fmtUsd = (v: number | null | undefined) => (v == null ? "no declarada" : `US$ ${nf.format(v)}`);
export const fmtDate = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("-") : null);

export const USO_LABEL: Record<PermitUso, string> = { 1: "Habitacional", 2: "Mixto", 3: "No habitacional" };
export const USO_COLOR: Record<PermitUso, string> = { 1: "#2563eb", 2: "#9333ea", 3: "#ea580c" };
export const PRECISION_LABEL: Record<PermitPrecision, string> = { 3: "Alta", 2: "Moderada", 1: "Baja", 0: "Sin dato" };
/** Opacidad de relleno: cuanto menos preciso, más tenue. Nunca se dibuja una ubicación dudosa como si fuera exacta. */
export const PRECISION_OPACITY: Record<PermitPrecision, number> = { 3: 0.85, 2: 0.6, 1: 0.3, 0: 0.2 };
export const MIN_PRECISION_OPTIONS: Array<{ value: PermitPrecision; label: string }> = [
  { value: 2, label: "Moderada o alta (por defecto)" },
  { value: 3, label: "Solo alta" },
  { value: 1, label: "Incluir baja" },
  { value: 0, label: "Incluir baja y sin dato" },
];

export const PE_GEO_STATUS_LABEL: Record<PointGeoStatus, string> = {
  0: "Dentro de su comuna", 1: "Cerca del borde de su comuna", 2: "Fuera de su comuna declarada", 3: "Comuna sin polígono para validar",
};

export const SEIA_GEO_STATUS_LABEL: Record<ProjectGeoStatus, string> = {
  0: "Dentro de la comuna declarada", 1: "Cerca del borde de la comuna declarada", 2: "FUERA de la comuna declarada (ubicación dudosa)",
  3: "La comuna declarada no se pudo cruzar", 4: "Sin ubicación", 5: "Comuna sin polígono para validar",
};
/** Estados de ubicación que la leyenda debe advertir. */
export const SEIA_DOUBTFUL: ReadonlySet<ProjectGeoStatus> = new Set<ProjectGeoStatus>([2, 3]);

export const SEIA_STATE_COLOR: Record<string, string> = {
  "Aprobado": "#16a34a", "En Calificación": "#2563eb", "Desistido": "#9ca3af", "No Admitido a Tramitación": "#9ca3af",
  "Rechazado": "#dc2626", "No calificado": "#6b7280", "Abandonado": "#9ca3af", "Caducado": "#9ca3af", "Revocado": "#b91c1c", "Renuncia RCA": "#9ca3af",
};
export const stateColor = (s: string) => SEIA_STATE_COLOR[s] ?? "#6b7280";
/** Punto exactamente sobre un grado entero de lat y lon: coordenadas redondeadas en la fuente (X/Y crudos), no una ubicación real. */
export const isCoarseLocation = (r: { lon: number; lat: number }) => Number.isInteger(r.lon) && Number.isInteger(r.lat);
export const SEIA_DEFAULT_STATES = ["Aprobado", "En Calificación"];

// ---------------------------------------------------------------------------------------------- advertencias
export const WARN = {
  yearOnly: "Solo hay año: la fuente no trae mes ni fecha del permiso.",
  noPermitNumber: "Sin número de permiso ni dirección (el INE los eliminó el 30-12-2020 por secreto estadístico).",
  recordNotPermit: "Un punto NO es un permiso: agrupa varias unidades. Sume «unidades»; el número de puntos no es comparable entre 2019 y 2020.",
  lowPrecisionExcluded: "Las ubicaciones de precisión baja o sin dato se excluyen por defecto.",
  crfNotPermit: "Un certificado de recepción final es una obra TERMINADA, no un permiso: no se suma ni se mezcla con los permisos.",
  seiaScope: "Solo proyectos que ingresan al SEIA (no es un catastro de edificación).",
  seiaQualified: "La fecha de calificación NO es un permiso de edificación ni el inicio de obras.",
  seiaInvestment: "La inversión es la DECLARADA por el titular, no la ejecutada.",
  seiaCoarse: "Ubicación APROXIMADA: la fuente trae las coordenadas redondeadas a grado entero (puede estar a decenas de km del proyecto real).",
  seiaTypology: "La tipología «inmobiliaria» incluye proyectos no residenciales (fábricas, centros comerciales…).",
} as const;

export const coverageWarning = (c: { comunas: number; comunas_total: number } | undefined) =>
  c ? `Cobertura parcial: ${c.comunas} de ${c.comunas_total} comunas con datos este año; la lista de comunas cambia de un año a otro.` : "Cobertura parcial de comunas (la fuente no cubre todo el país).";

/** Radio (px) de un cluster por sus unidades; escala logarítmica para que 10 y 100.000 sean legibles. */
export const clusterRadius = (units: number): number => Math.round(8 + Math.min(Math.log10(Math.max(units, 1)) * 5.5, 26));

/** Solo http(s): un enlace de la fuente que no lo sea (javascript:, data:) no se renderiza como enlace. */
export const safeHttpUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Redondea la caja a ~1 km para que mover el mapa un poco no dispare una consulta nueva ni rompa la caché. */
export const roundBounds = (b: { west: number; south: number; east: number; north: number }, digits = 2) => {
  const r = (x: number) => Number(x.toFixed(digits));
  return { west: r(b.west), south: r(b.south), east: r(b.east), north: r(b.north) };
};
