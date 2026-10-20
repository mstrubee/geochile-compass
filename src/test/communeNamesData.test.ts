import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { communeNameKey, parseIneCommuneNames } from "@/utils/communeReverseGeocode";

/**
 * Consistencia entre los tres archivos de comunas de /public. El export de locales muestra el
 * nombre de ine_communes.csv (con tildes) y resuelve nombres de la planilla contra ambos CSV.
 */
const read = (file: string) => readFileSync(resolve(process.cwd(), "public", file), "utf-8");

const ineNames = parseIneCommuneNames(read("ine_communes.csv"));

// Mismo parseo que loadIndex: commune_id (col 4) y commune_name (col 5).
const codigosNames = new Map<string, string>(
  read("codigos_territoriales.csv")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","))
    .filter((c) => c.length >= 6)
    .map((c) => [c[4].trim(), c[5].trim()] as const),
);

const geojsonCodes = new Set<string>(
  (JSON.parse(read("comunas.geojson")) as { features: Array<{ properties: Record<string, string> }> }).features.map(
    (f) => f.properties.codigo_comuna ?? f.properties.cod_comuna,
  ),
);

/** Sin tildes ni mayúsculas, pero conservando guiones, apóstrofos y espacios. */
const withoutAccents = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Códigos cuyo nombre en ine_communes.csv y codigos_territoriales.csv son grafías distintas
 * (no solo tildes). Si aparece uno nuevo, o uno de estos deja de diferir, el test falla:
 * hay que revisarlo y actualizar esta lista a propósito.
 */
const SPELLING_ALIASES: Record<string, { ine: string; codigos: string }> = {
  "04105": { ine: "Paihuano", codigos: "Paiguano" },
  "05502": { ine: "La Calera", codigos: "Calera" },
  "05703": { ine: "Llay-Llay", codigos: "Llaillay" },
  "06204": { ine: "Marchigüe", codigos: "Marchihue" },
  "11101": { ine: "Coyhaique", codigos: "Coihaique" },
  "11201": { ine: "Aysén", codigos: "Aisen" },
  "11302": { ine: "O'Higgins", codigos: "OHiggins" },
  "13303": { ine: "Til Til", codigos: "Tiltil" },
};

describe("comunas: consistencia entre ine_communes.csv, codigos_territoriales.csv y comunas.geojson", () => {
  it("ambos CSV tienen exactamente el mismo conjunto de códigos", () => {
    expect([...ineNames.keys()].sort()).toEqual([...codigosNames.keys()].sort());
  });

  it("todo código de comunas.geojson está en ine_communes.csv", () => {
    expect([...geojsonCodes].filter((c) => !ineNames.has(c))).toEqual([]);
  });

  it("los nombres coinciden sin tildes, salvo la lista explícita de alias", () => {
    const distintos = Object.fromEntries(
      [...ineNames]
        .filter(([code, ine]) => withoutAccents(ine) !== withoutAccents(codigosNames.get(code) ?? ""))
        .map(([code, ine]) => [code, { ine, codigos: codigosNames.get(code) }]),
    );
    expect(distintos).toEqual(SPELLING_ALIASES);
  });

  it("ningún nombre (de ningún CSV) resuelve a dos comunas distintas", () => {
    const codesByKey = new Map<string, Set<string>>();
    for (const names of [ineNames, codigosNames]) {
      for (const [code, name] of names) {
        const key = communeNameKey(name);
        codesByKey.set(key, (codesByKey.get(key) ?? new Set()).add(code));
      }
    }
    const colisiones = [...codesByKey].filter(([, codes]) => codes.size > 1).map(([key]) => key);
    expect(colisiones).toEqual([]);
  });
});
