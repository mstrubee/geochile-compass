import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  communeCodesByName,
  communeNameKey,
  officialCommuneName,
  parseIneCommuneNames,
  regionCodeByCommuneName,
  reverseGeocodeCommune,
} from "@/utils/communeReverseGeocode";
import { stubCommuneFetch } from "@/test/communeFixtures";

describe("communeNameKey", () => {
  it("quita tildes, mayúsculas, guiones, apóstrofos y espacios", () => {
    expect(communeNameKey("  Ñuñoa ")).toBe("nunoa");
    expect(communeNameKey("Til Til")).toBe(communeNameKey("Tiltil"));
    expect(communeNameKey("O'Higgins")).toBe("ohiggins");
    expect(communeNameKey("Llay-Llay")).toBe(communeNameKey("llay llay"));
  });

  it("no unifica grafías distintas (eso lo hace el índice de ambos nombres)", () => {
    expect(communeNameKey("Llay-Llay")).not.toBe(communeNameKey("Llaillay"));
    expect(communeNameKey("La Calera")).not.toBe(communeNameKey("Calera"));
  });
});

describe("parseIneCommuneNames", () => {
  it("usa solo commune_id y commune_name, con el id a 5 dígitos", () => {
    const m = parseIneCommuneNames(
      "\uFEFFcommune_id,commune_name,superficie_km2,ingreso_promedio,nse\n1101,Iquique,1,2,C3\n13119,Maipú,3,4,C2\n",
    );
    expect([...m]).toEqual([
      ["01101", "Iquique"],
      ["13119", "Maipú"],
    ]);
  });

  it("falla con un mensaje claro si faltan las columnas", () => {
    expect(() => parseIneCommuneNames("id,nombre\n1,x")).toThrow(/commune_id\/commune_name/);
  });
});

describe("nombres de comuna (fixture)", () => {
  beforeEach(() => stubCommuneFetch());
  afterEach(() => vi.unstubAllGlobals());

  it("officialCommuneName devuelve el nombre con tildes por código", async () => {
    expect(await officialCommuneName("13120")).toBe("Ñuñoa");
    expect(await officialCommuneName("05101")).toBe("Valparaíso");
    expect(await officialCommuneName("5101")).toBe("Valparaíso"); // id sin padding
  });

  it("officialCommuneName devuelve null si el código no está en ine_communes.csv", async () => {
    expect(await officialCommuneName("13119")).toBeNull(); // Maipu solo está en codigos_territoriales
    expect(await officialCommuneName("99999")).toBeNull();
  });

  it("ambos nombres de un código resuelven al mismo código", async () => {
    expect(await communeCodesByName("La Calera")).toEqual(["05502"]);
    expect(await communeCodesByName("Calera")).toEqual(["05502"]);
    expect(await communeCodesByName("Llay-Llay")).toEqual(["05703"]);
    expect(await communeCodesByName("Llaillay")).toEqual(["05703"]);
    expect(await communeCodesByName("Til Til")).toEqual(["13303"]);
    expect(await communeCodesByName("Tiltil")).toEqual(["13303"]);
    expect(await communeCodesByName("O'Higgins")).toEqual(["11302"]);
    expect(await communeCodesByName("OHiggins")).toEqual(["11302"]);
    expect(await communeCodesByName("ÑUÑOA")).toEqual(["13120"]);
    expect(await communeCodesByName("nunoa")).toEqual(["13120"]);
  });

  it("devuelve vacío si el nombre no existe", async () => {
    expect(await communeCodesByName("Santiag0")).toEqual([]);
    expect(await communeCodesByName("")).toEqual([]);
    expect(await communeCodesByName("  - ")).toEqual([]);
  });

  it("regionCodeByCommuneName: región por cualquiera de los nombres; null si no existe o es ambiguo", async () => {
    expect(await regionCodeByCommuneName("La Calera")).toBe("05");
    expect(await regionCodeByCommuneName("Calera")).toBe("05");
    expect(await regionCodeByCommuneName("Ñuñoa")).toBe("13");
    expect(await regionCodeByCommuneName("Santiag0")).toBeNull();
    expect(await regionCodeByCommuneName("Repetida")).toBeNull(); // existe en 13 y 05
  });

  it("el código de reverseGeocodeCommune es el que resuelve el nombre oficial", async () => {
    const r = await reverseGeocodeCommune(-33.25, -70.65);
    expect(r).toMatchObject({ name: "Nunoa", codigo: "13120" }); // reverse geocode sigue entregando el nombre sin tildes
    expect(await officialCommuneName(r!.codigo)).toBe("Ñuñoa");
  });
});

describe("carga de ine_communes.csv", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("si falla la descarga rechaza (no cae a nombres sin tildes en silencio) y reintenta después", async () => {
    vi.resetModules();
    const mod = await import("@/utils/communeReverseGeocode");
    stubCommuneFetch({ "/ine_communes.csv": { ok: false, status: 404 } });
    await expect(mod.officialCommuneName("13120")).rejects.toThrow("ine_communes.csv HTTP 404");

    vi.unstubAllGlobals();
    stubCommuneFetch();
    expect(await mod.officialCommuneName("13120")).toBe("Ñuñoa");
  });
});
