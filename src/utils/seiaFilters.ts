/** Utilidades puras de la capa «Proyectos SEIA»: filtros, argumentos de las RPC, estilos y formatos. Sin React ni Leaflet. */
import type { Bbox, SeiaFacets, SeiaFilters, SeiaGeoStatus, SeiaLayerDefaults, SeiaProjectRow } from "@/types/seia";

export const SEIA_DATASET = "seia_projects";
export const MAX_POINTS = 3000;

export const KIND_BY_SOURCE: Record<string, string> = { seia_proyectos_eia: "EIA", seia_proyectos_dia: "DIA" };

export const GEO_LABEL: Record<SeiaGeoStatus, string> = {
  inside: "Dentro de su comuna",
  near_border: "Cerca del borde de su comuna",
  outside_declared: "Fuera de su comuna declarada: ubicación dudosa",
  comuna_unmatched: "Comuna no identificada: ubicación sin validar",
  no_geometry: "Sin punto",
  pending: "Sin validar",
};

/** Estilo (opciones de Path de Leaflet) de un punto según la calidad de su ubicación. Lo dudoso se ve DISTINTO, no se oculta. */
export interface PointStyle { color: string; weight: number; fillColor: string; fillOpacity: number; dashArray?: string }
const ORANGE = "#f97316";
export const pointStyle = (status: SeiaGeoStatus): PointStyle => {
  switch (status) {
    case "inside": return { color: "#ffffff", weight: 1, fillColor: ORANGE, fillOpacity: 0.85 };
    case "near_border": return { color: "#b45309", weight: 2, fillColor: ORANGE, fillOpacity: 0.85 };
    case "outside_declared": return { color: "#dc2626", weight: 2, fillColor: "#dc2626", fillOpacity: 0.08, dashArray: "3 3" };
    default: return { color: "#6b7280", weight: 2, fillColor: "#6b7280", fillOpacity: 0.08, dashArray: "3 3" };   // sin validar
  }
};

/** Radio por inversión DECLARADA (escala log); sin dato = el más pequeño. */
export const radiusFor = (usd: number | null): number =>
  usd == null || !Number.isFinite(usd) || usd <= 0 ? 4 : Math.min(11, 4 + Math.log10(1 + usd / 1e6) * 3);

// ------------------------------------------------------------------ tipologías
/**
 * Código de tipología normalizado: minúsculas, sin espacios ni punto final («H.1 » → «h.1», «c.» → «c»). Igual que la RPC.
 * Se filtra por CÓDIGO EXACTO, no por letra: el sondeo real mostró que h.1 es inmobiliario pero h.2 (industrial) y h.3-h.6
 * (planes) no, y que un mismo código puede tener NOMBRES distintos según el año del reglamento.
 */
export const typologyCode = (letter: string | null | undefined): string | null => {
  const c = (letter ?? "").trim().replace(/\.+$/, "").trim().toLowerCase();
  return c === "" ? null : c;
};

export interface TypologyOption { code: string; n: number; names: string[] }
/** Códigos que EXISTEN en los datos (un mismo código con varios nombres se junta y conserva todos sus nombres). */
export const listTypologies = (typologies: SeiaFacets["typologies"] | undefined): TypologyOption[] => {
  const m = new Map<string, TypologyOption>();
  for (const t of typologies ?? []) {
    const c = typologyCode(t.letter);
    if (c == null) continue;
    const e = m.get(c) ?? { code: c, n: 0, names: [] };
    e.n += t.n;
    if (t.name && !e.names.includes(t.name)) e.names.push(t.name);
    m.set(c, e);
  }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
};

/** Un valor por defecto es un código («h.1») o un GRUPO («g» = g, g.1, g.2…): casa con el código igual o que empieza con «valor.». */
const matchesDefault = (code: string, d: string): boolean => code === d || code.startsWith(`${d}.`);

const asStringArray = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") ? (v as string[]) : null;

/** `thematic_layers.default_params` es JSON libre: se lee con tolerancia y sin suponer que está bien formado. */
export const parseSeiaDefaults = (params: unknown): SeiaLayerDefaults => {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const typology = asStringArray(p.typology)?.map(typologyCode).filter((c): c is string => c != null) ?? [];
  return { sourceKeys: asStringArray(p.source_keys), typology: typology.length ? typology : null };
};

export interface InitialFilters { filters: SeiaFilters; notice: string | null }
/**
 * Filtros iniciales: las tipologías por defecto de la hoja, EXPANDIDAS a los códigos que existen en los datos (así el panel
 * muestra exactamente qué está activo). Si ninguna existe, se muestran todas y se AVISA (una capa que nace vacía por un código
 * equivocado parecería rota).
 */
