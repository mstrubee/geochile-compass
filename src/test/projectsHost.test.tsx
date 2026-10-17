/** Humo de integración: ProjectsHost dentro de un MapContainer real (jsdom), con servicios y capas simulados. Datos FIXTURE, no cifras del INE ni del SEA. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThematicLayerRow } from "@/types/permits";

const svc = vi.hoisted(() => ({
  pe: vi.fn(), cov: vi.fn(), vs: vi.fn(), crf: vi.fn(), crfBy: vi.fn(), crfCov: vi.fn(), seia: vi.fn(), seiaSum: vi.fn(), prov: vi.fn(),
}));
vi.mock("@/services/projectsService", () => ({
  fetchInePermitPoints: svc.pe, fetchIneCoverage: svc.cov, fetchIneVsMinvu: svc.vs, fetchIneCrfPolygons: svc.crf, fetchIneCrfByComuna: svc.crfBy,
  fetchIneCrfCoverage: svc.crfCov, fetchSeiaProjects: svc.seia, fetchSeiaSummary: svc.seiaSum,
}));
vi.mock("@/services/permitsService", () => ({ fetchLayerProvenance: svc.prov }));

// jsdom no tiene SVG/canvas: las capas se simulan y se verifica lo que reciben.
const got = vi.hoisted(() => ({ pe: null as unknown, crf: null as unknown, seia: null as unknown }));
vi.mock("@/components/map/InePermitPointsLayer", () => ({ InePermitPointsLayer: (p: unknown) => { got.pe = p; return null; } }));
vi.mock("@/components/map/IneCrfLayer", () => ({ CRF_POLYGON_MIN_ZOOM: 12, IneCrfLayer: (p: unknown) => { got.crf = p; return null; } }));
vi.mock("@/components/map/SeiaProjectsLayer", () => ({ SeiaProjectsLayer: (p: unknown) => { got.seia = p; return null; } }));

import { ProjectsHost } from "@/components/map/ProjectsHost";

const L = (layer_id: string, renderer: ThematicLayerRow["renderer"], dataset: string): ThematicLayerRow =>
  ({ layer_id, renderer, dataset, default_params: null }) as ThematicLayerRow;
const THEMATIC = [L("PE", "points_permits", "ine_permit_points"), L("CRF", "polygons_crf", "ine_crf"), L("SE", "points_projects", "building_projects")];

const mount = (visible: string[], thematic = THEMATIC) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapContainer center={[-33, -70]} zoom={5} style={{ height: 300, width: 300 }}>
        <ProjectsHost thematic={thematic} visibleLayerIds={new Set(visible)} />
      </MapContainer>
    </QueryClientProvider>,
  );
};

const cov = (year: number) => ({ year, points: 10, units: 20, comunas: 5, comunas_total: 346, precision_high: 5, precision_moderate: 3, precision_low: 1, precision_none: 1, outside_declared: 0 });

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  svc.prov.mockResolvedValue([]); svc.pe.mockResolvedValue([]); svc.vs.mockResolvedValue([]); svc.crf.mockResolvedValue([]);
  svc.crfBy.mockResolvedValue([]); svc.seia.mockResolvedValue([]); svc.seiaSum.mockResolvedValue([]);
  svc.cov.mockResolvedValue([cov(2019), cov(2024), cov(2022)]);
  svc.crfCov.mockResolvedValue([{ year: 2017, polygons: 1, dwellings: 1, comunas: 1, comunas_total: 346, repaired: 0 }, { year: 2025, polygons: 1, dwellings: 1, comunas: 1, comunas_total: 346, repaired: 0 }]);
  got.pe = got.crf = got.seia = null;
});

describe("ProjectsHost", () => {
  it("con las tres capas apagadas no consulta nada ni pinta paneles", () => {
    mount([]);
    Object.values(svc).forEach((m) => expect(m).not.toHaveBeenCalled());
    for (const id of ["permit-points-panel", "crf-panel", "seia-panel"]) expect(screen.queryByTestId(id)).toBeNull();
  });

  it("permisos INE: por defecto pide solo el ÚLTIMO año con datos, nunca todo el país", async () => {
    mount(["PE"]);
    await waitFor(() => expect(screen.getByTestId("permit-points-panel")).toBeTruthy());
    await waitFor(() => expect(svc.pe).toHaveBeenCalled());
    const [, , filters] = svc.pe.mock.calls[0];
    expect(filters).toMatchObject({ years: [2024], minPrecision: 2 });
    expect(svc.pe.mock.calls.every((c) => c[2].years?.length === 1)).toBe(true);
    expect(svc.crf).not.toHaveBeenCalled();
    expect(svc.seia).not.toHaveBeenCalled();
  });

  it("CRF: último año de cobertura; con zoom bajo usa el resumen por comuna y no los polígonos", async () => {
    mount(["CRF"]);
    await waitFor(() => expect(svc.crfBy).toHaveBeenCalled());
    expect(svc.crfBy.mock.calls[0][0]).toEqual([2025]);
    expect(svc.crf).not.toHaveBeenCalled();
    expect(screen.getByTestId("crf-panel")).toBeTruthy();
  });

  it("SEIA: filtra por defecto Aprobado / En Calificación y muestra la advertencia de inversión declarada por el titular", async () => {
    mount(["SE"]);
    await waitFor(() => expect(svc.seia).toHaveBeenCalled());
    expect(svc.seia.mock.calls[0][1].states).toEqual(["Aprobado", "En Calificación"]);
    expect(screen.getByTestId("seia-panel").textContent?.toLowerCase()).toContain("la inversión es la declarada por el titular");
  });

  it("los paneles se apilan sin pisarse (offset por posición entre las capas visibles)", async () => {
    mount(["PE", "CRF", "SE"]);
    await waitFor(() => expect(screen.getByTestId("seia-panel")).toBeTruthy());
    const right = (id: string) => (screen.getByTestId(id) as HTMLElement).style.right;
    expect(right("permit-points-panel")).toContain("0 *");
    expect(right("crf-panel")).toContain("1 *");
    expect(right("seia-panel")).toContain("2 *");
  });

  it("si solo está la capa SEIA, su panel queda en la primera posición", async () => {
    mount(["SE"]);
    await waitFor(() => expect(screen.getByTestId("seia-panel")).toBeTruthy());
    expect((screen.getByTestId("seia-panel") as HTMLElement).style.right).toContain("0 *");
  });

  it("sin datos cargados avisa la licencia 'por confirmar' / ausencia de fuente en vez de quedar mudo", async () => {
    mount(["PE"]);
    await waitFor(() => expect(screen.getByTestId("permit-points-panel")).toBeTruthy());
    await waitFor(() => expect(svc.prov).toHaveBeenCalledWith("ine_permit_points"));
    expect(screen.getByTestId("permit-points-panel").textContent).toMatch(/Todavía no hay datos|sin datos|no hay/i);
  });

  it("error al leer la procedencia: lo muestra", async () => {
    svc.prov.mockRejectedValue(new Error("sin permiso"));
    mount(["SE"]);
    await waitFor(() => expect(screen.getByTestId("seia-panel").textContent).toContain("sin permiso"), { timeout: 5000 });
  });
});
