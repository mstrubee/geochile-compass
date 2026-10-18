/** Humo de integración: HealthHost dentro de un MapContainer real (jsdom), con servicios y capas simulados. Datos FIXTURE, no cifras del registro. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThematicLayerRow } from "@/types/permits";

const svc = vi.hoisted(() => ({ pts: vi.fn(), counts: vi.fn(), summary: vi.fn(), tipos: vi.fn(), prov: vi.fn() }));
vi.mock("@/services/healthService", () => ({
  fetchHealthEstablishments: svc.pts, fetchHealthComunaCounts: svc.counts, fetchHealthSummary: svc.summary, fetchHealthTipos: svc.tipos,
}));
vi.mock("@/services/permitsService", () => ({ fetchLayerProvenance: svc.prov }));
vi.mock("@/hooks/useComunasGeoIndex", () => ({ useComunasGeoIndex: () => ({ ready: false, fc: null, nombresPorCodigo: {} }) }));

// jsdom no tiene SVG/canvas: las capas se simulan y se verifica lo que reciben.
const got = vi.hoisted(() => ({ pts: null as unknown, choro: null as unknown }));
vi.mock("@/components/map/HealthPointsLayer", () => ({ HealthPointsLayer: (p: unknown) => { got.pts = p; return null; } }));
vi.mock("@/components/map/HealthChoroplethLayer", () => ({ HealthChoroplethLayer: (p: unknown) => { got.choro = p; return null; } }));

import { HealthHost } from "@/components/map/HealthHost";

const T = (layer_id: string, renderer: ThematicLayerRow["renderer"], over: Partial<ThematicLayerRow> = {}): ThematicLayerRow =>
  ({ layer_id, renderer, dataset: "health_establishments", default_params: null, client_ready: false, client_ready_note: "Pendiente.", ...over }) as ThematicLayerRow;
const THEMATIC = [T("HP", "points_health"), T("HC", "choropleth_health")];

const mount = (visible: string[], thematic: ThematicLayerRow[] = THEMATIC) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapContainer center={[-33, -70]} zoom={5} style={{ height: 300, width: 300 }}>
        <HealthHost thematic={thematic} visibleLayerIds={new Set(visible)} />
      </MapContainer>
    </QueryClientProvider>,
  );
};

const row = (cut: string, name: string, n: number) => ({ cut, name, region_cut: cut.slice(0, 2), region_name: "Región de prueba", establishments: n, imputed: 0, not_drawable: 0, marked_geo: 0, rank: 1, snapshot_id: "s", captured_at: "2026-10-17T00:00:00Z" });

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  svc.prov.mockResolvedValue([]); svc.pts.mockResolvedValue([]); svc.summary.mockResolvedValue([]); svc.tipos.mockResolvedValue([]);
  svc.counts.mockResolvedValue([row("13101", "Santiago", 12), row("13102", "Cerrillos", 0)]);
  got.pts = got.choro = null;
});

describe("HealthHost", () => {
  it("con las capas apagadas no consulta nada ni pinta paneles", () => {
    mount([]);
    Object.values(svc).forEach((m) => expect(m).not.toHaveBeenCalled());
    expect(screen.queryByTestId("health-points-panel")).toBeNull();
    expect(screen.queryByTestId("health-choropleth-panel")).toBeNull();
  });

  it("puntos: por defecto oculta cerrados, sin filtros, y pide la procedencia del dataset de salud (no la de permisos)", async () => {
    mount(["HP"]);
    await waitFor(() => expect(screen.getByTestId("health-points-panel")).toBeTruthy());
    await waitFor(() => expect(svc.pts).toHaveBeenCalled());
    expect(svc.pts.mock.calls[0][1]).toMatchObject({ includeClosed: false, dependencia: null, alta: null });
    expect(svc.prov).toHaveBeenCalledWith("health_establishments");
    expect(svc.counts).not.toHaveBeenCalled();
    expect(screen.getByTestId("health-not-client-ready")).toBeTruthy();
  });

  it("coropleta: pide los conteos con el filtro y los pasa a la capa; el ranking sale de los mismos datos", async () => {
    mount(["HC"]);
    await waitFor(() => expect(screen.getByTestId("rank-13101")).toBeTruthy());
    expect(svc.counts.mock.calls[0][0]).toMatchObject({ includeClosed: false, alta: null });
    expect((got.choro as { rows: unknown[] }).rows).toHaveLength(2);
    expect((got.choro as { breaks: number[] }).breaks).toEqual([12]);
    expect(svc.pts).not.toHaveBeenCalled();
  });

  it("cambiar la definición de alta complejidad vuelve a pedir los conteos con esa definición", async () => {
    mount(["HC"]);
    await waitFor(() => expect(svc.counts).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Definición de alta complejidad"), { target: { value: "ampliada" } });
    await waitFor(() => expect(svc.counts.mock.calls.at(-1)?.[0]).toMatchObject({ alta: "ampliada" }));
  });

  it("default_params.include_closed arranca incluyendo cerrados", async () => {
    mount(["HP"], [T("HP", "points_health", { default_params: { include_closed: true } })]);
    await waitFor(() => expect(svc.pts).toHaveBeenCalled());
    expect(svc.pts.mock.calls[0][1].includeClosed).toBe(true);
  });

  it("los paneles se apilan sin pisarse (puntos primero, coropleta después)", async () => {
    mount(["HP", "HC"]);
    await waitFor(() => expect(screen.getByTestId("health-choropleth-panel")).toBeTruthy());
    const right = (id: string) => (screen.getByTestId(id) as HTMLElement).style.right;
    expect(right("health-points-panel")).toContain("0 *");
    expect(right("health-choropleth-panel")).toContain("1 *");
  });

  it("se apilan a la IZQUIERDA de los paneles de permisos y proyectos que estén abiertos", async () => {
    const others = [T("PE", "points_permits", { dataset: "ine_permit_points", client_ready: null }), T("SE", "points_projects", { dataset: "building_projects", client_ready: null })];
    mount(["PE", "SE", "HC"], [...THEMATIC, ...others]);
    await waitFor(() => expect(screen.getByTestId("health-choropleth-panel")).toBeTruthy());
    expect((screen.getByTestId("health-choropleth-panel") as HTMLElement).style.right).toContain("2 *");
  });

  it("no captura la capa de permisos (choropleth_comuna): ese renderer no es de salud", () => {
    mount(["PX"], [T("PX", "choropleth_comuna", { dataset: "building_permits", client_ready: null })]);
    expect(screen.queryByTestId("health-choropleth-panel")).toBeNull();
    Object.values(svc).forEach((m) => expect(m).not.toHaveBeenCalled());
  });

  it("error de procedencia: lo muestra", async () => {
    svc.prov.mockRejectedValue(new Error("sin permiso"));
    mount(["HP"]);
    await waitFor(() => expect(screen.getByTestId("health-points-panel").textContent).toContain("sin permiso"), { timeout: 5000 });
  });

  it("la ficha pide el resumen y la tabla de clasificación SOLO al abrirla", async () => {
    mount(["HP"]);
    await waitFor(() => expect(screen.getByTestId("health-points-panel")).toBeTruthy());
    expect(svc.summary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Ver definiciones y clasificación/ }));
    await waitFor(() => expect(svc.tipos).toHaveBeenCalled());
    expect(svc.summary).toHaveBeenCalled();
  });
});
