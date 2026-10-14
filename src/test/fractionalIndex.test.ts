import { describe, expect, it } from "vitest";
import vectors from "./fixtures/fractionalIndexVectors.json";
import {
  compareSiblings,
  computeMovePosition,
  generateKeyBetween,
  type Sibling,
} from "@/utils/fractionalIndex";

type Vec = [string | null, string | null, string];

describe("generateKeyBetween — paridad con la librería de referencia", () => {
  const cases = vectors.cases as Vec[];

  it("tiene casos suficientes y de varios tipos", () => {
    expect(cases.length).toBeGreaterThan(400);
    expect(cases.some(([a, b]) => a === null && b === null)).toBe(true);
    expect(cases.some(([a, b]) => a === null && b !== null)).toBe(true);
    expect(cases.some(([a, b]) => a !== null && b === null)).toBe(true);
  });

  it("reproduce los vectores generados con fractional-indexing", () => {
    const wrong = cases.filter(([a, b, expected]) => generateKeyBetween(a, b) !== expected);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it("cada clave cae estrictamente entre sus límites", () => {
    for (const [a, b, got] of cases) {
      if (a !== null) expect(got > a).toBe(true);
      if (b !== null) expect(got < b).toBe(true);
    }
  });
});

describe("generateKeyBetween — errores", () => {
  it("rechaza límites desordenados o iguales", () => {
    expect(() => generateKeyBetween("a1", "a0")).toThrow();
    expect(() => generateKeyBetween("a1", "a1")).toThrow();
  });

  it("rechaza claves mal formadas", () => {
    expect(() => generateKeyBetween("!", null)).toThrow(/head/);
    expect(() => generateKeyBetween("b0", null)).toThrow(/invalid order key/); // 'b' exige 2 dígitos
    expect(() => generateKeyBetween("a10", null)).toThrow(/invalid order key/); // cero final en la fracción
    expect(() => generateKeyBetween("A" + "0".repeat(26), null)).toThrow();
  });
});

describe("computeMovePosition", () => {
  const sib = (...pairs: Array<[string, string]>): Sibling[] =>
    pairs.map(([id, position]) => ({ id, position }));
  const ABC = sib(["A", "a0"], ["B", "a1"], ["C", "a2"]);

  it("sin hermanos, la primera clave", () => {
    expect(computeMovePosition([], "X")).toBe("a0");
  });

  it("sin anclas va al final", () => {
    const p = computeMovePosition(ABC, "X");
    expect(p > "a2").toBe(true);
  });

  it("beforeId: inmediatamente antes de ese hermano", () => {
    const p = computeMovePosition(ABC, "X", { beforeId: "B" });
    expect(p > "a0" && p < "a1").toBe(true);
  });

  it("beforeId del primero: antes que todos", () => {
    const p = computeMovePosition(ABC, "X", { beforeId: "A" });
    expect(p < "a0").toBe(true);
  });

  it("afterId: inmediatamente después de ese hermano", () => {
    const p = computeMovePosition(ABC, "X", { afterId: "A" });
    expect(p > "a0" && p < "a1").toBe(true);
  });

  it("afterId del último: al final", () => {
    expect(computeMovePosition(ABC, "X", { afterId: "C" }) > "a2").toBe(true);
  });

  it("ambas anclas: entre las dos", () => {
    const p = computeMovePosition(ABC, "X", { afterId: "B", beforeId: "C" });
    expect(p > "a1" && p < "a2").toBe(true);
  });

  it("ignora al propio nodo cuando se mueve dentro del mismo padre", () => {
    // Mover A justo antes de C: sus vecinos son B (a1) y C (a2), no A mismo.
    const p = computeMovePosition(ABC, "A", { beforeId: "C" });
    expect(p > "a1" && p < "a2").toBe(true);
  });

  it("anclas fuera de orden o que no son hermanos lanzan error", () => {
    expect(() => computeMovePosition(ABC, "X", { afterId: "C", beforeId: "A" })).toThrow(/fuera de orden/);
    expect(() => computeMovePosition(ABC, "X", { beforeId: "ZZ" })).toThrow(/no es un hermano/);
    expect(() => computeMovePosition(ABC, "A", { beforeId: "A" })).toThrow(/no es un hermano/);
  });

  it("empates de posición se desempatan por id (orden total)", () => {
    const tied = sib(["b", "a1"], ["a", "a1"]);
    expect([...tied].sort(compareSiblings).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("300 movimientos aleatorios dejan siempre el orden que el modelo espera", () => {
    // PRNG simple con semilla para que sea reproducible.
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

    // Modelo: un array con el orden esperado; implementación: posiciones fraccionales.
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    let pos: Record<string, string> = {};
    let prev: string | null = null;
    for (const id of ids) {
      prev = generateKeyBetween(prev, null);
      pos[id] = prev;
    }
    let model = [...ids];

    for (let step = 0; step < 300; step++) {
      const moving = model[Math.floor(rnd() * model.length)];
      const rest = model.filter((x) => x !== moving);
      const at = Math.floor(rnd() * (rest.length + 1)); // índice destino dentro de `rest`
      const anchors =
        rest.length === 0
          ? {}
          : at === 0
            ? { beforeId: rest[0] }
            : at === rest.length
              ? { afterId: rest[rest.length - 1] }
              : { afterId: rest[at - 1], beforeId: rest[at] };

      const siblings = ids.map((id) => ({ id, position: pos[id] }));
      pos = { ...pos, [moving]: computeMovePosition(siblings, moving, anchors) };
      model = [...rest.slice(0, at), moving, ...rest.slice(at)];

      const actual = ids
        .map((id) => ({ id, position: pos[id] }))
        .sort(compareSiblings)
        .map((s) => s.id);
      expect(actual).toEqual(model);
    }
  });
});
