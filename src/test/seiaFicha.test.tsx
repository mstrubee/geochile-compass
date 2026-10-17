import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const svc = vi.hoisted(() => ({ project: vi.fn() }));
vi.mock("@/services/seiaService", () => ({ fetchSeiaProject: svc.project, fetchSeiaProjects: vi.fn(), fetchSeiaFacets: vi.fn(), fetchSeiaProvenance: vi.fn() }));

import { SeiaFichaDialog } from "@/components/map/proyectos/seia/SeiaFichaDialog";
import { DETAIL } from "./seiaFixtures";

const SEL = { source_key: "seia_proyectos_dia", external_id: "2000000001" };
const mount = (selected: typeof SEL | null = SEL) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SeiaFichaDialog selected={selected} onClose={() => {}} />
    </QueryClientProvider>,
  );
// con llaves: un beforeEach que DEVUELVE una función la usa como limpieza, y devolver el mock lo invocaría al terminar cada test
beforeEach(() => { svc.project.mockReset(); });

describe("SeiaFichaDialog", () => {
  it("cerrada no consulta nada", () => {
    mount(null);
    expect(svc.project).not.toHaveBeenCalled();
  });

  it("muestra los campos y SIEMPRE que no es un permiso y que la inversión es declarada", async () => {
    svc.project.mockResolvedValue(DETAIL());
    mount();
    expect(await screen.findByTestId("ficha-scope")).toHaveTextContent(/no es un permiso de edificación/);
    expect(screen.getByTestId("ficha-scope")).toHaveTextContent(/declarada/);
    expect(svc.project).toHaveBeenCalledWith("seia_proyectos_dia", "2000000001");
    expect(screen.getByText("Proyecto SINTÉTICO 1", { selector: "h2" })).toBeTruthy();
    expect(screen.getByText("Titular SINTÉTICO")).toBeTruthy();
    expect(screen.getByTestId("ficha-investment")).toHaveTextContent("US$ 12.345.678");
    expect(screen.getByText(/15-09-2020/)).toBeTruthy();
    expect(screen.getByText(/15-09-2020/).textContent).toMatch(/no es fecha de permiso/);       // la nota va EN la fila, no solo en el aviso general
  });

  it("h.1 «Proyectos inmobiliarios» avisa que incluye proyectos no residenciales; otras tipologías no", async () => {
    svc.project.mockResolvedValue(DETAIL({ typology_letter: "h.1 " }));
    const { unmount } = mount();
    expect(await screen.findByTestId("ficha-h1-note")).toHaveTextContent(/no residenciales/);
    unmount();
    svc.project.mockResolvedValue(DETAIL({ typology_letter: "g.1" }));
    mount();
    await screen.findByTestId("ficha-scope");
    expect(screen.queryByTestId("ficha-h1-note")).toBeNull();
  });

  it("una inversión faltante dice «no informada», no 0", async () => {
    svc.project.mockResolvedValue(DETAIL({ investment_usd: null }));
    mount();
    expect(await screen.findByTestId("ficha-investment")).toHaveTextContent("no informada");
  });

  it("un punto fuera de su comuna se explica con la distancia y se dice que NO se movió", async () => {
    svc.project.mockResolvedValue(DETAIL({ geo_check_status: "outside_declared", geo_check_distance_m: 41234.6, lat: -33.8 }));
    mount();
    const loc = await screen.findByTestId("ficha-location");
    expect(within(loc).getByRole("alert")).toHaveTextContent(/41\.235 m/);
    expect(within(loc).getByRole("alert")).toHaveTextContent(/no se movió/);
    expect(within(loc).getByRole("alert")).toHaveTextContent(/tolerancia 500 m/);
    expect(loc).toHaveTextContent("-33.80000");
    expect(loc).toHaveTextContent(/punto original del SEA/);
  });

  it("un punto bien ubicado no muestra alerta", async () => {
    svc.project.mockResolvedValue(DETAIL());
    mount();
    expect(within(await screen.findByTestId("ficha-location")).queryByRole("alert")).toBeNull();
  });

  it("sin punto lo dice", async () => {
    svc.project.mockResolvedValue(DETAIL({ lat: null, lon: null, geo_check_status: "no_geometry" }));
    mount();
    expect(await screen.findByTestId("ficha-location")).toHaveTextContent(/no entregó un punto/);
  });

  it("las comunas que no se pudieron identificar se muestran", async () => {
    svc.project.mockResolvedValue(DETAIL({ comunas_declared: "Lo Barnechea, Nada", comunas_unresolved: ["Nada"] }));
    mount();
    expect(await screen.findByTestId("ficha-unresolved")).toHaveTextContent("Nada");
  });

  it("las revisiones humanas se listan con su nota y la ubicación propuesta, aparte del original", async () => {
    svc.project.mockResolvedValue(DETAIL({}, { reviews: [
      { decision: "corrected", note: "Según la dirección del expediente", reviewed_at: "2026-10-17T10:00:00Z", reviewed_by: "u", proposed_lon: -70.52, proposed_lat: -33.35 },
      { decision: "confirmed_error", note: "El punto está mal", reviewed_at: "2026-10-16T10:00:00Z", reviewed_by: "u", proposed_lon: null, proposed_lat: null },
    ] }));
    mount();
    const rev = await screen.findByTestId("ficha-reviews");
    expect(rev).toHaveTextContent("Corrección propuesta");
    expect(rev).toHaveTextContent("Según la dirección del expediente");
    expect(rev).toHaveTextContent("-33.35000, -70.52000".replace(", ", " → ").replace("-33.35000 → -70.52000", "-33.35000, -70.52000"));
    expect(rev).toHaveTextContent("Ubicación confirmada como errónea");
    expect(screen.getByTestId("ficha-location")).toHaveTextContent("-33.35000, -70.50000");     // el original sigue siendo el original
  });

  it("el enlace al expediente: el del servicio si existe; si no, uno CONSTRUIDO y marcado como tal", async () => {
    svc.project.mockResolvedValue(DETAIL({ expediente_url: "https://seia.example/exp/1" }));
    const { unmount } = mount();
    const link = await screen.findByRole("link", { name: /Ver expediente en e-SEIA/ });
    expect(link).toHaveAttribute("href", "https://seia.example/exp/1");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/se construye con el ID/)).toBeNull();
    unmount();
    svc.project.mockResolvedValue(DETAIL({ expediente_url: null }));
    mount();
    expect(await screen.findByText(/se construye con el ID/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ver expediente en e-SEIA/ }).getAttribute("href"))
      .toBe("https://seia.sea.gob.cl/expediente/expediente.php?id_expediente=2000000001");               // patrón real de URL_EXPEDIENTE
  });

  it("procedencia: fecha de captura, atribución y huella; avisa si la fuente no está verificada", async () => {
    svc.project.mockResolvedValue(DETAIL({}, { source: { ...DETAIL().source, verification_status: "documentado" } }));
    mount();
    const src = await screen.findByTestId("ficha-source");
    expect(src).toHaveTextContent("Servicio de Evaluación Ambiental");
    expect(src).toHaveTextContent("16-10-2026");
    expect(src).toHaveTextContent("abcdef012345…");
    expect(src).toHaveTextContent(/el servicio no declara fecha/);
    expect(screen.getByTestId("ficha-unverified")).toBeTruthy();
  });

  it("los atributos originales sin columna propia quedan consultables", async () => {
    svc.project.mockResolvedValue(DETAIL());
    mount();
    const raw = await screen.findByTestId("ficha-raw");
    expect(raw).toHaveTextContent("OBJECTID");
    expect(raw).toHaveTextContent("77");
  });

  it("un expediente que ya no está vigente se dice, no se deja la ficha vacía", async () => {
    svc.project.mockResolvedValue(null);
    mount();
    expect(await screen.findByText(/ya no figura en la carga vigente/)).toBeTruthy();
  });

  it("un error se muestra con su mensaje", async () => {
    svc.project.mockRejectedValue(new Error("sin permiso"));
    mount();
    // el hook reintenta una vez (1 s) antes de rendirse
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent("sin permiso");
  });
});
