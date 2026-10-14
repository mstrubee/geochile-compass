/**
 * Genera los vectores de prueba del índice fraccional con la librería de
 * referencia (fractional-indexing, CC0). Esos vectores validan los DOS ports del
 * algoritmo: src/utils/fractionalIndex.ts y la función SQL generate_key_between.
 *
 *   npm i --no-save fractional-indexing@3
 *   node scripts/gen-fractional-vectors.mjs            # fixture del repo (chico)
 *   node scripts/gen-fractional-vectors.mjs --sql 5000 # además imprime un VALUES para el dry-run en SQL
 *
 * Es determinista (PRNG con semilla), así que regenerarlo no cambia el archivo.
 */
import { generateKeyBetween } from "fractional-indexing";
import { writeFileSync } from "node:fs";

// PRNG mulberry32 con semilla fija.
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const cases = [];
const seen = new Set();
const add = (a, b) => {
  const k = `${a}|${b}`;
  if (seen.has(k)) return;
  seen.add(k);
  cases.push([a, b, generateKeyBetween(a, b)]);
};

// Curados: extremos, fronteras de longitud del entero, prefijos y dígitos consecutivos.
const curated = [
  [null, null], ["a0", null], [null, "a0"], ["a0", "a1"], ["a0", "a2"], ["a1", "a2"],
  ["az", null], ["az", "b00"], ["b00", null], ["a0", "a0V"], ["a0V", "a1"], ["a1", "a1V"],
  ["Zz", null], ["Zz", "a0"], [null, "Zz"], [null, "Zy"], ["Yzz", "Zz"], ["A00000000000000000000000001", null],
  [null, "A00000000000000000000000001"], ["a00", "a01"], ["a0", "a00V"], ["a0V", "a0W"], ["a0Vz", "a0W"],
  ["zzzzzzzzzzzzzzzzzzzzzzzzzzz", null], ["a1", "a1V"], ["a0z", "a1"], ["a0zz", "a1"], ["bzz", "c000"],
];
for (const [a, b] of curated) {
  try { add(a, b); } catch { /* clave inválida o sin sucesor: no es un caso válido */ }
}

// Secuencias aleatorias de inserciones: al inicio, al final, en medio, y mezcla.
const run = (seed, ops, pick) => {
  const r = rng(seed);
  const list = [];
  for (let i = 0; i < ops; i++) {
    const at = pick(r, list.length); // índice de inserción 0..len
    const a = at > 0 ? list[at - 1] : null;
    const b = at < list.length ? list[at] : null;
    add(a, b);
    list.splice(at, 0, generateKeyBetween(a, b));
  }
};
run(1, 120, (r, n) => n);                       // siempre al final
run(2, 120, () => 0);                           // siempre al inicio
run(3, 120, (r, n) => Math.floor(n / 2));       // siempre al medio (peor caso de longitud)
run(4, 200, (r, n) => Math.floor(r() * (n + 1))); // aleatorio
run(5, 200, (r, n) => (r() < 0.5 ? 0 : n));     // extremos alternados

writeFileSync(
  new URL("../src/test/fixtures/fractionalIndexVectors.json", import.meta.url),
  JSON.stringify({ generatedWith: "fractional-indexing@3.4.0", cases }, null, 0) + "\n",
);
console.error(`fixture: ${cases.length} casos`);

if (process.argv.includes("--sql")) {
  const n = Number(process.argv[process.argv.indexOf("--sql") + 1]) || 3000;
  const r = rng(99);
  const list = [];
  const out = [];
  const q = (s) => (s === null ? "null" : `'${s}'`);
  for (let i = 0; i < n; i++) {
    const mode = r();
    const at = mode < 0.15 ? 0 : mode < 0.3 ? list.length : Math.floor(r() * (list.length + 1));
    const a = at > 0 ? list[at - 1] : null;
    const b = at < list.length ? list[at] : null;
    const k = generateKeyBetween(a, b);
    out.push(`(${q(a)},${q(b)},'${k}')`);
    list.splice(at, 0, k);
  }
  process.stdout.write(out.join(",\n"));
}
