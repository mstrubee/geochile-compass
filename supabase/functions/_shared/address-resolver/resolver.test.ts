import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { levenshteinSimilarity } from "./similarity/levenshtein.ts";
import { jaroWinklerSimilarity } from "./similarity/jaroWinkler.ts";
import { trigramSimilarity } from "./similarity/trigram.ts";
import { scoreSimilarity } from "./similarity/combinedScore.ts";
import { firstTokenMatches } from "./similarity/prefixContainment.ts";
import { matchAlias, matchAgainstCatalog } from "./resolver.ts";

// Mismos valores que la instancia de produccion (ver index.ts).
const DEFAULT_CONFIG = {
  threshold: 0.85,
  minMarginOverRunnerUp: 0.03,
  minPrefixCoverage: 0.65,
  minPrefixTokens: 2,
};

Deno.test("levenshtein: identicas y vacias", () => {
  assertEquals(levenshteinSimilarity("abc", "abc"), 1);
  assertEquals(levenshteinSimilarity("", ""), 1);
});

Deno.test("jaro-winkler: pesa mas el prefijo compartido", () => {
  const sameSuffix = jaroWinklerSimilarity("martha", "marhta"); // transposicion, ejemplo clasico
  assert(sameSuffix > 0.9);
});

Deno.test("trigram: sin overlap da 0", () => {
  assertEquals(trigramSimilarity("abc", "xyz"), 0);
});

Deno.test("caso real: Vicuña Mackena / Vicuña Mackenna supera el umbral por defecto", () => {
  const score = scoreSimilarity("vicuna mackena", "vicuna mackenna");
  assert(score.combined >= 0.9, `combined=${score.combined}`);
});

Deno.test("caso real: Las Flores / Los Flores tiene ratio enganosamente alto — por eso existe la regla de primera palabra", () => {
  // El ratio solo NO alcanza para descartarlo (0.856, por encima del umbral de
  // 0.85): dos calles distintas que difieren solo en el determinante. La
  // proteccion real vive en firstTokenMatches, verificada en el test de
  // matchAgainstCatalog mas abajo.
  const score = scoreSimilarity("las flores", "los flores");
  assert(score.combined > DEFAULT_CONFIG.threshold, `combined=${score.combined}`);
  assert(!firstTokenMatches("las flores", "los flores"), "la regla de primera palabra debe rechazarlo");
});

Deno.test("matchAlias: encuentra coincidencia exacta ignorando may/tildes", () => {
  const result = matchAlias("baquedano", { Baquedano: "General Manuel Baquedano" });
  assertEquals(result?.resolvedCalle, "General Manuel Baquedano");
  assertEquals(result?.method, "alias");
  assertEquals(result?.score, 1);
});

Deno.test("matchAlias: sin coincidencia devuelve null", () => {
  assertEquals(matchAlias("Otra Calle", { Baquedano: "General Manuel Baquedano" }), null);
});

Deno.test("matchAgainstCatalog: acepta un match claro por encima del umbral", () => {
  const catalog = ["Vicuña Mackenna", "Ciclovía Vicuña Mackenna", "Dinamarca"];
  const result = matchAgainstCatalog("Vicuña Mackena", catalog, DEFAULT_CONFIG);
  assertEquals(result?.resolvedCalle, "Vicuña Mackenna");
  assert(result!.score >= 0.9);
});

Deno.test("matchAgainstCatalog: rechaza cuando el mejor score queda bajo el umbral", () => {
  const catalog = ["Los Flores", "Dinamarca", "Alemania"];
  const result = matchAgainstCatalog("Las Flores", catalog, DEFAULT_CONFIG);
  assertEquals(result, null);
});

Deno.test("matchAgainstCatalog: rechaza cuando hay ambiguedad (2 candidatos casi empatados)", () => {
  const catalog = ["Las Rosas", "Las Rosal", "Dinamarca"];
  // ambas quedan a ~0.01-0.02 de distancia entre si -> no hay un ganador claro
  const result = matchAgainstCatalog("Las Rosax", catalog, { ...DEFAULT_CONFIG, threshold: 0.7 });
  assertEquals(result, null);
});

// ── Camino alternativo por prefijo de palabras completas ─────────────────────
// Casos reales del archivo del usuario: el dato fuente trae el nombre con
// palabras extra al final, que el ratio castiga pero es coincidencia segura.

Deno.test("prefijo: acepta truncamiento real (Donghi Paladino -> Donghi)", () => {
  const catalog = ["Doctor Antonio Donghi", "Alemania", "Dinamarca"];
  const result = matchAgainstCatalog("Doctor Antonio Donghi Paladino", catalog, DEFAULT_CONFIG);
  assertEquals(result?.resolvedCalle, "Doctor Antonio Donghi");
  assertEquals(result?.method, "prefix");
});

Deno.test("prefijo: acepta nombre completo vs abreviado (Gladys Marin Millie -> Gladys Marín)", () => {
  const catalog = ["Avenida Gladys Marín", "Alemania"];
  const result = matchAgainstCatalog("Avenida Gladys Marin Millie", catalog, DEFAULT_CONFIG);
  assertEquals(result?.resolvedCalle, "Avenida Gladys Marín");
});

Deno.test("prefijo: NO acepta cuando solo se comparte el generico (Pasaje Kudi vs Pasaje Kure)", () => {
  const catalog = ["Pasaje Kure", "Alemania"];
  const result = matchAgainstCatalog("Pasaje Kudi", catalog, DEFAULT_CONFIG);
  assertEquals(result, null);
});

Deno.test("prefijo: NO acepta cuando el sufijo extra domina (Avenida Central vs Avenida Central Poniente)", () => {
  const catalog = ["Avenida Central Poniente", "Alemania"];
  const result = matchAgainstCatalog("Avenida Central", catalog, DEFAULT_CONFIG);
  assertEquals(result, null);
});

Deno.test("prefijo: NO acepta primer nombre distinto (Joaquín vs Juan Fernández Blanco)", () => {
  const catalog = ["Juan Fernández Blanco", "Alemania"];
  const result = matchAgainstCatalog("Joaquín Fernandez Blanco", catalog, DEFAULT_CONFIG);
  assertEquals(result, null);
});

Deno.test("umbral 0.85: acepta los casos reales validados a mano", () => {
  const casos: Array<[string, string[], string]> = [
    ["Maquehue", ["Manquehue", "Alemania"], "Manquehue"],
    ["Augusto Dahlmar", ["Augusto D´Halmar", "Alemania"], "Augusto D´Halmar"],
    ["Los Almos", ["Los Álamos", "Dinamarca"], "Los Álamos"],
    ["Chilechico", ["Chile Chico", "Alemania"], "Chile Chico"],
  ];
  for (const [input, catalog, expected] of casos) {
    const result = matchAgainstCatalog(input, catalog, DEFAULT_CONFIG);
    assertEquals(result?.resolvedCalle, expected, `fallo con "${input}"`);
  }
});

Deno.test("matchAgainstCatalog: catalogo vacio devuelve null sin lanzar error", () => {
  assertEquals(matchAgainstCatalog("Cualquier Calle", [], DEFAULT_CONFIG), null);
});
