import { stripAccents } from "./stripAccents.ts";

/**
 * ETAPA 4 - Corta la calle en el primer marcador de ruido (villa/depto/etc) y
 * devuelve lo removido en removedTokens - nunca se pierde informacion.
 */
export const removeNoise = (
  calle: string,
  palabras: string[],
): { calle: string; removedTokens: string[] } => {
  const words = calle.split(" ");
  const noiseSet = new Set(palabras.map((p) => stripAccents(p).toUpperCase()));

  for (let i = 0; i < words.length; i++) {
    const bare = stripAccents(words[i].replace(/[.,]$/, "")).toUpperCase();
    if (noiseSet.has(bare) && i > 0) {
      const kept = words.slice(0, i).join(" ").trim();
      const removed = words.slice(i).join(" ").trim();
      return { calle: kept, removedTokens: removed ? [removed] : [] };
    }
  }
  return { calle, removedTokens: [] };
};
