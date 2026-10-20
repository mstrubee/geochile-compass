import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCommuneName, regionCodeByCommuneName, reverseGeocodeCommune } from "@/utils/communeReverseGeocode";

const square = (x: number, y: number) => ({
  type: "Polygon" as const,
  coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]],
});

const geojson = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { codigo_comuna: "13101" }, geometry: square(0, 0) },
    { type: "Feature", properties: { codigo_comuna: "05101" }, geometry: square(2, 0) },
    { type: "Feature", properties: { codigo_comuna: "16101" }, geometry: square(4, 0) },
  ],
};

// Los nombres en codigos_territoriales.csv vienen sin tildes.
const csv = [
  "region_id,region_name,province_id,province_name,commune_id,commune_name",
  "13,Metropolitana de Santiago,131,Santiago,13101,Santiago",
  "05,Valparaiso,051,Valparaiso,05101,Valparaiso",
  "16,Nuble,161,Diguillin,16101,Chillan",
].join("\n");

describe("regionCodeByCommuneName", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith(".geojson")
          ? { ok: true, status: 200, json: async () => geojson }
          : { ok: true, status: 200, text: async () => csv },
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resuelve la región por nombre sin distinguir tildes, mayúsculas ni espacios", async () => {
    expect(await regionCodeByCommuneName("Santiago")).toBe("13");
    expect(await regionCodeByCommuneName("  VALPARAÍSO ")).toBe("05");
    expect(await regionCodeByCommuneName("chillán")).toBe("16");
  });

  it("devuelve null si el nombre no existe", async () => {
    expect(await regionCodeByCommuneName("Santiag0")).toBeNull();
    expect(await regionCodeByCommuneName("")).toBeNull();
  });

  it("coincide con la región que entrega el reverse geocode del mismo índice", async () => {
    const r = await reverseGeocodeCommune(0.5, 2.5); // lat 0.5, lng 2.5 → cuadrado de Valparaíso
    expect(r?.name).toBe("Valparaiso");
    expect(await regionCodeByCommuneName(r!.name)).toBe(r!.region_codigo);
  });
});

describe("normalizeCommuneName", () => {
  it("quita tildes, pasa a minúsculas y colapsa espacios", () => {
    expect(normalizeCommuneName("  Ñuñoa   Sur ")).toBe("nunoa sur");
  });
});
