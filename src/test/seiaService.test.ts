import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), prov: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: m.rpc } }));
vi.mock("@/services/permitsService", () => ({ fetchLayerProvenance: m.prov }));

import { fetchSeiaFacets, fetchSeiaProject, fetchSeiaProjects, fetchSeiaProvenance } from "@/services/seiaService";

const FILTERS = { typology: ["h"], statuses: null, yearFrom: 2020, yearTo: null, hideFlagged: true, sourceKeys: null };
const B = { west: -71, south: -34, east: -70, north: -33 };

beforeEach(() => { m.rpc.mockReset(); m.prov.mockReset(); });

describe("seiaService", () => {
  it("get_seia_projects: nombre de la RPC y parámetros", async () => {
    m.rpc.mockResolvedValue({ data: [{ id: 1 }], error: null });
    expect(await fetchSeiaProjects(B, FILTERS, 100)).toEqual([{ id: 1 }]);
    expect(m.rpc).toHaveBeenCalledWith("get_seia_projects", expect.objectContaining({
      p_west: -71, p_typology: ["h"], p_status: null, p_year_from: 2020, p_hide_flagged: true, p_limit: 100,
    }));
  });
  it("sin filas es [], no null", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchSeiaProjects(B, FILTERS)).toEqual([]);
  });
  it("un error de la base se propaga con su mensaje (no se traga)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "recuadro inválido" } });
    await expect(fetchSeiaProjects(B, FILTERS)).rejects.toThrow("recuadro inválido");
    await expect(fetchSeiaFacets(null)).rejects.toThrow("recuadro inválido");
    await expect(fetchSeiaProject("s", "1")).rejects.toThrow("recuadro inválido");
  });
  it("facetas: sin fuentes envía null; sin datos es un error explícito", async () => {
    m.rpc.mockResolvedValue({ data: { total: 3 }, error: null });
    await fetchSeiaFacets([]);
    expect(m.rpc).toHaveBeenLastCalledWith("get_seia_facets", { p_source_keys: null });
    await fetchSeiaFacets(["a"]);
    expect(m.rpc).toHaveBeenLastCalledWith("get_seia_facets", { p_source_keys: ["a"] });
    m.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchSeiaFacets(null)).rejects.toThrow(/no devolvió datos/);
  });
  it("ficha: null cuando el expediente ya no está vigente", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchSeiaProject("seia_proyectos_dia", "9")).toBeNull();
    expect(m.rpc).toHaveBeenCalledWith("get_seia_project", { p_source_key: "seia_proyectos_dia", p_external_id: "9" });
  });
  it("la procedencia usa la misma RPC de permisos con el dataset de proyectos", async () => {
    m.prov.mockResolvedValue([]);
    await fetchSeiaProvenance();
    expect(m.prov).toHaveBeenCalledWith("building_projects");
  });
});
