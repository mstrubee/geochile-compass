/**
 * Recorte de features repartido entre comunas.
 *
 * Los servicios de manzanas recorren las comunas del viewport en secuencia y
 * cortan al llegar al tope. Eso deja las primeras comunas completas y las
 * últimas SIN NINGUNA feature, que en el mapa se ve como zonas en blanco — y
 * empeora al alejar el zoom, porque el viewport toca más comunas y llegar al
 * tope es más probable. El informe salía con medio territorio sin pintar.
 *
 * Acá el tope se reparte proporcionalmente y dentro de cada comuna se muestrea
 * a paso constante. El resultado es un mapa más RALO pero completo, que es la
 * degradación correcta: la densidad relativa entre zonas se mantiene y no
 * desaparece ninguna.
 */

/** Muestreo a paso constante: conserva la distribución espacial del bucket. */
const sampleEvenly = <T,>(items: T[], keep: number): T[] => {
  if (keep >= items.length) return items;
  if (keep <= 0) return [];
  const step = items.length / keep;
  const out: T[] = [];
  for (let i = 0; i < keep; i++) out.push(items[Math.floor(i * step)]);
  return out;
};

export interface EvenCapResult<T> {
  features: T[];
  /** true si hubo recorte: el mapa muestra una muestra, no el total. */
  truncated: boolean;
  /** Cuántas features había antes de recortar. */
  totalAvailable: number;
}

/**
 * Reparte `cap` entre los buckets en proporción a su tamaño.
 *
 * El reparto se hace con el mayor-resto: repartir por redondeo directo deja
 * decenas de cupos sin asignar cuando hay muchas comunas, y a un tope ya
 * ajustado eso se nota.
 */
export const capEvenlyAcrossBuckets = <T,>(
  buckets: T[][],
  cap: number,
): EvenCapResult<T> => {
  const totalAvailable = buckets.reduce((s, b) => s + b.length, 0);
  if (totalAvailable <= cap) {
    return { features: buckets.flat(), truncated: false, totalAvailable };
  }

  const exact = buckets.map((b) => (b.length / totalAvailable) * cap);
  const quotas = exact.map(Math.floor);
  let left = cap - quotas.reduce((s, q) => s + q, 0);

  // Los cupos sobrantes van a los buckets con mayor resto.
  const byRemainder = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    .sort((a, b) => b.rem - a.rem);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    if (quotas[i] < buckets[i].length) { quotas[i] += 1; left -= 1; }
  }

  // Una comuna con features en el viewport nunca debe quedar en cero: es
  // exactamente el agujero visual que este reparto viene a evitar.
  for (let i = 0; i < buckets.length; i++) {
    if (quotas[i] === 0 && buckets[i].length > 0) quotas[i] = 1;
  }

  return {
    features: buckets.flatMap((b, i) => sampleEvenly(b, quotas[i])),
    truncated: true,
    totalAvailable,
  };
};
