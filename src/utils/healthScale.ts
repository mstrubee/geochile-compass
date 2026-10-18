/**
 * Salud, Fase 1a — etiquetas, colores, advertencias y funciones puras de las capas de establecimientos.
 * Todo texto de advertencia vive aquí para que panel, popup y ficha digan lo mismo (regla 3).
 */
import { AMBITO_ESTABLECIMIENTO } from "@/types/health";
import type {
  HealthAltaDef, HealthClase, HealthComplejidad, HealthComunaCountRow, HealthComunaTipoRow, HealthEstablishmentRow, HealthFilters, HealthGeoStatus, HealthSummaryRow,
} from "@/types/health";

export const DEPENDENCIA_LABEL: Record<string, string> = {
  municipal: "Municipal", privado: "Privado", servicio_salud: "Servicio de Salud", seremi: "SEREMI de Salud", delegado: "Delegado",
  otra_institucion: "Otra institución", ejercito: "Ejército", armada: "Armada", fach: "Fuerza Aérea", carabineros: "Carabineros", pdi: "PDI",
  gendarmeria: "Gendarmería", sin_dato: "Sin dato",
};
export const DEPENDENCIA_OPTIONS = Object.keys(DEPENDENCIA_LABEL);

export const COMPLEJIDAD_LABEL: Record<HealthComplejidad, string> = {
  alta: "Alta", mediana: "Mediana", baja: "Baja", no_aplica: "No aplica", sin_dato: "Sin dato (no es «baja»)",
};
export const CLASE_LABEL: Record<HealthClase, string> = { ambulatorio: "Ambulatorio", hospitalario: "Hospitalario", sin_clasificar: "Sin clasificar" };
export const CLASE_COLOR: Record<HealthClase, string> = { ambulatorio: "#2563eb", hospitalario: "#dc2626", sin_clasificar: "#6b7280" };

/** D1: dos definiciones, SIEMPRE etiquetadas. */
export const ALTA_LABEL: Record<HealthAltaDef, string> = {
  hospital: "Alta complejidad · solo hospitales",
  ampliada: "Alta complejidad ampliada · + clínicas y centros de especialidades",
};

export const GEO_STATUS_LABEL: Record<HealthGeoStatus, string> = {
  0: "Dentro de su comuna", 1: "Cerca del borde de su comuna", 2: "Costero (cae fuera del polígono, en el mar)",
  3: "FUERA de su comuna declarada (ubicación dudosa)", 4: "Sin coordenadas", 5: "Comuna sin polígono para validar", 6: "Coordenada inválida",
};
/** Estados que se dibujan con borde de aviso. */
export const GEO_MARKED: ReadonlySet<HealthGeoStatus> = new Set<HealthGeoStatus>([1, 2, 3]);
/** Estados sin punto en el mapa (el establecimiento sí cuenta en su comuna). */
export const GEO_NOT_DRAWN: ReadonlySet<HealthGeoStatus> = new Set<HealthGeoStatus>([4, 6]);

/** Nivel de respuesta (regla 9) y sello (regla 2): ejes independientes. */
export const LEVEL_SEAL = { level: "Respondida con rigor (conteo del registro oficial)", seal: "Oficial con advertencia" } as const;

export const WARN = {
  registry: "Es un registro de establecimientos: NO mide capacidad, dotación, camas ni acceso. Estar «en la comuna» no es ser accesible.",
  closedHidden: "Los establecimientos cerrados están ocultos. Actívelos para verlos.",
  closedShown: "Se incluyen establecimientos CERRADOS: no cuentan como oferta vigente.",
  imputed: (n: number, total: number) =>
    `${n} de ${total} establecimientos tienen la clase ambulatorio/hospitalario imputada por una tabla de diseño, no por la fuente (decisión nuestra, editable).`,
  altaDefs: "«Alta complejidad» tiene dos definiciones; el filtro dice cuál se usa.",
  marked: (n: number) => `${n} establecimientos tienen la ubicación marcada (borde, costero o fuera de su comuna declarada); se dibujan donde dice la fuente y cuentan en su comuna declarada.`,
  notDrawn: (n: number) => `${n} establecimientos no se dibujan (sin coordenadas o con coordenadas inválidas); sí cuentan en su comuna.`,
  noPolygon: "Las comunas sin polígono (p. ej. Antártica) no se pueden pintar; sus establecimientos sí figuran en el ranking.",
  privateDef: "«Privado» = dependencia administrativa Privado; no coincide con «sistema privado» ni con «no perteneciente al SNSS».",
  zeroTrue: "0 = la comuna no tiene ningún establecimiento que cumpla el filtro en el registro (cero verdadero).",
  counting: "Se cuentan TODOS los tipos de establecimiento del registro (consultas privadas, clínicas dentales, laboratorios, tomas de muestras, diálisis, vacunatorios, postas, hospitales…), no solo los que atienden pacientes. Filtre por tipo para acotar.",
  heterogeneity: "El registro NO es homogéneo entre regiones: la cantidad de establecimientos privados (consultas dentales, centros de especialidades, tomas de muestras) varía entre regiones de un modo que la población no explica. La causa NO está comprobada (consulta pendiente a la SEREMI de Salud de Coquimbo y al DEIS). El conteo NO es oferta ni es comparable entre comunas o regiones (ver HALLAZGOS_FASE1A §7).",
  reportRule: "En informes para clientes NO se publica el ranking nacional o interregional de «todos los establecimientos»: solo cortes asistenciales comparables (público; hospitales y clínicas) o comparaciones dentro de una misma región.",
  notClientReady: "Capa aún NO apta para clientes (client_ready = false): no entra a informes ni exportaciones.",
} as const;

