const trigramsOf = (text: string): Set<string> => {
  const padded = `  ${text} `; // padding para capturar trigramas de borde, igual que pg_trgm
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
};

/** Similitud por coeficiente de Dice sobre trigramas de caracteres (estilo pg_trgm). */
export const trigramSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  const gramsA = trigramsOf(a);
  const gramsB = trigramsOf(b);
  if (!gramsA.size || !gramsB.size) return 0;

  let shared = 0;
  for (const g of gramsA) if (gramsB.has(g)) shared++;

  return (2 * shared) / (gramsA.size + gramsB.size);
};
