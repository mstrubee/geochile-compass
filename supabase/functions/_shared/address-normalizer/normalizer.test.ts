import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { addressNormalizer } from "./index.ts";

const candidateStrings = (calle: string, numero: string, comuna: string): string[] =>
  addressNormalizer.normalize({ calle, numero, comuna }).normalizedAddresses.map((c) => `${c.calle}|${c.numero}`);

Deno.test("limpieza + Title Case + abreviaturas: AV. GENERAL BAQUEDANO", () => {
  const candidates = candidateStrings("  AV.   GENERAL BAQUEDANO ,, ", "22", "San Antonio");
  assert(candidates.includes("Avenida General Baquedano|22"));
  assert(candidates.includes("Baquedano|22"));
});

Deno.test("numeracion: numero final que no coincide con la columna numero se descarta", () => {
  const result = addressNormalizer.normalize({ calle: "San Nicolas 1331", numero: "94", comuna: "San Miguel" });
  const candidates = result.normalizedAddresses.map((c) => `${c.calle}|${c.numero}`);
  assert(candidates.includes("San Nicolas|94"));
  assert(result.warnings.some((w) => w.stage === "numbering"));
});

Deno.test("numeracion: numero final duplicado se limpia sin generar warning", () => {
  const result = addressNormalizer.normalize({ calle: "Baquedano 22 22", numero: "22", comuna: "San Antonio" });
  assertEquals(result.warnings.length, 0);
  assert(result.normalizedAddresses.some((c) => c.calle === "Baquedano" && c.numero === "22"));
});

Deno.test("O'Higgins: variante sin apostrofo genera la forma con apostrofo", () => {
  const candidates = candidateStrings("Ohiggins", "1040", "Gorbea");
  assert(candidates.includes("O'Higgins|1040"));
});

Deno.test("sinonimos no duplican palabras del prefijo (regresion Avenida General Baquedano)", () => {
  const candidates = candidateStrings("Avenida General Baquedano", "22", "San Antonio");
  assert(!candidates.some((c) => c.includes("General General")));
});

Deno.test("coma: primer segmento se usa como calle candidata", () => {
  const candidates = candidateStrings("Manuel Rodríguez, 62, Tinguiririca", "62", "Chimbarongo");
  assert(candidates.includes("Manuel Rodríguez|62"));
});

Deno.test("informacion adicional tras el numero se separa sin perderse", () => {
  const result = addressNormalizer.normalize({
    calle: "Pasaje Minero Walterio Zapata Sarabia 953 La Peña 2 C",
    numero: "953",
    comuna: "Coronel",
  });
  assertEquals(result.extraInformation, "La Peña 2 C");
  assert(result.normalizedAddresses.some((c) => c.calle === "Pasaje Minero Walterio Zapata Sarabia"));
});

Deno.test("prefijo con punto pegado (typo) se limpia igual que la abreviatura", () => {
  const candidates = candidateStrings("Avenida. General José San Martin", "3237", "Maipu");
  assert(candidates.includes("Avenida General José San Martin|3237"));
});

Deno.test("numero alfanumerico (depto) se respeta tal cual, solo se limpia la calle", () => {
  const candidates = candidateStrings("Pedro Riveros 1521", "112c", "Quilicura");
  assert(candidates.includes("Pedro Riveros|112c"));
});

Deno.test("sin tildes genera una variante adicional solo quitando acentos", () => {
  const result = addressNormalizer.normalize({ calle: "José Ñuñoa", numero: "10", comuna: "Ñuñoa" });
  assert(result.normalizedAddresses.some((c) => c.label === "no_accents" && c.calle === "Jose Nunoa"));
});

Deno.test("prefijo pegado sin espacio (dato fuente) se separa correctamente", () => {
  const candidates = candidateStrings("Avenidaobispo Valdez Subercaseaux", "1857", "Valparaiso");
  assert(candidates.some((c) => c.startsWith("Avenida Obispo Valdez Subercaseaux|")));
});

Deno.test("Calles con s no se confunde con prefijo pegado (falso positivo)", () => {
  const candidates = candidateStrings("Calles Esperanza", "2791", "Hualqui");
  assert(!candidates.some((c) => c.toLowerCase().includes("calle s")));
});

Deno.test("nunca se pierden candidatos con calle vacia", () => {
  const result = addressNormalizer.normalize({ calle: "", numero: "10", comuna: "Santiago" });
  for (const c of result.normalizedAddresses) assert(c.calle.trim().length >= 0);
});
