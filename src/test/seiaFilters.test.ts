import { describe, expect, it } from "vitest";
import type { SeiaFacets, SeiaFilters } from "@/types/seia";
import {
  activeFilterSummary, expedienteLink, formatDate, formatUsd, initialFilters, listTypologies, parseSeiaDefaults, pointStyle,
  projectsArgs, queryBbox, radiusFor, tooltipText, typologyCode,
} from "@/utils/seiaFilters";

const F = (over: Partial<SeiaFilters> = {}): SeiaFilters => ({ typology: null, statuses: null, yearFrom: null, yearTo: null, hideFlagged: false, sourceKeys: null, ...over });
const FACETS = (typologies: SeiaFacets["typologies"]): SeiaFacets => ({
  total: 10, with_point: 9, by_source: { seia_proyectos_dia: 10 }, geo_status: {}, typologies, statuses: [], year_min: 2018, year_max: 2024,
});

describe("tipologías (códigos EXACTOS, no letra)", () => {
  it("normaliza: minúsculas, sin espacios ni punto final (igual que la RPC)", () => {
    expect(typologyCode("h.1")).toBe("h.1");
    expect(typologyCode(" H.1 ")).toBe("h.1");
    expect(typologyCode("c.")).toBe("c");                 // el servicio real trae códigos como «c.»
    expect(typologyCode("ñ.5")).toBe("ñ.5");
    expect(typologyCode("g")).toBe("g");
    expect(typologyCode("")).toBeNull();
    expect(typologyCode("  . ")).toBeNull();
    expect(typologyCode(null)).toBeNull();
  });
  it("lista los códigos que existen; un mismo código con varios nombres se junta y los conserva todos", () => {
    const o = listTypologies([
      { letter: "h.1", name: "h.1) Proyectos inmobiliarios", n: 5 }, { letter: "h.2", name: "h.2) Industriales", n: 2 },
      { letter: "g.1", name: "g.1) Conjuntos habitacionales", n: 3 }, { letter: "G.1 ", name: "g.1) Desarrollo urbano", n: 4 },
      { letter: "c.", name: "c.) Centrales", n: 1 }, { letter: null, name: "sin código", n: 9 },
    ]);
    expect(o.map((x) => [x.code, x.n])).toEqual([["c", 1], ["g.1", 7], ["h.1", 5], ["h.2", 2]]);
    expect(o.find((x) => x.code === "g.1")!.names).toEqual(["g.1) Conjuntos habitacionales", "g.1) Desarrollo urbano"]);
    expect(listTypologies(undefined)).toEqual([]);
  });
});

describe("parámetros por defecto de la hoja (JSON libre)", () => {
  it("lee con tolerancia y normaliza los códigos", () => {
    expect(parseSeiaDefaults({ source_keys: ["a", "b"], typology: ["G", " h.1 ", "c."] })).toEqual({ sourceKeys: ["a", "b"], typology: ["g", "h.1", "c"] });
    expect(parseSeiaDefaults({ typology: ["", "  "] }).typology).toBeNull();
  });
  it.each([null, undefined, 5, "x", [], {}, { typology: "h" }, { typology: [] }, { typology: [1, 2] }, { source_keys: [null] }])("mal formado (%j) no rompe", (v) => {
    expect(parseSeiaDefaults(v)).toEqual({ sourceKeys: null, typology: null });
  });
});

