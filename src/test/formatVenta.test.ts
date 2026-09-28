import { describe, it, expect } from "vitest";
import { ventaMM } from "@/utils/formatVenta";

describe("venta en millones", () => {
  it("escribe los millones sin decimales", () => {
    expect(ventaMM(100_000_000)).toBe("100");
    // AP0018-Rancagua: $94.045.442 promedio de sus últimos 12 meses con venta.
    expect(ventaMM(94_045_442)).toBe("94");
    expect(ventaMM(94_700_000)).toBe("95");
    expect(ventaMM(1_400_000_000)).toBe("1.400");
  });

  it("bajo el millón no redondea a cero", () => {
    // "0" se leería como un local sin venta, que es otra cosa.
    expect(ventaMM(800_000)).toBe("<1");
    expect(ventaMM(1_000_000)).toBe("1");
  });

  it("sin dato, guion", () => {
    expect(ventaMM(0)).toBe("—");
    expect(ventaMM(null)).toBe("—");
    expect(ventaMM(undefined)).toBe("—");
  });
});
