/** ProyectosHost dentro de un MapContainer real (jsdom). Los datasets son simulados: aquí se prueba el ANFITRIÓN, no el SEIA. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
vi.mock("@/services/seiaService", () => ({
  fetchSeiaProjects: vi.fn(), fetchSeiaFacets: vi.fn(), fetchSeiaProject: vi.fn(), fetchSeiaProvenance: vi.fn(),
}));   // el registro importa el dataset del SEIA, que llegaría al cliente real de Supabase (exige variables de entorno)

import { ProyectosHost } from "@/components/map/ProyectosHost";
import { ProyectosPanelPortal } from "@/components/map/proyectos/dock";
import { buildRegistry } from "@/components/map/proyectos/registry";
import type { ProyectosDatasetProps } from "@/components/map/proyectos/types";
import type { ThematicLayerRow } from "@/types/permits";

const L = (id: string, dataset: string, renderer: ThematicLayerRow["renderer"] = "points_projects"): ThematicLayerRow =>
  ({ layer_id: id, renderer, dataset, default_params: null });

const Panel = ({ title }: { title: string }) => (
  <ProyectosPanelPortal><div data-testid={`panel-${title}`}>{title}</div></ProyectosPanelPortal>
);
const A = ({ layer }: ProyectosDatasetProps) => <Panel title={`A:${layer.layer_id}`} />;
const B = ({ layer }: ProyectosDatasetProps) => <Panel title={`B:${layer.layer_id}`} />;
const Boom = () => { throw new Error("se rompió"); };

const reg = (...ds: [string, React.ComponentType<ProyectosDatasetProps>][]) =>
  buildRegistry(Object.fromEntries(ds.map(([name, Layer], i) => [`./datasets/${i}.tsx`, { default: { dataset: name, Layer } }])));

const mount = (thematic: ThematicLayerRow[], visible: string[], registry = reg(["a", A], ["b", B])) =>
  render(
    <MapContainer center={[-33, -70]} zoom={5} style={{ height: 300, width: 300 }}>
      <ProyectosHost thematic={thematic} visibleLayerIds={new Set(visible)} registry={registry} />
    </MapContainer>,
  );

describe("ProyectosHost", () => {
  it("sin capas encendidas no monta nada (ni el dock)", () => {
    mount([L("1", "a")], []);
    expect(screen.queryByTestId("proyectos-dock")).toBeNull();
    expect(screen.queryByTestId("panel-A:1")).toBeNull();
  });
  it("ignora las capas que no son de puntos (p. ej. la coroplética de permisos)", () => {
    mount([L("1", "a", "choropleth_comuna")], ["1"]);
    expect(screen.queryByTestId("proyectos-dock")).toBeNull();
  });
  it("una capa encendida monta el componente de SU dataset dentro del dock del mapa", async () => {
    mount([L("1", "a"), L("2", "b")], ["1"]);
    const panel = await screen.findByTestId("panel-A:1");
    expect(screen.getByTestId("proyectos-dock").contains(panel)).toBe(true);
    expect(screen.queryByTestId("panel-B:2")).toBeNull();                    // la capa 2 está apagada
  });
  it("dos datasets encendidos a la vez se APILAN en el mismo dock (no se superponen)", async () => {
    mount([L("1", "a"), L("2", "b")], ["1", "2"]);
    const a = await screen.findByTestId("panel-A:1");
    const b = await screen.findByTestId("panel-B:2");
    const dock = screen.getByTestId("proyectos-dock");
    expect(dock.contains(a) && dock.contains(b)).toBe(true);
    expect(dock.className).toMatch(/flex-col/);
  });
  it("un dataset NUEVO se agrega con solo registrarlo: el anfitrión no cambia", async () => {
    const Ine = () => <Panel title="INE" />;
    mount([L("9", "ine_permits")], ["9"], reg(["ine_permits", Ine]));
    expect(await screen.findByTestId("panel-INE")).toBeTruthy();
  });
  it("un dataset sin componente muestra un aviso (no queda 'encendido' y mudo) y deja un warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount([L("1", "no_existe")], ["1"]);
    expect((await screen.findByTestId("proyectos-notice")).textContent).toMatch(/no_existe/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no_existe"));
    warn.mockRestore();
  });
  it("un dataset que falla al dibujarse NO tumba el mapa ni a los demás", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mount([L("1", "boom"), L("2", "a")], ["1", "2"], reg(["boom", Boom], ["a", A]));
    expect((await screen.findByTestId("proyectos-notice")).textContent).toMatch(/se rompió/);
    expect(await screen.findByTestId("panel-A:2")).toBeTruthy();             // el otro sigue vivo
    err.mockRestore();
  });
});
