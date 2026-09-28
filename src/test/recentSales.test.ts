import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El promedio toma los últimos meses CON VENTA, no los últimos del calendario.
 * Un local cerrado temporalmente registra ceros, y promediarlos lo haría
 * parecer flojo cuando simplemente no estuvo abierto.
 *
 * El caso de referencia son los datos reales de AP0018-Rancagua: sus últimos
 * 12 meses con venta (2025-08 a 2026-07) promedian $94.045.442 y 2.360 UF,
 * calculado contra la base.
 */
const filas: Array<{ poi_id: string; period: string; value: number }> = [];
const ufs: Array<{ period: string; value: number }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      if (tabla === "uf_values") {
        return { select: () => Promise.resolve({ data: ufs, error: null }) };
      }
      const q = {
        select: () => q, eq: () => q, in: () => q, order: () => q,
        range: (from: number) => Promise.resolve({
          data: from === 0 ? filas : [], error: null,
        }),
      };
      return q;
    },
  },
}));

const { fetchRecentSales } = await import("@/services/nearbyStoresService");

const mes = (i: number) => {
  const m = ((i - 1) % 12) + 1;
  const a = 2025 + Math.floor((i - 1) / 12);
  return `${a}-${String(m).padStart(2, "0")}-01`;
};

beforeEach(() => {
  filas.length = 0;
  ufs.length = 0;
});

describe("venta promedio reciente", () => {
  it("promedia los últimos 12 meses con venta y los convierte a UF", async () => {
    // 18 meses de venta creciente; solo deben contar los 12 últimos.
    for (let i = 1; i <= 18; i++) {
      filas.push({ poi_id: "p1", period: mes(i), value: 1_000_000 * i });
      ufs.push({ period: mes(i), value: 40_000 });
    }
    const r = await fetchRecentSales(["p1"]);
    const s = r.get("p1")!;
    // Meses 7..18 → promedio de 7M..18M = 12,5M
    expect(s.avgClp).toBe(12_500_000);
    expect(s.avgUf).toBe(Math.round(12_500_000 / 40_000));
    expect(s.months).toBe(12);
    expect(s.lastPeriod).toBe("2026-06");
  });

  it("ignora los meses en cero: un cierre temporal no es mal desempeño", async () => {
    // 12 meses buenos y después 6 cerrado. El promedio no debe caer a la mitad.
    for (let i = 1; i <= 12; i++) {
      filas.push({ poi_id: "p1", period: mes(i), value: 10_000_000 });
      ufs.push({ period: mes(i), value: 40_000 });
    }
    for (let i = 13; i <= 18; i++) {
      filas.push({ poi_id: "p1", period: mes(i), value: 0 });
      ufs.push({ period: mes(i), value: 40_000 });
    }
    const s = (await fetchRecentSales(["p1"])).get("p1")!;
    expect(s.avgClp).toBe(10_000_000);
    expect(s.months).toBe(12);
    expect(s.lastPeriod).toBe("2025-12");
  });

  it("con menos de 12 meses promedia los que haya y lo informa", async () => {
    for (let i = 1; i <= 5; i++) {
      filas.push({ poi_id: "p1", period: mes(i), value: 2_000_000 });
      ufs.push({ period: mes(i), value: 40_000 });
    }
    const s = (await fetchRecentSales(["p1"])).get("p1")!;
    expect(s.months).toBe(5);
    expect(s.avgClp).toBe(2_000_000);
  });

  it("sin UF conocida deja la columna en cero en vez de inventar el cambio", async () => {
    filas.push({ poi_id: "p1", period: mes(1), value: 3_000_000 });
    const s = (await fetchRecentSales(["p1"])).get("p1")!;
    expect(s.avgClp).toBe(3_000_000);
    expect(s.avgUf).toBe(0);
  });

  it("un local sin ventas registradas no aparece", async () => {
    filas.push({ poi_id: "p1", period: mes(1), value: 0 });
    expect((await fetchRecentSales(["p1"])).has("p1")).toBe(false);
  });
});
