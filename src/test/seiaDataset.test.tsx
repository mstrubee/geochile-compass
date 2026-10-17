/**
 * Dataset «Proyectos SEIA» completo (anfitrión + panel + capa + ficha) dentro de un MapContainer real (jsdom), con los servicios
 * simulados. jsdom no tiene canvas: la capa de puntos se simula y se verifica lo que recibe. DATOS SINTÉTICOS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThematicLayerRow } from "@/types/permits";
import type { SeiaFilters, SeiaProjectRow } from "@/types/seia";

const svc = vi.hoisted(() => ({ projects: vi.fn(), facets: vi.fn(), project: vi.fn(), prov: vi.fn() }));
vi.mock("@/services/seiaService", () => ({
  fetchSeiaProjects: svc.projects, fetchSeiaFacets: svc.facets, fetchSeiaProject: svc.project, fetchSeiaProvenance: svc.prov,
}));

const layerProps = vi.hoisted(() => ({ last: null as null | { rows: SeiaProjectRow[]; onSelect: (r: SeiaProjectRow) => void } }));
vi.mock("@/components/map/proyectos/seia/SeiaPointsLayer", () => ({
  SeiaPointsLayer: (p: { rows: SeiaProjectRow[]; onSelect: (r: SeiaProjectRow) => void }) => { layerProps.last = p; return null; },
}));

import { ProyectosHost } from "@/components/map/ProyectosHost";
import { DETAIL, FACETS, PROV, ROW } from "./seiaFixtures";

const LAYER = (params: Record<string, unknown> | null = { source_keys: ["seia_proyectos_eia", "seia_proyectos_dia"], typology: ["g", "h.1"] }): ThematicLayerRow =>
  ({ layer_id: "L1", renderer: "points_projects", dataset: "seia_projects", default_params: params as never });

const mount = (layer: ThematicLayerRow = LAYER(), visible = ["L1"]) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapContainer center={[-33.4, -70.6]} zoom={11} style={{ height: 300, width: 300 }}>
        <ProyectosHost thematic={[layer]} visibleLayerIds={new Set(visible)} />
      </MapContainer>
    </QueryClientProvider>,
  );
};
const lastFilters = (): SeiaFilters => svc.projects.mock.calls.at(-1)![1];

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  layerProps.last = null;
  svc.facets.mockResolvedValue(FACETS);
  svc.prov.mockResolvedValue([PROV("seia_proyectos_dia"), PROV("seia_proyectos_eia")]);
  svc.projects.mockResolvedValue([ROW({ total_matching: 1 })]);
});

describe("Proyectos SEIA", () => {
  it("capa apagada: no consulta nada ni pinta nada", () => {
    mount(LAYER(), []);
    expect(svc.facets).not.toHaveBeenCalled();
    expect(svc.projects).not.toHaveBeenCalled();
    expect(screen.queryByTestId("seia-panel")).toBeNull();
  });

  it("encendida: pide los valores reales, parte con las tipologías por defecto y pide los puntos del recuadro", async () => {
    mount();
    await screen.findByTestId("seia-panel");
    await waitFor(() => expect(svc.projects).toHaveBeenCalled());
    expect(svc.facets).toHaveBeenCalledWith(["seia_proyectos_eia", "seia_proyectos_dia"]);
    expect(lastFilters()).toMatchObject({ typology: ["g.1", "g.2", "h.1"], hideFlagged: false, statuses: null });   // «g» expandido; h.2 y c. fuera
    const bbox = svc.projects.mock.calls[0][0];
    expect(bbox.west).toBeLessThan(bbox.east);
    expect(bbox.south).toBeLessThan(bbox.north);
    await waitFor(() => expect(layerProps.last?.rows).toHaveLength(1));
    expect(await screen.findByTestId("seia-count")).toHaveTextContent("1 proyecto en esta vista");
  });

  it("el panel dice SIEMPRE qué es y qué no es la capa, y muestra la fuente con su captura y frescura", async () => {
    mount();
    expect(await screen.findByTestId("seia-scope-note")).toHaveTextContent(/no es un catastro de edificación/);
    expect(screen.getByTestId("seia-scope-note")).toHaveTextContent(/no es fecha de permiso/);
    expect(screen.getByTestId("seia-scope-note")).toHaveTextContent(/declara el titular/);
    const sources = await screen.findByTestId("seia-sources");
    expect(sources).toHaveTextContent("DIA capturada 16-10-2026");
    expect(sources).toHaveTextContent("EIA");
    expect(sources).toHaveTextContent("Fuente: Servicio de Evaluación Ambiental");
    expect(screen.queryByTestId("seia-unverified")).toBeNull();
  });

  it("avisa si una fuente no está verificada o está atrasada", async () => {
    svc.prov.mockResolvedValue([PROV("seia_proyectos_dia", { verification_status: "documentado", freshness_status: "stale" })]);
    mount();
    expect(await screen.findByTestId("seia-unverified")).toBeTruthy();
    expect(screen.getByTestId("seia-sources")).toHaveTextContent("Atrasada");
  });

  it("si las tipologías por defecto no existen en los datos, muestra TODAS y lo explica (no queda una capa vacía)", async () => {
    mount(LAYER({ typology: ["z.9"] }));
    expect(await screen.findByTestId("seia-notice")).toHaveTextContent(/se muestran todas/);
    expect(screen.getByTestId("seia-notice")).toHaveTextContent(/c, g\.1, g\.2, h\.1, h\.2/);
    await waitFor(() => expect(svc.projects).toHaveBeenCalled());
    expect(lastFilters().typology).toBeNull();
  });

  it("los parámetros de la hoja mal formados no rompen la capa", async () => {
    mount(LAYER({ typology: "h", source_keys: 5 } as never));
    await waitFor(() => expect(svc.projects).toHaveBeenCalled());
    expect(lastFilters().typology).toBeNull();
    expect(svc.facets).toHaveBeenCalledWith(null);
    mount(LAYER(null));
    await waitFor(() => expect(svc.facets).toHaveBeenCalledTimes(2));
  });

  it("vista recortada: se dice cuántos se muestran de cuántos y qué hacer", async () => {
    svc.projects.mockResolvedValue([ROW({ total_matching: 12345 }), ROW({ id: 2, external_id: "2", total_matching: 12345 })]);
    mount();
    const msg = await screen.findByTestId("seia-count");
    expect(msg).toHaveTextContent(/Vista recortada/);
    expect(msg).toHaveTextContent(/2 de mayor inversión declarada de 12\.345/);
    expect(msg).toHaveTextContent(/Acerque el mapa/);
  });

  it("sin resultados con una tipología activa, ofrece mostrar todas y al hacerlo vuelve a consultar sin filtro", async () => {
    svc.projects.mockResolvedValue([]);
    mount();
    const msg = await screen.findByTestId("seia-count");
    expect(msg).toHaveTextContent(/No hay proyectos en esta vista/);
    fireEvent.click(within(msg).getByRole("button", { name: /Mostrar todas las tipologías/ }));
    await waitFor(() => expect(lastFilters().typology).toBeNull());
  });

  it("cambiar un filtro vuelve a consultar con ese filtro", async () => {
    mount();
    await screen.findByTestId("seia-panel");
    await waitFor(() => expect(svc.projects).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Ocultar ubicaciones dudosas"));
    await waitFor(() => expect(lastFilters().hideFlagged).toBe(true));
    expect(screen.getByTestId("seia-active-filters")).toHaveTextContent("Sin ubicaciones dudosas");
    fireEvent.change(screen.getByLabelText("Año desde"), { target: { value: "2021" } });
    await waitFor(() => expect(lastFilters().yearFrom).toBe(2021));
    expect(screen.getByText(/un proyecto sin fecha no aparece/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Estado Aprobado"));
    await waitFor(() => expect(lastFilters().statuses).toEqual(["Aprobado"]));
  });

  it("la tipología: marcar suma códigos exactos, desmarcar el último vuelve a «todas» (nunca «ninguna»)", async () => {
    mount();
    await screen.findByTestId("seia-panel");
    await waitFor(() => expect(svc.projects).toHaveBeenCalled());
    expect((screen.getByLabelText("Tipología h.2") as HTMLInputElement).checked).toBe(false);          // el industrial NO está activo por defecto
    expect((screen.getByLabelText("Tipología h.1") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Tipología h.2"));
    await waitFor(() => expect(lastFilters().typology).toEqual(["g.1", "g.2", "h.1", "h.2"]));
    fireEvent.click(screen.getByLabelText("Tipología h.2"));
    fireEvent.click(screen.getByLabelText("Tipología g.1"));
    fireEvent.click(screen.getByLabelText("Tipología g.2"));
    fireEvent.click(screen.getByLabelText("Tipología h.1"));
    await waitFor(() => expect(lastFilters().typology).toBeNull());
    expect((screen.getByLabelText("Todas las tipologías") as HTMLInputElement).checked).toBe(true);
  });

  it("un código con varios nombres (g.1) se muestra una vez y avisa de los demás; «c.» se lista como «c»", async () => {
    mount();
    await screen.findByTestId("seia-panel");
    const g1 = screen.getByLabelText("Tipología g.1").closest("label")!;
    expect(g1).toHaveTextContent("g.1) Conjuntos habitacionales SINTÉTICO (30)");
    expect(g1).toHaveTextContent("y 1 nombre más");
    expect(screen.getByLabelText("Tipología c")).toBeTruthy();
  });

  it("el panel advierte que «inmobiliario» no es vivienda", async () => {
    mount();
    expect(await screen.findByTestId("seia-scope-note")).toHaveTextContent(/h\.1\) incluye proyectos no residenciales/);
  });

  it("la fuente EIA/DIA se puede acotar y volver a todas", async () => {
    mount();
    await screen.findByTestId("seia-panel");
    fireEvent.click(await screen.findByLabelText("EIA"));
    await waitFor(() => expect(lastFilters().sourceKeys).toEqual(["seia_proyectos_dia"]));
    fireEvent.click(screen.getByLabelText("EIA"));
    await waitFor(() => expect(lastFilters().sourceKeys).toBeNull());
  });

  it("la leyenda explica cómo se ven las ubicaciones dudosas y cuántas hay", async () => {
    mount();
    const legend = await screen.findByTestId("seia-legend");
    expect(legend).toHaveTextContent("Fuera de su comuna declarada: ubicación dudosa · 4 en toda la base");
    expect(legend).toHaveTextContent("Comuna no identificada");
    expect(legend).toHaveTextContent(/una ubicación dudosa se marca, no se corrige/);
    expect(legend).toHaveTextContent("2 proyectos no traen punto");
  });

  it("sin datos cargados lo dice", async () => {
    svc.facets.mockResolvedValue({ ...FACETS, total: 0, with_point: 0, by_source: {}, typologies: [], statuses: [], geo_status: {}, year_min: null, year_max: null });
    mount();
    expect(await screen.findByText(/Todavía no hay proyectos del SEIA cargados/)).toBeTruthy();
  });

  it("un error de la base se muestra con su mensaje", async () => {
    svc.projects.mockRejectedValue(new Error("permission denied"));
    mount();
    expect(await screen.findByText(/No se pudieron leer los proyectos: permission denied/, {}, { timeout: 4000 })).toBeTruthy();
  });

  it("si no se pueden leer los valores de los datos, el panel lo dice en vez de quedarse en «Cargando»", async () => {
    svc.facets.mockRejectedValue(new Error("rpc caída"));
    mount();
    expect(await screen.findByText(/No se pudo leer el resumen de los datos: rpc caída/, {}, { timeout: 4000 })).toBeTruthy();
    expect(svc.projects).not.toHaveBeenCalled();                              // sin filtros iniciales no se consulta a ciegas
  });

  it("hacer clic en un punto abre la ficha de ESE expediente", async () => {
    svc.project.mockResolvedValue(DETAIL({ external_id: "2000000042", name: "El proyecto elegido" }));
    mount();
    await waitFor(() => expect(layerProps.last?.rows).toHaveLength(1));
    act(() => layerProps.last!.onSelect(ROW({ source_key: "seia_proyectos_eia", external_id: "2000000042" })));
    expect(await screen.findByText("El proyecto elegido", { selector: "h2" })).toBeTruthy();
    expect(svc.project).toHaveBeenCalledWith("seia_proyectos_eia", "2000000042");
    expect(screen.getByTestId("ficha-scope")).toHaveTextContent(/no es un permiso de edificación/);
  });
});
