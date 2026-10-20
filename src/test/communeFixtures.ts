import { vi } from "vitest";

/**
 * Comunas de juguete (cuadrados) para probar la resolución de nombres sin cargar los
 * 11 MB de comunas.geojson. `codigos` imita codigos_territoriales.csv (sin tildes) e `ine`
 * imita ine_communes.csv (con tildes, id sin padding y columnas extra que se ignoran).
 */
interface FixtureCommune {
  code: string;
  codigos: string;
  ine: string | null; // null: el código no está en ine_communes.csv
  box: [number, number, number, number]; // lngMin, latMin, lngMax, latMax
}

export const FIXTURE_COMMUNES: FixtureCommune[] = [
  { code: "13101", codigos: "Santiago", ine: "Santiago", box: [-70.7, -33.5, -70.6, -33.4] },
  { code: "13123", codigos: "Providencia", ine: "Providencia", box: [-70.7, -33.4, -70.6, -33.3] },
  { code: "13120", codigos: "Nunoa", ine: "Ñuñoa", box: [-70.7, -33.3, -70.6, -33.2] },
  { code: "13402", codigos: "Buin", ine: "Buin", box: [-70.8, -33.75, -70.6, -33.55] },
  { code: "13119", codigos: "Maipu", ine: null, box: [-70.9, -33.95, -70.7, -33.8] },
  { code: "05101", codigos: "Valparaiso", ine: "Valparaíso", box: [-71.7, -33.1, -71.5, -33.0] },
  { code: "05502", codigos: "Calera", ine: "La Calera", box: [-71.25, -32.85, -71.15, -32.75] },
  { code: "05703", codigos: "Llaillay", ine: "Llay-Llay", box: [-70.98, -32.9, -70.9, -32.8] },
  { code: "13303", codigos: "Tiltil", ine: "Til Til", box: [-70.95, -33.15, -70.85, -33.05] },
  { code: "11302", codigos: "OHiggins", ine: "O'Higgins", box: [-73.5, -48.5, -73.0, -48.0] },
  // mismo nombre en dos regiones: ambiguo
  { code: "13990", codigos: "Repetida", ine: "Repetida", box: [-69.0, -30.0, -68.9, -29.9] },
  { code: "05990", codigos: "Repetida", ine: "Repetida", box: [-68.0, -30.0, -67.9, -29.9] },
];

const geojson = {
  type: "FeatureCollection",
  features: FIXTURE_COMMUNES.map(({ code, box: [x0, y0, x1, y1] }) => ({
    type: "Feature",
    properties: { codigo_comuna: code },
    geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
  })),
};

const codigosCsv = [
  "region_id,region_name,province_id,province_name,commune_id,commune_name",
  ...FIXTURE_COMMUNES.map((c) => `${c.code.slice(0, 2)},Region,${c.code.slice(0, 3)},Provincia,${c.code},${c.codigos}`),
].join("\n");

const ineCsv = [
  "commune_id,commune_name,superficie_km2,ingreso_promedio,nse",
  ...FIXTURE_COMMUNES.filter((c) => c.ine).map((c) => `${Number(c.code)},${c.ine},10,1000,C3`),
].join("\n");

/** Reemplaza `fetch` por uno que sirve los tres archivos de comunas (llamar `vi.unstubAllGlobals()` al terminar). */
export const stubCommuneFetch = (overrides: Record<string, { ok: boolean; status: number; body?: string }> = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const o = overrides[url];
      if (o) return { ok: o.ok, status: o.status, text: async () => o.body ?? "", json: async () => ({}) };
      const text = url === "/codigos_territoriales.csv" ? codigosCsv : url === "/ine_communes.csv" ? ineCsv : "";
      if (url === "/comunas.geojson") return { ok: true, status: 200, json: async () => geojson, text: async () => "" };
      return { ok: !!text, status: text ? 200 : 404, text: async () => text, json: async () => ({}) };
    }),
  );
