import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { levenshteinSimilarity } from "./similarity/levenshtein.ts";
import { jaroWinklerSimilarity } from "./similarity/jaroWinkler.ts";
import { trigramSimilarity } from "./similarity/trigram.ts";
import { scoreSimilarity } from "./similarity/combinedScore.ts";
import { matchAlias, matchAgainstCatalog } from "./resolver.ts";

const DEFAULT_CONFIG = { threshold: 0.9, minMarginOverRunnerUp: 0.03 };

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

Deno.test("caso real: Las Flores / Los Flores NO debe superar el umbral (calles distintas, riesgo de falso positivo)", () => {
  const score = scoreSimilarity("las flores", "los flores");
  assert(score.combined < 0.9, `combined=${score.combined} deberia quedar bajo el umbral por defecto`);
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
  const result = matchAgainstCatalog("Las Rosax", catalog, { threshold: 0.7, minMarginOverRunnerUp: 0.03 });
  assertEquals(result, null);
});

Deno.test("matchAgainstCatalog: catalogo vacio devuelve null sin lanzar error", () => {
  assertEquals(matchAgainstCatalog("Cualquier Calle", [], DEFAULT_CONFIG), null);
});
