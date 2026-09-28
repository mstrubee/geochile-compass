import { describe, it, expect } from "vitest";
import turfUnion from "@turf/union";
import { featureCollection } from "@turf/helpers";
import { communeBreakdown } from "@/utils/isochroneAnalysis";
import type { IneCommuneStats } from "@/utils/ineScales";

/**
 * Con zonas aledañas fusionadas, la tabla "Comunas" del informe tiene que
 * hablar del área TOTAL analizada, no de la isócrona madre: es la union la que
 * se analiza, y cada fila debe repartir el área de esa union.
 */

const cuadrado = (x0: number, y0: number, x1: number, y1: number) => ({
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "Polygon" as const,
    coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
  },
});

// Dos comunas pegadas: A a la izquierda de lon=0, B a la derecha.
const comunas = {
  type: "FeatureCollection" as const,
  features: [
    { ...cuadrado(-1, -1, 0, 1), properties: { codigo_comuna: "A", nom_comuna: "A" } },
    { ...cuadrado(0, -1, 1, 1), properties: { codigo_comuna: "B", nom_comuna: "B" } },
  ],
} as never;

const ine = new Map<string, IneCommuneStats>([
  ["a", { poblacion: 100_000, ingreso: 1_000_000, nse: null } as never],
  ["b", { poblacion: 200_000, ingreso: 1_000_000, nse: null } as never],
]);

describe("communeBreakdown con zonas aledañas fusionadas", () => {
  // Madre íntegramente en la comuna A.
  const madre = cuadrado(-0.4, -0.2, -0.2, 0.2);
  // Aledaña íntegramente en la comuna B, del mismo tamaño.
  const aledana = cuadrado(0.2, -0.2, 0.4, 0.2);
  const union = turfUnion(featureCollection([madre, aledana] as never)) as never;

  it("la madre sola solo ve su propia comuna", () => {
    const filas = communeBreakdown(madre as never, comunas, ine, {});
    expect(filas.map((f) => f.name)).toEqual(["A"]);
    expect(Math.round(filas[0].areaShareInIso * 100)).toBe(100);
  });

  it("la union reparte el area total entre ambas comunas", () => {
    const filas = communeBreakdown(union, comunas, ine, {});
    expect(filas.map((f) => f.name).sort()).toEqual(["A", "B"]);
    // Mitad y mitad del área TOTAL, no 100% cada una de su propia isócrona.
    for (const f of filas) expect(Math.round(f.areaShareInIso * 100)).toBe(50);
    expect(Math.round(filas.reduce((s, f) => s + f.areaShareInIso, 0) * 100)).toBe(100);
  });

  it("la poblacion de cada fila es la del area total, no la de una isocrona", () => {
    const sola = communeBreakdown(madre as never, comunas, ine, {});
    const juntas = communeBreakdown(union, comunas, ine, {});
    const popA = juntas.find((f) => f.name === "A")!.popInIso;
    const popB = juntas.find((f) => f.name === "B")!.popInIso;
    // A no cambia (la aledaña no la toca) y B se suma: el total sube.
    expect(popA).toBeCloseTo(sola[0].popInIso, 5);
    expect(popB).toBeGreaterThan(0);
    expect(popA + popB).toBeGreaterThan(sola[0].popInIso);
  });
});
