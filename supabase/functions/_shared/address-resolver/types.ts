export interface ResolveInput {
  calle: string;
  numero: string;
  comuna: string;
}

export type ResolveMethod = "alias" | "levenshtein" | "jaroWinkler" | "trigram";

export interface ResolveResult {
  /** Calle original que se intento resolver. */
  originalCalle: string;
  /** Nombre oficial encontrado en el callejero (o via alias). */
  resolvedCalle: string;
  method: ResolveMethod;
  /** 0..1. Para "alias" siempre 1 (coincidencia exacta de diccionario). */
  score: number;
  /** Tamano del catalogo consultado (0 si vino de alias, sin tocar el catalogo). */
  catalogSize: number;
}
