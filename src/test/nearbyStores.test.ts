import { describe, it, expect } from "vitest";
import { minutesFor } from "@/services/nearbyStoresService";

/**
 * El tiempo sale de los kilómetros reales del ruteador y de las velocidades
 * del admin. Los casos son rutas medidas de verdad desde Rancagua América.
 */
const SPEEDS = { urbanKmh: 28, highwayKmh: 90 };

describe("tiempo en auto", () => {
  it("ruta urbana pura: Rancagua → Machalí, 10,72 km sin autopista", () => {
    // 10,72 / 28 × 60 = 22,97
    expect(minutesFor(10.72, 0, SPEEDS)).toBe(23);
  });

  it("ruta mixta: Rancagua → Santiago, 85,15 km con 53,91 de autopista", () => {
    // urbano 31,24 / 28 × 60 = 66,9 ; autopista 53,91 / 90 × 60 = 35,9
    expect(minutesFor(85.15, 53.91, SPEEDS)).toBe(103);
  });

  it("no cuenta como autopista más de lo que mide la ruta", () => {
    expect(minutesFor(5, 99, SPEEDS)).toBe(minutesFor(5, 5, SPEEDS));
  });

  it("velocidades distintas cambian el tiempo sin volver a rutear", () => {
    const lento = minutesFor(10.72, 0, { urbanKmh: 25, highwayKmh: 80 });
    expect(lento).toBeGreaterThan(minutesFor(10.72, 0, SPEEDS));
  });
});
