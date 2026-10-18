import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const writeFileMock = vi.fn();
vi.mock("xlsx", async (orig) => {
  const real = await orig<typeof import("xlsx")>();
  return { ...real, writeFile: (...a: unknown[]) => writeFileMock(...a) };
});
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));

import { COMMUNES } from "@/data/communes";
import { POBLACION_LABEL, SIN_DATO, type PoblacionComunalRow } from "@/types/poblacion";
import {
  buildPoblacionIndex, loadPoblacionIndex, normName, poblacionOf, resetPoblacionCache,
} from "@/services/poblacionService";
import { buildIneIndex, loadIneIndex, parseCSV, resetIneCache } from "@/services/ineService";
import { useCommunesWithPopulation } from "@/hooks/usePoblacion";
import { CommunePopup } from "@/components/map/CommuneLayer";
import { crimePopup } from "@/components/map/CrimeLayer";
import { popSourceLabel, popSourceShort } from "@/utils/isochroneAnalysis";
import { exportCommunesToExcel } from "@/services/communeDataService";
import { buildRegionCells } from "@/services/poiFeaturePayloadBuilder";

const PUBLIC = resolve(__dirname, "../../public");
const csvCodigos = readFileSync(resolve(PUBLIC, "codigos_territoriales.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const csvIne = readFileSync(resolve(PUBLIC, "ine_communes.csv"), "utf8");
const CODIGOS: Record<string, string> = Object.fromEntries(csvCodigos.map((c) => [c[4], c[5]]));

/** Censo sintético: una fila por comuna de codigos_territoriales.csv, población = 1000 + índice (distinta de cualquier cifra del CSV viejo). */
const censoSintetico = (): PoblacionComunalRow[] =>
  Object.entries(CODIGOS).map(([cut, comuna], i) => ({
    snapshot_id: "s1", period_start: "2024-01-01", period_end: "2024-12-31", declared_date: "2025-03-27",
    cut, comuna, region_cut: cut.slice(0, 2), total: 1000 + i, hombres: 500, mujeres: 500 + i,
  }) as PoblacionComunalRow);

beforeEach(() => {
  rpcMock.mockReset();
  resetPoblacionCache();
  resetIneCache();
});
afterEach(() => vi.restoreAllMocks());

describe("índice de población censada", () => {
  it("el CSV de comunas no trae población y la lectura la ignora aunque venga", () => {
    expect(csvIne.split(/\r?\n/)[0]).toBe("commune_id,commune_name,superficie_km2,ingreso_promedio,nse");
    const legado = "commune_id,commune_name,poblacion,superficie_km2,ingreso_promedio,nse\n13101,Santiago,404495,22.4,900000,C2\n";
    const rows = parseCSV(legado);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("poblacion");
    const idx = buildIneIndex(rows, buildPoblacionIndex([]));
    expect(idx.byCode.get("13101")?.poblacion).toBeNull();
    expect(idx.byCode.get("13101")?.densidad).toBeNull();
  });

  it("toda comuna de COMMUNES y del CSV de ine resuelve a su CUT (nombres, tildes y alias)", () => {
    const pob = buildPoblacionIndex(censoSintetico(), CODIGOS);
    const sinCruce = COMMUNES.map((c) => c.name).filter((n) => poblacionOf(pob, { name: n }) == null);
    expect(sinCruce).toEqual([]);
    const ine = buildIneIndex(parseCSV(csvIne), pob);
    const sinPob = [...ine.byCode.entries()].filter(([, v]) => v.poblacion == null).map(([k]) => k);
    expect(sinPob).toEqual([]);
    expect(ine.byCode.size).toBe(346);
  });

  it("la población es la del Censo por CUT, no la del CSV: Santiago/Puente Alto/Camarones", () => {
    const rows = censoSintetico().map((r) => (r.cut === "13101" ? { ...r, total: 438856 } : r.cut === "13201" ? { ...r, total: 568086 } : r.cut === "15102" ? { ...r, total: 861 } : r));
    const ine = buildIneIndex(parseCSV(csvIne), buildPoblacionIndex(rows, CODIGOS));
    expect(ine.byCode.get("13101")?.poblacion).toBe(438856);
    expect(ine.byName.get(normName("Puente Alto"))?.poblacion).toBe(568086);
    expect(ine.byName.get("camarones")?.poblacion).toBe(861);
  });

  it("normName iguala tildes, apóstrofes y mayúsculas", () => {
    expect(normName("O’Higgins")).toBe(normName("O'HIGGINS"));
    expect(normName("Ñuñoa")).toBe("nunoa");
  });

  it("un error de la RPC no se disfraza y no se cachea; el siguiente llamado reintenta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const a = await loadPoblacionIndex();
    expect(a.status).toBe("error");
    expect(a.error).toBe("permission denied");
    expect(poblacionOf(a, { cut: "13101" })).toBeNull();
    rpcMock.mockResolvedValueOnce({ data: censoSintetico(), error: null });
    const b = await loadPoblacionIndex();
    expect(b.status).toBe("ok");
    expect(rpcMock).toHaveBeenCalledTimes(2);
    await loadPoblacionIndex();
    expect(rpcMock).toHaveBeenCalledTimes(2); // éxito sí se cachea
  });

  it("base sin captura (vacía): estado empty y toda población «sin dato», sin cifras de respaldo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    rpcMock.mockResolvedValue({ data: [], error: null });
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).includes("ine_communes") ? new Response(csvIne, { headers: { "content-type": "text/csv" } }) : new Response("", { status: 404 }))));
    const ine = await loadIneIndex();
    expect(ine.poblacion.status).toBe("empty");
    expect([...ine.byCode.values()].every((s) => s.poblacion == null && s.densidad == null)).toBe(true);
    expect(ine.byCode.size).toBe(346);
    // «vacía» tampoco se cachea: en cuanto la base tenga la captura, el siguiente llamado la lee
    rpcMock.mockResolvedValue({ data: censoSintetico(), error: null });
    expect((await loadPoblacionIndex()).status).toBe("ok");
  });
});