export const initialFilters = (defaults: SeiaLayerDefaults, facets: SeiaFacets): InitialFilters => {
  const base: SeiaFilters = { typology: null, statuses: null, yearFrom: null, yearTo: null, hideFlagged: false, sourceKeys: defaults.sourceKeys };
  if (!defaults.typology) return { filters: base, notice: null };
  const present = listTypologies(facets.typologies).map((o) => o.code);
  const expanded = present.filter((c) => defaults.typology!.some((d) => matchesDefault(c, d)));
  if (expanded.length === 0) {
    const real = present.length ? present.slice(0, 12).join(", ") + (present.length > 12 ? "…" : "") : "ninguna";
    return { filters: base, notice: `Ninguna de las tipologías configuradas (${defaults.typology.join(", ")}) existe en los datos cargados; se muestran todas. Tipologías reales: ${real}.` };
  }
  const missing = defaults.typology.filter((d) => !present.some((c) => matchesDefault(c, d)));
  return { filters: { ...base, typology: expanded }, notice: missing.length ? `La tipología configurada «${missing.join(", ")}» no existe en los datos y se omitió.` : null };
};

// ------------------------------------------------------------------ argumentos de las RPC
/** Un arreglo vacío significaría «ninguna» en la RPC; el panel solo expresa «todas», así que se envía null. */
const orNull = <T,>(a: T[] | null): T[] | null => (a && a.length > 0 ? a : null);

export const projectsArgs = (b: Bbox, f: SeiaFilters, limit = MAX_POINTS) => ({
  p_west: b.west, p_south: b.south, p_east: b.east, p_north: b.north,
  p_typology: orNull(f.typology), p_status: orNull(f.statuses), p_source_keys: orNull(f.sourceKeys),
  p_year_from: f.yearFrom, p_year_to: f.yearTo, p_hide_flagged: f.hideFlagged, p_limit: limit,
});

/** Recuadro con margen, redondeado hacia afuera: estabiliza la clave de la consulta y evita pedir de nuevo por un paneo mínimo. */
export const queryBbox = (b: Bbox, pad = 0.15, step = 0.05): Bbox => {
  const dx = (b.east - b.west) * pad, dy = (b.north - b.south) * pad;
  const down = (v: number) => Math.floor(v / step) * step;
  const up = (v: number) => Math.ceil(v / step) * step;
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  const west = r(Math.max(-180, down(b.west - dx))), south = r(Math.max(-90, down(b.south - dy)));
  let east = r(Math.min(180, up(b.east + dx))), north = r(Math.min(90, up(b.north + dy)));
  // un contenedor sin tamaño (pestaña oculta) da un recuadro de ancho 0, y la RPC lo rechaza: se le da el mínimo
  if (east <= west) east = r(west + step);
  if (north <= south) north = r(south + step);
  return { west, south, east, north };
};

// ------------------------------------------------------------------ resumen y formatos
export const activeFilterSummary = (f: SeiaFilters): string[] => {
  const out: string[] = [];
  if (f.typology) out.push(f.typology.length <= 4 ? `Tipologías: ${f.typology.join(", ")}` : `Tipologías: ${f.typology.length} códigos`);
  if (f.statuses) out.push(`Estados: ${f.statuses.length}`);
  if (f.yearFrom != null || f.yearTo != null) out.push(`Años: ${f.yearFrom ?? "…"}–${f.yearTo ?? "…"}`);
  if (f.sourceKeys && f.sourceKeys.length === 1) out.push(KIND_BY_SOURCE[f.sourceKeys[0]] ?? f.sourceKeys[0]);
  if (f.hideFlagged) out.push("Sin ubicaciones dudosas");
  return out;
};

export const formatUsd = (v: number | string | null | undefined): string => {
  if (v == null || v === "") return "no informada";
  const n = Number(v);
  return Number.isFinite(n) ? `US$ ${Math.round(n).toLocaleString("es-CL")}` : "no informada";
};
export const formatDate = (s: string | null | undefined): string => (s ? s.slice(0, 10).split("-").reverse().join("-") : "—");
export const formatCount = (n: number): string => n.toLocaleString("es-CL");

/** Enlace al expediente en e-SEIA: el que trae el servicio (URL_EXPEDIENTE); si no, uno CONSTRUIDO con el ID y el mismo patrón (marcado). */
export const expedienteLink = (p: { external_id: string; expediente_url: string | null }): { url: string; built: boolean } =>
  p.expediente_url
    ? { url: p.expediente_url, built: false }
    : { url: `https://seia.sea.gob.cl/expediente/expediente.php?id_expediente=${encodeURIComponent(p.external_id)}`, built: true };

/** El estado de la evaluación se muestra SIEMPRE (un proyecto desistido o rechazado no es lo mismo que uno aprobado). */
export const tooltipText = (r: SeiaProjectRow): string =>
  `${r.name ?? "(sin nombre)"} · ${r.kind} ${r.external_id} · ${r.status_declared ?? "estado no informado"}${r.geo_check_status === "inside" || r.geo_check_status === "near_border" ? "" : ` · ${GEO_LABEL[r.geo_check_status]}`}`;
