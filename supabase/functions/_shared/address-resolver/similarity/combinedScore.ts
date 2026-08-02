import { levenshteinSimilarity } from "./levenshtein.ts";
import { jaroWinklerSimilarity } from "./jaroWinkler.ts";
import { trigramSimilarity } from "./trigram.ts";

export interface SimilarityScore {
  levenshtein: number;
  jaroWinkler: number;
  trigram: number;
  /** Promedio de los 3 - cada algoritmo perdona un tipo distinto de error
   * (Levenshtein: sustitucion/insercion/borrado: "Perri"/"Perry"; Jaro-Winkler:
   * transposiciones y pesa mas el inicio: "Mackena"/"Mackenna"; Trigram:
   * reordenamientos y coincidencias parciales), promediar es mas robusto que
   * apostar a uno solo sin datos para entrenar cual "gana" en cada caso. */
  combined: number;
  /** El algoritmo que aporto el score mas alto para este par - solo informativo (log). */
  bestAlgorithm: "levenshtein" | "jaroWinkler" | "trigram";
}

export const scoreSimilarity = (a: string, b: string): SimilarityScore => {
  const levenshtein = levenshteinSimilarity(a, b);
  const jaroWinkler = jaroWinklerSimilarity(a, b);
  const trigram = trigramSimilarity(a, b);
  const combined = (levenshtein + jaroWinkler + trigram) / 3;

  let bestAlgorithm: SimilarityScore["bestAlgorithm"] = "levenshtein";
  let bestScore = levenshtein;
  if (jaroWinkler > bestScore) { bestAlgorithm = "jaroWinkler"; bestScore = jaroWinkler; }
  if (trigram > bestScore) { bestAlgorithm = "trigram"; bestScore = trigram; }

  return { levenshtein, jaroWinkler, trigram, combined, bestAlgorithm };
};
