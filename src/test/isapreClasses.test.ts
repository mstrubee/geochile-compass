/** Salud, Fase 1b — clases discretas de la capa Isapre (Beneficiarios y Penetración). Valores FIXTURE; los conteos reales van en el informe del PR. */
import { describe, expect, it } from "vitest";
import {
  classIndex, classify, FILL_OPACITY, legendRows, N_SCALE, NODATA_COLOR, PCT_SCALE, rangeClassNote, VIRIDIS_7, ZERO_COLOR,
} from "@/utils/isapreClasses";

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const dist = (a: string, b: string) => [1, 3, 5].reduce((s, i) => s + (parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) ** 2, 0) ** 0.5;

describe("clases de Penetración: cortes redondos y fijos", () => {
  it("7 clases con las etiquetas pedidas", () => {
    expect(PCT_SCALE.cuts).toEqual([2, 5, 10, 20, 40, 60]);
    expect(PCT_SCALE.labels).toEqual(["0–2 %", "2–5 %", "5–10 %", "10–20 %", "20–40 %", "40–60 %", "≥ 60 %"]);
  });

  it("un valor IGUAL a un límite cae en la clase SUPERIOR: 2, 5, 10, 20, 40 y 60", () => {
    const idx = (v: number) => classIndex(PCT_SCALE, v);
    expect([2, 5, 10, 20, 40, 60].map(idx)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([1.999, 4.999, 9.999, 19.999, 39.999, 59.999].map(idx)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(idx(40)).toBe(5);                                   // 40 → «40–60 %» (no «20–40 %»)
    expect(idx(60)).toBe(6);                                   // 60 → «≥ 60 %» (no «40–60 %»)
    expect(idx(0.01)).toBe(0);
    expect(idx(89.53)).toBe(6);
    expect(idx(125)).toBe(6);                                  // sin recorte: la última clase
  });

  it("el 0 tiene su clase propia y «sin dato» (null, undefined, NaN) su estilo gris punteado a 0,4", () => {
    expect(classify(PCT_SCALE, 0)).toMatchObject({ kind: "zero", color: ZERO_COLOR, fillOpacity: 0.7 });
    for (const v of [null, undefined, NaN]) expect(classify(PCT_SCALE, v)).toMatchObject({ kind: "nodata", color: NODATA_COLOR, fillOpacity: 0.4, dashed: true });
    expect(classify(PCT_SCALE, 3.82)).toMatchObject({ kind: "class", index: 1, color: VIRIDIS_7[1], label: "2–5 %", dashed: false });
  });
});

describe("clases de Beneficiarios", () => {
  it("progresión 1-3-10: 100, 300, 1.000, 3.000, 10.000 y 30.000; el límite cae en la clase superior", () => {
    expect(N_SCALE.cuts).toEqual([100, 300, 1000, 3000, 10000, 30000]);
    expect([100, 300, 1000, 3000, 10000, 30000].map((v) => classIndex(N_SCALE, v))).toEqual([1, 2, 3, 4, 5, 6]);
    expect([99, 299, 999, 2999, 9999, 29999].map((v) => classIndex(N_SCALE, v))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(classIndex(N_SCALE, 220_870)).toBe(6);
    expect(N_SCALE.labels).toHaveLength(7);
    expect(N_SCALE.labels[0]).toBe("< 100");
    expect(N_SCALE.labels[6]).toBe("≥ 30.000");
  });

  it("el 0 conserva su clase propia", () => {
    expect(classify(N_SCALE, 0)).toMatchObject({ kind: "zero", color: ZERO_COLOR, label: "0 (cero publicado)" });
    expect(classify(N_SCALE, 1.5)).toMatchObject({ kind: "class", index: 0 });
  });

  it("las comunas urbanas ya no caen todas en la última clase: 5.893 (antes la clase superior) queda en «3.000 – <10.000» y 18.932 en «10.000 – <30.000»", () => {
    expect(classify(N_SCALE, 5893)).toMatchObject({ index: 4 });
    expect(classify(N_SCALE, 18932)).toMatchObject({ index: 5 });
    expect(classify(N_SCALE, 36336)).toMatchObject({ index: 6 });
  });
});

describe("paleta viridis de 7 clases", () => {
  it("siete colores DISTINTOS, ordenados de menor a mayor (la luminosidad sube de la clase 1 a la 7)", () => {
    expect(new Set(VIRIDIS_7).size).toBe(7);
    const L = VIRIDIS_7.map(lum);
    expect(L.every((v, i) => i === 0 || v > L[i - 1])).toBe(true);
  });

  it("clases contiguas claramente separadas y el 0 / sin dato distintos de todas las clases", () => {
    for (let i = 1; i < 7; i++) expect(dist(VIRIDIS_7[i], VIRIDIS_7[i - 1])).toBeGreaterThan(40);
    for (const c of [ZERO_COLOR, NODATA_COLOR]) for (const v of VIRIDIS_7) expect(dist(c, v)).toBeGreaterThan(40);
    expect(dist(ZERO_COLOR, NODATA_COLOR)).toBeGreaterThan(30);
  });

  it("relleno 0,7 en las clases y en el 0; sin dato a 0,4", () => {
    expect(FILL_OPACITY).toBe(0.7);
    for (const v of [0, 0.5, 3, 7, 15, 30, 40, 60]) expect(classify(PCT_SCALE, v)).toMatchObject({ fillOpacity: 0.7 });
    expect(classify(PCT_SCALE, null).fillOpacity).toBe(0.4);
  });
});

describe("leyenda: una fila por clase con su color, rango y número de comunas", () => {
  it("siempre las 7 clases (también las vacías, con 0) más «Sin dato»; el «0» solo si hay comunas con 0", () => {
    const rows = legendRows(PCT_SCALE, [1, 3, 3, 12, 60], 7);
    expect(rows.map((r) => r.kind)).toEqual(["class", "class", "class", "class", "class", "class", "class", "nodata"]);
    expect(rows.map((r) => r.label)).toEqual([...PCT_SCALE.labels, "Sin dato"]);
    expect(rows.slice(0, 7).map((r) => r.count)).toEqual([1, 2, 0, 1, 0, 0, 1]);
    expect(rows[7].count).toBe(2);                                    // 7 comunas − 5 con dato
    expect(rows.slice(0, 7).map((r) => r.color)).toEqual([...VIRIDIS_7]);
  });

  it("los valores en el límite se cuentan en la clase superior; el 0 aparece con su conteo; null no cuenta como dato", () => {
    const rows = legendRows(PCT_SCALE, [0, 0, 2, 5, 10, 20, 40, 60, null], 10);
    expect(rows[0]).toMatchObject({ kind: "zero", count: 2, color: ZERO_COLOR });
    expect(rows.slice(1, 8).map((r) => r.count)).toEqual([0, 1, 1, 1, 1, 1, 1]);
    expect(rows[8]).toMatchObject({ kind: "nodata", count: 2 });      // 10 − 8 con dato (el null y la que falta)
  });

  it("la suma de las filas con dato más «Sin dato» da el total de comunas", () => {
    const vals = [0, 0.4, 1, 1.9, 2, 4, 6, 9, 11, 25, 40, 70, null];
    const rows = legendRows(PCT_SCALE, vals, 15);
    expect(rows.reduce((s, r) => s + (r.count ?? 0), 0)).toBe(15);
  });

  it("sin el total de comunas no se inventa el conteo de «Sin dato»", () => {
    expect(legendRows(N_SCALE, [10, 500], null).at(-1)).toMatchObject({ kind: "nodata", count: null });
  });

  it("Beneficiarios usa las mismas filas con sus rangos", () => {
    const rows = legendRows(N_SCALE, [0, 50, 100, 299, 5893, 220870], 6);
    expect(rows[0]).toMatchObject({ kind: "zero", count: 1 });
    expect(rows.slice(1, 8).map((r) => r.count)).toEqual([1, 2, 0, 0, 1, 0, 1]);
    expect(rows.slice(1, 8).map((r) => r.label)).toEqual([...N_SCALE.labels]);
  });
});

describe("rango que cruza clases", () => {
  it("dos clases: «el rango abarca dos clases (A y B)»", () => {
    expect(rangeClassNote(PCT_SCALE, 1, 3)).toBe("El rango abarca dos clases (0–2 % y 2–5 %); el color usa el punto medio.");
    expect(rangeClassNote(PCT_SCALE, 4.9, 5)).toContain("dos clases (2–5 % y 5–10 %)");
  });
  it("tres o más clases, y el cero cuenta como una clase", () => {
    expect(rangeClassNote(PCT_SCALE, 1, 12)).toBe("El rango abarca 4 clases (de 0–2 % a 10–20 %); el color usa el punto medio.");
    expect(rangeClassNote(PCT_SCALE, 0, 1)).toContain("dos clases (0 % y 0–2 %)");
  });
  it("una sola clase, exacto o sin dato: sin nota", () => {
    expect(rangeClassNote(PCT_SCALE, 2.5, 4.9)).toBeNull();
    expect(rangeClassNote(PCT_SCALE, 7, 7)).toBeNull();
    expect(rangeClassNote(PCT_SCALE, null, null)).toBeNull();
    expect(rangeClassNote(N_SCALE, 120, 140)).toBeNull();
    expect(rangeClassNote(N_SCALE, 250, 320)).toContain("dos clases (100 – <300 y 300 – <1.000)");
  });
});
