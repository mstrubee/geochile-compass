/**
 * Salud, Fase 1b — clases de color DISCRETAS de la capa «Isapre: beneficiarios por comuna» (las dos métricas usan la misma familia de color).
 * Funciones puras (sin React ni Leaflet) para poder probarlas.
 *
 * PALETA: viridis de 7 clases (matplotlib/viridisLite). Se eligió porque (medido sobre las capas base Oscuro #262626, Claro #f0f0ee y tres tonos de Satélite, con el relleno al 70 %):
 *  · la luminosidad (L*) sube de forma monótona de la clase 1 a la 7 (15 → 91): se lee «menor → mayor» también en blanco y negro;
 *  · la diferencia de color (ΔE*ab) mínima entre clases contiguas es ≥ 19 con visión normal, ≥ 13 simulando protanopía, ≥ 10 deuteranopía y ≥ 9 tritanopía (Machado 2009);
 *  · cada clase se separa del mapa base con ΔE* ≥ 21 en las cinco bases probadas;
 *  · es multitono (púrpura → azul → verde → amarillo), a diferencia de un degradado de un solo tono que sobre el satélite se ve gris.
 * Alternativas medidas y descartadas: YlGnBu (la clase 1 casi blanca no se separa del mapa Claro, ΔE 17,6; protanopía ΔE 6,2), YlOrRd (deuteranopía ΔE 5,7), plasma (tritanopía ΔE 4,9).
 *
 * Una comuna se clasifica por el PUNTO MEDIO de su rango publicado. Un valor igual a un límite cae en la clase SUPERIOR (2 % → «2–5 %»). El 0 tiene su propia clase y «sin dato» su propio estilo.
 */

export const FILL_OPACITY = 0.7;
export const VIRIDIS_7 = ["#440154", "#443a83", "#31688e", "#21908d", "#35b779", "#8fd744", "#fde725"] as const;
/** 0 publicado: un neutro cálido que no pertenece a la familia viridis (no se lee como «clase más baja») ni se confunde con «sin dato». */
export const ZERO_COLOR = "#d6cfc4";
export const NODATA_COLOR = "#9ca3af";
export const NODATA_FILL_OPACITY = 0.4;

export interface ClassScale {
  id: "n" | "pct";
  /** límites inferiores de las clases 2..7 (la clase 1 empieza en 0); un valor igual al límite cae en la clase superior */
  cuts: readonly number[];
  /** una etiqueta por clase (7) */
  labels: readonly string[];
  zeroLabel: string;
}

const nf = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

/** Penetración (% de la población censada 2024): cortes redondos y FIJOS para todas las edades, 60+ y por sexo. */
export const PCT_SCALE: ClassScale = {
  id: "pct",
  cuts: [2, 5, 10, 20, 35, 50],
  labels: ["0–2 %", "2–5 %", "5–10 %", "10–20 %", "20–35 %", "35–50 %", "≥ 50 %"],
  zeroLabel: "0 % (cero publicado)",
};

/**
 * Beneficiarios Isapre (n.º): progresión 1-3-10 (media década) con la captura real (dic-2025, 346 comunas, todas las edades y ambos sexos): 49 · 62 · 88 · 55 · 34 · 34 · 24 comunas por clase.
 * Los cuantiles anteriores dejaban todas las comunas urbanas en una sola clase (≥ 5.893 = percentil 80).
 */
export const N_SCALE: ClassScale = {
  id: "n",
  cuts: [100, 300, 1_000, 3_000, 10_000, 30_000],
  labels: ["< 100", "100 – <300", "300 – <1.000", "1.000 – <3.000", "3.000 – <10.000", "10.000 – <30.000", `≥ ${nf.format(30_000)}`],
  zeroLabel: "0 (cero publicado)",
};

export type Classified =
  | { kind: "nodata"; color: string; fillOpacity: number; dashed: true }
  | { kind: "zero"; color: string; fillOpacity: number; dashed: false; label: string }
  | { kind: "class"; color: string; fillOpacity: number; dashed: false; index: number; label: string };

/** Índice de clase 0..6 de un valor > 0: cuántos límites alcanza (igual al límite ⇒ clase superior). */
export const classIndex = (scale: ClassScale, v: number): number => scale.cuts.filter((c) => v >= c).length;

export const classify = (scale: ClassScale, v: number | null | undefined): Classified => {
  if (v == null || !Number.isFinite(v)) return { kind: "nodata", color: NODATA_COLOR, fillOpacity: NODATA_FILL_OPACITY, dashed: true };
  if (v === 0) return { kind: "zero", color: ZERO_COLOR, fillOpacity: FILL_OPACITY, dashed: false, label: scale.zeroLabel };
  const index = classIndex(scale, v);
  return { kind: "class", color: VIRIDIS_7[index], fillOpacity: FILL_OPACITY, dashed: false, index, label: scale.labels[index] };
};

/** Posición ordenada de un valor: 0 = «0» (clase propia), 1..7 = clases. */
const pos = (scale: ClassScale, v: number): number => (v === 0 ? 0 : 1 + classIndex(scale, v));
const posLabel = (scale: ClassScale, p: number): string => (p === 0 ? scale.zeroLabel.replace(" (cero publicado)", "") : scale.labels[p - 1]);

/** Si el rango [lo, hi] cruza clases: texto para la ventana de la comuna («el rango abarca dos clases»); null si cae en una sola o falta. */
export const rangeClassNote = (scale: ClassScale, lo: number | null | undefined, hi: number | null | undefined): string | null => {
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const a = pos(scale, Math.min(lo, hi));
  const b = pos(scale, Math.max(lo, hi));
  if (a === b) return null;
  const n = b - a + 1;
  const names = n === 2 ? `${posLabel(scale, a)} y ${posLabel(scale, b)}` : `de ${posLabel(scale, a)} a ${posLabel(scale, b)}`;
  return `El rango abarca ${n === 2 ? "dos" : n} clases (${names}); el color usa el punto medio.`;
};

export interface LegendRow { kind: "class" | "zero" | "nodata"; color: string; label: string; count: number | null; fillOpacity: number; index?: number }

/**
 * Leyenda: una fila por clase (siempre las 7, aunque tengan 0 comunas), «0» solo si hay comunas con 0, y «Sin dato».
 * `values`: valor (punto medio) de cada comuna CON dato; `total`: comunas del mapa (para contar las «sin dato»); null = no se sabe, sin cifra.
 */
export const legendRows = (scale: ClassScale, values: (number | null | undefined)[], total: number | null): LegendRow[] => {
  const counts = new Array<number>(scale.labels.length).fill(0);
  let zero = 0;
  let withData = 0;
  for (const v of values) {
    const c = classify(scale, v);
    if (c.kind === "nodata") continue;
    withData++;
    if (c.kind === "zero") zero++;
    else counts[c.index]++;
  }
  const rows: LegendRow[] = [];
  if (zero > 0) rows.push({ kind: "zero", color: ZERO_COLOR, label: scale.zeroLabel, count: zero, fillOpacity: FILL_OPACITY });
  scale.labels.forEach((label, i) => rows.push({ kind: "class", color: VIRIDIS_7[i], label, count: counts[i], fillOpacity: FILL_OPACITY, index: i }));
  rows.push({ kind: "nodata", color: NODATA_COLOR, label: "Sin dato", count: total == null ? null : Math.max(total - withData, 0), fillOpacity: NODATA_FILL_OPACITY });
  return rows;
};
