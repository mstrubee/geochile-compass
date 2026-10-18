/** Humo de integración: PrevisionHost dentro de un MapContainer real (jsdom), con servicios y capas simulados. Datos FIXTURE. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThematicLayerRow } from "@/types/permits";

const svc = vi.hoisted(() => ({ comuna: vi.fn(), resumen: vi.fn(), sinAlta: vi.fn(), casen: vi.fn(), prov: vi.fn(), pen: vi.fn() }));
vi.mock("@/services/previsionService", () => ({ fetchIsapreComuna: svc.comuna, fetchIsapreResumen: svc.resumen, fetchIsapreSinAlta: svc.sinAlta, fetchCasenRegion: svc.casen, fetchIsaprePenetracion: svc.pen }));
vi.mock("@/services/permitsService", () => ({ fetchLayerProvenance: svc.prov }));
vi.mock("@/hooks/useComunasGeoIndex", () => ({ useComunasGeoIndex: () => ({ ready: false, fc: null, nombresPorCodigo: {} }) }));

const got = vi.hoisted(() => ({ layer: null as unknown }));
vi.mock("@/components/map/IsapreChoroplethLayer", () => ({ IsapreChoroplethLayer: (p: unknown) => { got.layer = p; return null; } }));

import { PrevisionHost } from "@/components/map/PrevisionHost";

const T = (layer_id: string, renderer: ThematicLayerRow["renderer"], dataset: string, over: Partial<ThematicLayerRow> = {}): ThematicLayerRow =>
  ({ layer_id, renderer, dataset, default_params: null, client_ready: false, client_ready_note: "Pendiente.", ...over }) as ThematicLayerRow;
const THEMATIC = [T("IS", "choropleth_isapre", "isapre_cartera"), T("CA", "panel_casen_region", "casen_prevision")];

const mount = (visible: string[], thematic: ThematicLayerRow[] = THEMATIC) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapContainer center={[-33, -70]} zoom={5} style={{ height: 300, width: 300 }}>
        <PrevisionHost thematic={thematic} visibleLayerIds={new Set(visible)} />
      </MapContainer>
    </QueryClientProvider>,
  );
};

const comuna = (cut: string, name: string, lo: number, hi: number) => ({ cut, name, region_cut: cut.slice(0, 2), n_lo: lo, n_hi: hi, exact: lo === hi, suppressed_cells: lo === hi ? 0 : 2, snapshot_id: "s", period_end: "2025-12-31" });
const sinAlta = { comunas_sin_alta: 20, comunas_con_dato: 18, benef_exacto: 5000, benef_pub_lo: 4900, benef_pub_hi: 5100, consistente: true, benef_total_comunas: 90000, snapshot_id: "s", period_end: "2025-12-31", health_snapshot_id: "h" };
const casen = { region_cut: "13", region_name: "Metropolitana", sistema: "isapre", publishable: true, reason: null, n_sample: 400, pct: 15, se: 1, ci_lo: 13, ci_hi: 17, snapshot_id: "c", period_end: "2024-12-31" };

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  svc.prov.mockResolvedValue([]); svc.resumen.mockResolvedValue([]); svc.sinAlta.mockResolvedValue([sinAlta]); svc.casen.mockResolvedValue([casen]); svc.pen.mockResolvedValue([]);
  svc.comuna.mockResolvedValue([comuna("90001", "A", 10, 10), comuna("90002", "B", 20, 30)]);
  got.layer = null;
});

describe("PrevisionHost", () => {
  it("con las capas apagadas no consulta nada ni pinta paneles", () => {
    mount([]);
    Object.values(svc).forEach((m) => expect(m).not.toHaveBeenCalled());
    expect(screen.queryByTestId("isapre-choropleth-panel")).toBeNull();
    expect(screen.queryByTestId("casen-region-panel")).toBeNull();
  });

  it("Isapre: pide las comunas sin filtros, pasa los rangos a la capa y pide la procedencia de SU dataset", async () => {
    mount(["IS"]);
    await waitFor(() => expect(screen.getByTestId("isapre-sin-alta-value")).toBeTruthy());
    expect(svc.comuna.mock.calls[0][0]).toEqual({ sexo: null, minTramo: 0, sinAlta: null });
    expect((got.layer as { rows: unknown[] }).rows).toHaveLength(2);
    expect(svc.prov).toHaveBeenCalledWith("isapre_cartera");
    expect(svc.prov).toHaveBeenCalledWith("poblacion_censo2024");
    expect(svc.casen).not.toHaveBeenCalled();
    expect(screen.getByTestId("health-not-client-ready")).toBeTruthy();
  });

  it("1b-1 pide 60+ (tramo 12) con la definición «hospital» y, al cambiarla, con «ampliada»", async () => {
    mount(["IS"]);
    await waitFor(() => expect(svc.sinAlta).toHaveBeenCalledWith("hospital", 12));
    fireEvent.change(screen.getByLabelText("Definición de alta complejidad (1b-1)"), { target: { value: "ampliada" } });
    await waitFor(() => expect(svc.sinAlta).toHaveBeenCalledWith("ampliada", 12));
  });

  it("cambiar edad y sexo vuelve a pedir las comunas con esos parámetros", async () => {
    mount(["IS"]);
    await waitFor(() => expect(svc.comuna).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Edad"), { target: { value: "12" } });
    await waitFor(() => expect(svc.comuna.mock.calls.at(-1)?.[0]).toMatchObject({ minTramo: 12 }));
    fireEvent.change(screen.getByLabelText("Solo comunas sin alta complejidad"), { target: { value: "hospital" } });
    await waitFor(() => expect(svc.comuna.mock.calls.at(-1)?.[0]).toMatchObject({ minTramo: 12, sinAlta: "hospital" }));
  });

  it("si 1b-1 falla (p. ej. conjunto demasiado acotado) muestra el motivo, y el mapa sigue", async () => {
    svc.sinAlta.mockRejectedValue(new Error("el conjunto cubre 3 comunas (< 10)"));
    mount(["IS"]);
    await waitFor(() => expect(screen.getByTestId("isapre-sin-alta").textContent).toContain("el conjunto cubre 3 comunas"), { timeout: 5000 });
    expect(screen.getByTestId("isapre-legend").textContent).toContain("2 comunas");
  });

  it("CASEN: solo panel (no monta capa de mapa) y pide la procedencia de su dataset", async () => {
    mount(["CA"]);
    await waitFor(() => expect(screen.getByTestId("casen-13-isapre")).toBeTruthy());
    expect(svc.prov).toHaveBeenCalledWith("casen_prevision");
    expect(got.layer).toBeNull();
    expect(svc.comuna).not.toHaveBeenCalled();
  });

  it("los paneles se apilan sin pisarse y a la IZQUIERDA de los de salud y permisos abiertos", async () => {
    const others = [T("HC", "choropleth_health", "health_establishments", { client_ready: null }), T("PE", "points_permits", "ine_permit_points", { client_ready: null })];
    mount(["IS", "CA", "HC", "PE"], [...THEMATIC, ...others]);
    await waitFor(() => expect(screen.getByTestId("casen-region-panel")).toBeTruthy());
    const right = (id: string) => (screen.getByTestId(id) as HTMLElement).style.right;
    expect(right("isapre-choropleth-panel")).toContain("2 *");
    expect(right("casen-region-panel")).toContain("3 *");
  });

  it("no captura la capa de permisos ni la de salud: esos renderers no son de previsión", () => {
    mount(["PX"], [T("PX", "choropleth_comuna", "building_permits", { client_ready: null }), T("HC", "choropleth_health", "health_establishments")]);
    Object.values(svc).forEach((m) => expect(m).not.toHaveBeenCalled());
  });

  it("error de procedencia: lo muestra", async () => {
    svc.prov.mockRejectedValue(new Error("sin permiso"));
    mount(["IS"]);
    await waitFor(() => expect(screen.getByTestId("isapre-choropleth-panel").textContent).toContain("sin permiso"), { timeout: 5000 });
  });
});