describe("capas y fichas", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it("COMMUNES ya no lleva población en el código", () => {
    expect(COMMUNES.every((c) => c.pop === 0)).toBe(true);
  });

  it("useCommunesWithPopulation entrega la cifra censada y 0 (sin dato) donde falta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const rows = censoSintetico().filter((r) => r.cut !== "13101").map((r) => (r.cut === "13201" ? { ...r, total: 568086 } : r));
    rpcMock.mockResolvedValue({ data: rows, error: null });
    const { result } = renderHook(() => useCommunesWithPopulation(), { wrapper });
    await waitFor(() => expect(result.current.find((c) => c.name === "Puente Alto")?.pop).toBe(568086));
    expect(result.current.find((c) => c.name === "Santiago")?.pop).toBe(0);
    expect(result.current.find((c) => c.name === "Santiago")?.density).toBe(0);
  });

  it("el popup de comuna rotula «Población censada 2024 (INE)» y muestra «sin dato» sin cifra", () => {
    const base = COMMUNES.find((c) => c.name === "Puente Alto")!;
    const { unmount } = render(<CommunePopup c={{ ...base, pop: 568086 }} lat={0} lng={0} />);
    expect(screen.getByText(POBLACION_LABEL)).toBeInTheDocument();
    expect(screen.getByText(/568/)).toBeInTheDocument();
    unmount();
    render(<CommunePopup c={{ ...base, pop: 0 }} lat={0} lng={0} />);
    expect(screen.getByText(POBLACION_LABEL)).toBeInTheDocument();
    expect(screen.getByText(SIN_DATO)).toBeInTheDocument();
  });

  it("el popup de delitos usa la censada y deja la base de la tasa aparte, sin llamarla población", () => {
    const p = { comuna: "Camarones", poblacion: 679, nivel_riesgo: "Bajo" };
    const con = crimePopup(p, 861);
    expect(con).toContain(POBLACION_LABEL);
    expect(con).toContain("861");
    expect(con).toContain("Base de la tasa (sin fuente)");
    const sin = crimePopup(p, null);
    expect(sin).toContain(SIN_DATO);
    expect(sin).not.toMatch(/Censo 2024<\/div>/);
  });

  it("la exportación a Excel usa la columna censada y deja vacío el sin dato", async () => {
    const XLSX = await import("xlsx");
    writeFileMock.mockReset();
    const base = COMMUNES.slice(0, 2);
    exportCommunesToExcel("x.xlsx", [{ ...base[0], pop: 1234 }, { ...base[1], pop: 0 }]);
    const wb = writeFileMock.mock.calls[0][0] as import("xlsx").WorkBook;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Comunas"]);
    expect(rows[0][POBLACION_LABEL]).toBe(1234);
    expect(rows[1][POBLACION_LABEL] ?? null).toBeNull();
  });
});

describe("isócronas y payload de POI", () => {
  it("rotula la fuente exacta de la población", () => {
    expect(popSourceLabel({ source: "comuna", popSource: "comuna" })).toMatch(/Población censada 2024 \(INE\)/);
    expect(popSourceLabel({ source: "manzanas", popSource: "manzanas2017" })).toMatch(/Censo 2017/);
    expect(popSourceLabel({ source: "manzanas", popSource: "gse" })).toMatch(/GSE 2024.*no es la cifra comunal/);
    expect(popSourceLabel({ source: "manzanas" })).toMatch(/GSE 2024/); // análisis guardados sin popSource
    expect(popSourceShort({ source: "comuna" })).toBe("Censo 2024");
    expect(popSourceShort({ source: "manzanas", popSource: "manzanas2017" })).toBe("Censo 2017");
    expect(popSourceShort({ source: "manzanas" })).toBe("GSE 2024");
  });

  const poi = { id: "p", lng: -70.6, lat: -33.4, name: "x" } as never;
  const stubFetch = () =>
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      if (String(u).includes("comunas.geojson")) return new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), { headers: { "content-type": "application/json" } });
      if (String(u).includes("codigos_territoriales")) return new Response("a,b,c,d,e,f\n", { headers: { "content-type": "text/csv" } });
      if (String(u).includes("ine_communes")) return new Response(csvIne, { headers: { "content-type": "text/csv" } });
      return new Response("", { status: 404 });
    }));

  it("sin comuna o sin población censada NO inventa una celda de 50.000 habitantes", async () => {
    stubFetch();
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(await buildRegionCells(poi, null)).toEqual([]);
    expect(await buildRegionCells(poi, "Puente Alto")).toEqual([]);
  });

  it("con población censada, la celda comunal usa esa cifra y la superficie de su fuente; hogares derivados, no fijos", async () => {
    stubFetch();
    const rows = censoSintetico().map((r) => (r.cut === "13201" ? { ...r, total: 568086 } : r));
    rpcMock.mockResolvedValue({ data: rows, error: null });
    const cells = await buildRegionCells(poi, "Puente Alto");
    expect(cells).toHaveLength(1);
    expect(cells[0].pop).toBe(568086);
    expect(cells[0].hh).toBe(Math.round(568086 / 3.2));
    expect(cells[0].area_m2).toBeGreaterThan(0);
    expect(cells[0].area_m2).not.toBe(50_000_000);
    expect(cells[0].density).toBeCloseTo(568086 / (cells[0].area_m2 / 1_000_000), 6);
  });
});