describe("filtros iniciales", () => {
  const facets = FACETS([
    { letter: "g.1", name: "g.1) Conjuntos habitacionales", n: 3 }, { letter: "g.2", name: "g.2) Equipamiento", n: 2 }, { letter: "h.1", name: "h.1) Proyectos inmobiliarios", n: 5 },
    { letter: "h.2", name: "h.2) Industriales", n: 4 }, { letter: "i.4", name: "i.4) Minería", n: 4 },
  ]);
  it("expande un GRUPO («g») a los códigos que existen y deja h.2 (industrial) FUERA al pedir h.1", () => {
    const r = initialFilters({ sourceKeys: ["s1"], typology: ["g", "h.1"] }, facets);
    expect(r.filters.typology).toEqual(["g.1", "g.2", "h.1"]);                 // h.2, h.3… y la minería no entran
    expect(r.filters.sourceKeys).toEqual(["s1"]);
    expect(r.notice).toBeNull();
  });
  it("un grupo no casa por prefijo de texto: «g» no trae «gx.1», y «h.1» no trae «h.10»", () => {
    const f = FACETS([{ letter: "gx.1", name: "x", n: 1 }, { letter: "h.10", name: "x", n: 1 }, { letter: "h.1", name: "x", n: 1 }, { letter: "g", name: "x", n: 1 }]);
    expect(initialFilters({ sourceKeys: null, typology: ["g", "h.1"] }, f).filters.typology).toEqual(["g", "h.1"]);
  });
  it("avisa de lo configurado que no existe en los datos y omite solo eso", () => {
    const r = initialFilters({ sourceKeys: null, typology: ["h.1", "z.9"] }, facets);
    expect(r.filters.typology).toEqual(["h.1"]);
    expect(r.notice).toMatch(/«z\.9»/);
  });
  it("si NINGUNA existe muestra todas y lo dice, con las tipologías reales (no deja una capa vacía y 'rota')", () => {
    const r = initialFilters({ sourceKeys: null, typology: ["z"] }, facets);
    expect(r.filters.typology).toBeNull();
    expect(r.notice).toMatch(/se muestran todas/);
    expect(r.notice).toMatch(/g\.1, g\.2, h\.1, h\.2, i\.4/);
  });
  it("sin tipología configurada: todas, sin aviso", () => {
    expect(initialFilters({ sourceKeys: null, typology: null }, facets)).toMatchObject({ filters: { typology: null }, notice: null });
  });
  it("sin datos: todas y se nombra que no hay ninguna", () => {
    expect(initialFilters({ sourceKeys: null, typology: ["h.1"] }, FACETS([])).notice).toMatch(/ninguna/);
  });
});

describe("argumentos de la RPC", () => {
  const b = { west: -71, south: -34, east: -70, north: -33 };
  it("mapea los filtros a los parámetros de la función", () => {
    expect(projectsArgs(b, F({ typology: ["h"], statuses: ["Aprobado"], yearFrom: 2019, yearTo: 2022, hideFlagged: true, sourceKeys: ["x"] }), 500)).toEqual({
      p_west: -71, p_south: -34, p_east: -70, p_north: -33, p_typology: ["h"], p_status: ["Aprobado"], p_source_keys: ["x"],
      p_year_from: 2019, p_year_to: 2022, p_hide_flagged: true, p_limit: 500,
    });
  });
  it("nunca envía un arreglo vacío: «ninguna» no existe en el panel, solo «todas» (null)", () => {
    const a = projectsArgs(b, F({ typology: [], statuses: [], sourceKeys: [] }));
    expect(a.p_typology).toBeNull();
    expect(a.p_status).toBeNull();
    expect(a.p_source_keys).toBeNull();
    expect(a.p_limit).toBe(3000);
  });
});

describe("recuadro de consulta", () => {
  it("agrega margen y redondea hacia afuera (clave estable ante paneos mínimos)", () => {
    const q = queryBbox({ west: -70.62, south: -33.52, east: -70.48, north: -33.38 });
    expect(q.west).toBeLessThan(-70.62); expect(q.east).toBeGreaterThan(-70.48);
    expect(q.south).toBeLessThan(-33.52); expect(q.north).toBeGreaterThan(-33.38);
    expect(queryBbox({ west: -70.621, south: -33.521, east: -70.481, north: -33.381 })).toEqual(queryBbox({ west: -70.62, south: -33.52, east: -70.48, north: -33.38 }));
  });
  it("respeta los límites del mundo", () => {
    const q = queryBbox({ west: -179.9, south: -89.9, east: 179.9, north: 89.9 });
    expect(q).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });
  it("un contenedor sin tamaño (ancho 0) igual da un recuadro válido para la RPC", () => {
    const q = queryBbox({ west: -70, south: -33, east: -70, north: -33 });
    expect(q.west).toBeLessThan(q.east);
    expect(q.south).toBeLessThan(q.north);
  });
});