const nf = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
export const fmtN = (n: number | null | undefined) => (n == null ? "sin dato" : nf.format(n));

const isDefaultAmbito = (a: string[] | null) => a != null && a.length === 1 && a[0] === AMBITO_ESTABLECIMIENTO;

export const hasActiveFilters = (f: HealthFilters) =>
  f.includeClosed || f.alta != null || !isDefaultAmbito(f.ambito) || (f.tipo?.length ?? 0) > 0 || (f.dependencia?.length ?? 0) > 0 || (f.complejidad?.length ?? 0) > 0 || (f.clase?.length ?? 0) > 0;

/** Etiqueta corta del filtro activo, para rotular el ranking y la leyenda. */
export const filterLabel = (f: HealthFilters): string => {
  const parts: string[] = [];
  parts.push(f.alta ? ALTA_LABEL[f.alta] : "Todos los establecimientos");
  if (f.dependencia?.length) parts.push(f.dependencia.map((d) => DEPENDENCIA_LABEL[d] ?? d).join(" o "));
  if (f.complejidad?.length) parts.push(`complejidad ${f.complejidad.map((c) => COMPLEJIDAD_LABEL[c]).join(" o ").toLowerCase()}`);
  if (f.clase?.length) parts.push(f.clase.map((c) => CLASE_LABEL[c]).join(" o ").toLowerCase());
  parts.push(f.includeClosed ? "vigentes y cerrados" : "vigentes");
  return parts.join(" · ");
};

/** «Qué se está contando»: lo dice el panel junto a cada número. `tipoLabels` mapea tipo_norm → etiqueta. */
export const countingText = (f: HealthFilters, tipoLabels: Record<string, string> = {}): string => {
  const tipo = f.tipo?.length ? `solo ${f.tipo.map((t) => tipoLabels[t] ?? t).join(" o ")}` : "todos los tipos";
  const ambito = f.ambito == null ? "incluye unidades de atención y programas" : isDefaultAmbito(f.ambito) ? "solo establecimientos (sin unidades de atención ni programas)" : `ámbito ${f.ambito.join(" o ")}`;
  return `Se cuenta: ${tipo} · ${ambito} · ${f.includeClosed ? "vigentes y cerrados" : "solo vigentes"}.`;
};

export interface RankingRow { cut: string; name: string; regionName: string; n: number; rank: number; imputed: number }

/** Ranking de comunas por conteo. `desc` = las que más tienen; `asc` = las que menos (incluye los ceros verdaderos). Empates por nombre. */
export const rankComunas = (rows: HealthComunaCountRow[] | undefined, order: "desc" | "asc", limit = 10, regionCut: string | null = null): RankingRow[] => {
  const base = (rows ?? []).filter((r) => regionCut == null || r.region_cut === regionCut);
  const sorted = [...base].sort((a, b) => (order === "desc" ? b.establishments - a.establishments : a.establishments - b.establishments) || a.name.localeCompare(b.name, "es"));
  return sorted.slice(0, limit).map((r) => ({ cut: r.cut, name: r.name, regionName: r.region_name, n: r.establishments, rank: r.rank, imputed: r.imputed }));
};

export const totalEstablishments = (rows: HealthComunaCountRow[] | undefined) => (rows ?? []).reduce((a, r) => a + r.establishments, 0);
export const totalImputed = (rows: HealthComunaCountRow[] | undefined) => (rows ?? []).reduce((a, r) => a + r.imputed, 0);
export const totalNotDrawable = (rows: HealthComunaCountRow[] | undefined) => (rows ?? []).reduce((a, r) => a + r.not_drawable, 0);
export const totalMarked = (rows: HealthComunaCountRow[] | undefined) => (rows ?? []).reduce((a, r) => a + r.marked_geo, 0);

export const summaryN = (rows: HealthSummaryRow[] | undefined, dimension: string, value?: string): number | null => {
  const r = (rows ?? []).find((x) => x.dimension === dimension && (value == null || x.value === value));
  return r ? r.n : null;
};

/** Texto del popup de un punto: siempre dice la clase (y si es imputada), la ubicación marcada y el estado. */
export const claseText = (r: Pick<HealthEstablishmentRow, "clase_servicio" | "clase_fuente">): string =>
  r.clase_fuente === "tabla" ? `${CLASE_LABEL[r.clase_servicio]} (imputada por tabla de diseño, no por la fuente)`
  : r.clase_fuente === "sin_clasificar" ? "Sin clasificar (la fuente no la declara)" : CLASE_LABEL[r.clase_servicio];

/** Radio del punto: más grande para alta complejidad (según la definición ampliada, que incluye a la de hospitales). */
export const pointRadius = (r: Pick<HealthEstablishmentRow, "alta_ampliada">): number => (r.alta_ampliada ? 8 : 5);

/** Agrupa las filas (tipo, ámbito, estado) por tipo para mostrarlas en una tabla; el orden lo trae la RPC (más vigentes primero). */
export const breakdownByTipo = (rows: HealthComunaTipoRow[]) => {
  const m = new Map<string, { tipo: string; vigentes: number; cerrados: number; ambitos: string[] }>();
  for (const r of rows) {
    const e = m.get(r.tipo_glosa) ?? { tipo: r.tipo_glosa.replace(/\s+/g, " "), vigentes: 0, cerrados: 0, ambitos: [] };
    if (r.estado === "vigente") e.vigentes += r.n; else e.cerrados += r.n;
    const a = r.ambito ?? "sin ámbito";
    if (!e.ambitos.includes(a)) e.ambitos.push(a);
    m.set(r.tipo_glosa, e);
  }
  return [...m.values()];
};
