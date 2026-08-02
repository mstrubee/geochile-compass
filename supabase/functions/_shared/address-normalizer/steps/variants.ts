/**
 * ETAPA 7 - Variantes por descarte progresivo de palabras iniciales.
 * Ejemplo: "Avenida General Manuel Baquedano" (sin numero) ->
 *   "General Manuel Baquedano", "Manuel Baquedano", "Baquedano",
 *   y ademas "Avenida Baquedano" (prefijo + ultima palabra, salta nombres
 *   intermedios - util cuando OSM solo tiene el apellido con el prefijo).
 */
export const generateProgressiveVariants = (calleSinNumero: string): string[] => {
  const words = calleSinNumero.split(" ").filter(Boolean);
  if (words.length < 2) return [];

  const variants: string[] = [];
  for (let drop = 1; drop < words.length; drop++) {
    variants.push(words.slice(drop).join(" "));
  }
  if (words.length > 2) {
    variants.push(`${words[0]} ${words[words.length - 1]}`);
  }

  return [...new Set(variants)].filter((v) => v && v !== calleSinNumero);
};