describe("estilo y tamaño", () => {
  it("lo dudoso se ve DISTINTO (hueco y punteado), no se oculta ni se disimula", () => {
    expect(pointStyle("inside").fillOpacity).toBeGreaterThan(0.5);
    expect(pointStyle("near_border").weight).toBeGreaterThan(pointStyle("inside").weight);
    for (const s of ["outside_declared", "comuna_unmatched", "pending"] as const) {
      expect(pointStyle(s).fillOpacity).toBeLessThan(0.2);
      expect(pointStyle(s).dashArray).toBeTruthy();
    }
    expect(pointStyle("outside_declared").color).not.toBe(pointStyle("comuna_unmatched").color);
  });
  it("el radio crece con la inversión, tiene tope, y sin dato es el mínimo", () => {
    expect(radiusFor(null)).toBe(4);
    expect(radiusFor(0)).toBe(4);
    expect(radiusFor(-5)).toBe(4);
    expect(radiusFor(NaN)).toBe(4);
    expect(radiusFor(1e6)).toBeLessThan(radiusFor(1e9));
    expect(radiusFor(1e15)).toBe(11);
  });
});

describe("textos y formatos", () => {
  it("resume solo los filtros activos", () => {
    expect(activeFilterSummary(F())).toEqual([]);
    expect(activeFilterSummary(F({ typology: ["g.1", "h.1"], yearFrom: 2020, hideFlagged: true, sourceKeys: ["seia_proyectos_eia"] })))
      .toEqual(["Tipologías: g.1, h.1", "Años: 2020–…", "EIA", "Sin ubicaciones dudosas"]);
    expect(activeFilterSummary(F({ typology: ["a", "b", "c", "d", "e"] }))).toEqual(["Tipologías: 5 códigos"]);          // no desborda el panel
  });
  it("la inversión faltante NO es cero", () => {
    expect(formatUsd(null)).toBe("no informada");
    expect(formatUsd("")).toBe("no informada");
    expect(formatUsd("abc")).toBe("no informada");
    expect(formatUsd(0)).toBe("US$ 0");
    expect(formatUsd(1234567.4)).toMatch(/^US\$ 1.234.567$/);
  });
  it("fechas", () => {
    expect(formatDate("2019-05-10")).toBe("10-05-2019");
    expect(formatDate("2019-05-10T12:00:00Z")).toBe("10-05-2019");
    expect(formatDate(null)).toBe("—");
  });
  it("el enlace al expediente es el del servicio; si no hay, se CONSTRUYE con el patrón real y se marca como construido", () => {
    expect(expedienteLink({ external_id: "1", expediente_url: "https://seia.example/x" })).toEqual({ url: "https://seia.example/x", built: false });
    const b = expedienteLink({ external_id: "2147600353", expediente_url: null });
    expect(b).toEqual({ url: "https://seia.sea.gob.cl/expediente/expediente.php?id_expediente=2147600353", built: true });   // patrón de URL_EXPEDIENTE real
    expect(expedienteLink({ external_id: "2145 678&x", expediente_url: null }).url).toContain("id_expediente=2145%20678%26x");   // el ID se escapa
  });
  it("el tooltip muestra SIEMPRE el estado de la evaluación y avisa cuando la ubicación no es confiable", () => {
    const base = { name: "Proy", kind: "DIA", external_id: "9", status_declared: "Desistido" } as never;
    expect(tooltipText({ ...(base as object), geo_check_status: "inside" } as never)).toBe("Proy · DIA 9 · Desistido");
    expect(tooltipText({ ...(base as object), geo_check_status: "outside_declared" } as never)).toMatch(/Desistido · .*dudosa/);
    expect(tooltipText({ ...(base as object), name: null, status_declared: null, geo_check_status: "inside" } as never)).toMatch(/sin nombre.*estado no informado/);
  });
});
