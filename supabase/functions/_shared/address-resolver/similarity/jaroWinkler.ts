/** Similitud de Jaro clasica. */
const jaroSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchDistance = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  return (
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
  );
};

/**
 * Jaro-Winkler: le da mas peso a coincidencias al inicio de la cadena
 * (comun en nombres propios y nombres de calle, donde un tipeo suele estar
 * mas al final). Prefijo compartido acotado a 4 caracteres, escala 0.1
 * estandar del algoritmo original.
 */
export const jaroWinklerSimilarity = (a: string, b: string): number => {
  const jaro = jaroSimilarity(a, b);
  const maxPrefix = 4;
  let prefixLen = 0;
  while (prefixLen < maxPrefix && prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) {
    prefixLen++;
  }
  return jaro + prefixLen * 0.1 * (1 - jaro);
};
