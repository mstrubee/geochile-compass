/** Humo de integración: PermitsHost dentro de un MapContainer real (jsdom), con servicios simulados. Datos FIXTURE, no cifras de MINVU. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LayerProvenanceRow } from "@/types/permits";

const svc = vi.hoisted(() => ({ prov: vi.fn(), choro: vi.fn(), series: vi.fn(), thematic: vi.fn() }));
vi.mock("@/services/permitsService", () => ({
  fetchLayerProvenance: svc.prov, fetchPermitChoropleth: svc.choro, fetchPermitSeries: svc.series, fetchThematicLayers: svc.thematic,
}));
vi.mock("@/hooks/useComunasGeoIndex", () => ({
  useComunasGeoIndex: () => ({ ready: true, fc: { type: "FeatureCollection", features: [
    { type: "Feature", properties: { codigo_comuna: "01101" }, geometry: { type: "Polygon", coordinates: [[[-70, -33], [-69, -33], [-69, -32], [-70, -33]]] } },
  ] }, nombresPorCodigo: { "01101": "A" } }),
}));

// jsdom no tiene SVG/canvas: Leaflet no puede dibujar polígonos aquí. La capa se simula y se verifica lo que recibe.
const layerProps = vi.hoisted(() => ({ last: null as null | { rows: unknown; breaks: number[] } }));
vi.mock("@/components/map/PermitsChoroplethLayer", () => ({
  PermitsChoroplethLayer: (p: { rows: unknown; breaks: number[] }) => { layerProps.last = p; return null; },
}));

import { PermitsHost } from "@/components/map/PermitsHost";

const P = (key: string, over: Partial<LayerProvenanceRow> = {}): LayerProvenanceRow => ({
  source_key: key, name: "FIXTURE", publisher: "Publicador de prueba", landing_url: "https://example.test/", attribution: "x", license_label: null,
  verification_status: "comprobado", scope_note: null, access_mode: "manual", freshness_status: "fresh", check_overdue: false, overdue_since: null,
  last_checked_at: null, snapshot_id: "s", origin_url: "https://example.test/f.xlsx", sha256: "00", captured_at: "2026-10-16T00:00:00Z",
  period_start: "2002-01-01", period_end: "2026-07-31", load_from: "2002-01-01", declared_date: null, definitive_until: 2024, quality_note: null, ...over,
});
const THEMATIC = [{ layer_id: "L1", renderer: "choropleth_comuna" as const, dataset: "building_permits", default_params: null }];

const mount = (visible: string[]) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapContainer center={[-33, -70]} zoom={5} style={{ height: 300, width: 300 }}>
        <PermitsHost thematic={THEMATIC} visibleLayerIds={new Set(visible)} />
      </MapContainer>
    </QueryClientProvider>,
  );
};

beforeEach(() => Object.values(svc).forEach((m) => m.mockReset()));

describe("PermitsHost", () => {
  it("capa apagada: no consulta nada ni pinta nada", () => {
    mount([]);
    expect(svc.prov).not.toHaveBeenCalled();
    expect(svc.choro).not.toHaveBeenCalled();
    expect(screen.queryByTestId("permits-panel")).toBeNull();
  });
  it("capa encendida: pide procedencia, luego la coropleta del último año completo, y muestra el panel", async () => {
    svc.prov.mockResolvedValue([P("minvu_cedoc_permisos_anual"), P("minvu_cedoc_permisos_mensual", { period_start: "2021-08-01", load_from: "2021-08-01" })]);
    svc.choro.mockResolvedValue([{ comuna_cut: "01101", comuna_name: "A", value: 5, prev_value: null, yoy_pct: null, coverage_ok: true, is_provisional: true, snapshot_ids: null }]);
    mount(["L1"]);
    await waitFor(() => expect(screen.getByTestId("permits-panel")).toBeTruthy());
    await waitFor(() => expect(svc.choro).toHaveBeenCalled());
    expect(svc.choro.mock.calls[0][0]).toMatchObject({ mode: "year", year: 2025, metric: "units" });
    await waitFor(() => expect((layerProps.last?.rows as unknown[] | undefined)?.length).toBe(1));
  });
  it("sin datos cargados: avisa en vez de quedar vacía", async () => {
    svc.prov.mockResolvedValue([]);
    mount(["L1"]);
    await waitFor(() => expect(screen.getByTestId("permits-empty").textContent).toContain("Todavía no hay datos"));
    expect(svc.choro).not.toHaveBeenCalled();
  });
  it("error al leer la procedencia: lo muestra", async () => {
    svc.prov.mockRejectedValue(new Error("sin permiso"));
    mount(["L1"]);
    await waitFor(() => expect(screen.getByTestId("permits-empty").textContent).toContain("sin permiso"), { timeout: 5000 });
  });
});
