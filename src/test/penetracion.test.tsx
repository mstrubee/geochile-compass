/**
 * Salud, Fase 1b-2 (front): penetración Isapre = beneficiarios (solo lo publicado) / población censada 2024. Datos FIXTURE sintéticos (CUT 9xxxx / valores inventados):
 * las cifras reales de producción van en HALLAZGOS_FASE1B y en el informe del PR.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThematicLayerRow } from "@/types/permits";
import { DEFAULT_ISAPRE_FILTERS, METRIC_LABEL, type IsapreComunaRow, type IsaprePenetracionRow } from "@/types/prevision";

const svc = vi.hoisted(() => ({ comuna: vi.fn(), resumen: vi.fn(), sinAlta: vi.fn(), casen: vi.fn(), prov: vi.fn(), pen: vi.fn() }));
vi.mock("@/services/previsionService", () => ({ fetchIsapreComuna: svc.comuna, fetchIsapreResumen: svc.resumen, fetchIsapreSinAlta: svc.sinAlta, fetchCasenRegion: svc.casen, fetchIsaprePenetracion: svc.pen }));
vi.mock("@/services/permitsService", () => ({ fetchLayerProvenance: svc.prov }));
const geo = vi.hoisted(() => ({ value: { ready: false, fc: null as unknown, nombresPorCodigo: {} as Record<string, string> } }));
vi.mock("@/hooks/useComunasGeoIndex", () => ({ useComunasGeoIndex: () => geo.value }));
const got = vi.hoisted(() => ({ layer: null as null | Record<string, unknown> }));
// Se ve la capa real, pero react-leaflet.GeoJSON se sustituye para capturar `style` y `onEachFeature` (jsdom no dibuja vectores SVG).
const gj = vi.hoisted(() => ({ props: null as null | { style: (f: unknown) => Record<string, unknown>; onEachFeature: (f: unknown, l: unknown) => void } }));
vi.mock("react-leaflet", async (orig) => {
  const real = await orig<typeof import("react-leaflet")>();
  return { ...real, GeoJSON: (p: never) => { gj.props = p; return null; } };
});
vi.mock("@/components/map/IsapreChoroplethLayer", async (orig) => {
  const real = await orig<typeof import("@/components/map/IsapreChoroplethLayer")>();
  return { IsapreChoroplethLayer: (p: Record<string, unknown>) => { got.layer = p; return real.IsapreChoroplethLayer(p as never); } };
});

import { PrevisionHost } from "@/components/map/PrevisionHost";
import { IsapreChoroplethPanel } from "@/components/map/PrevisionPanels";
import { buildIsapreComunaPopup, type PenetracionSources } from "@/utils/previsionPopup";
import { PCT_BLUE, PCT_FILL_OPACITY, PCT_WHITE, pctColor, pctDomain, pctMid, pctRangeText, penetracionRowsShown, QUESTIONS, WARN_PENETRACION } from "@/utils/previsionScale";

const pen = (cut: string, name: string, lo: number | null, hi: number | null, poblacion: number | null, over: Partial<IsaprePenetracionRow> = {}): IsaprePenetracionRow => ({
  cut, name, region_cut: cut.slice(0, 2), n_lo: lo, n_hi: hi, exact: lo == null || hi == null ? null : lo === hi, poblacion,
  pct_lo: lo != null && poblacion ? (100 * lo) / poblacion : null, pct_hi: hi != null && poblacion ? (100 * hi) / poblacion : null,
  isapre_snapshot_id: "i1", isapre_period_end: "2025-12-31", censo_snapshot_id: "c1", censo_period_end: "2024-12-31", ...over,
});
const comuna = (cut: string, name: string, lo: number, hi: number): IsapreComunaRow =>
  ({ cut, name, region_cut: cut.slice(0, 2), n_lo: lo, n_hi: hi, exact: lo === hi, suppressed_cells: lo === hi ? 0 : 2, snapshot_id: "i1", period_end: "2025-12-31" });
const SOURCES: PenetracionSources = { isapre: { period_end: "2025-12-31", declared_date: "2026-01-28" }, censo: { period_end: "2024-12-31", declared_date: "2025-03-27" } };

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  svc.prov.mockResolvedValue([]); svc.resumen.mockResolvedValue([]); svc.sinAlta.mockResolvedValue([]); svc.casen.mockResolvedValue([]); svc.pen.mockResolvedValue([]);
  svc.comuna.mockResolvedValue([]);
  geo.value = { ready: false, fc: null, nombresPorCodigo: {} };
  got.layer = null;
});

describe("escala de penetración: degradado continuo de blanco a azul profundo", () => {
  it("0 % es blanco, el tope es el azul profundo, y por encima del tope no pasa del azul", () => {
    expect(pctColor(0, 20)).toBe("rgb(255, 255, 255)");
    expect(pctColor(20, 20)).toBe(`rgb(${PCT_BLUE.join(", ")})`);
    expect(pctColor(95, 20)).toBe(pctColor(20, 20));
    expect(pctColor(-3, 20)).toBe(pctColor(0, 20));
    expect(PCT_WHITE).toEqual([255, 255, 255]);
  });

  it("es CONTINUO: 200 valores distintos dan colores distintos y cada canal baja de forma monótona (no hay clases)", () => {
    const cols = Array.from({ length: 201 }, (_, i) => pctColor((i / 200) * 20, 20));
    expect(new Set(cols).size).toBeGreaterThan(150);
    const red = cols.map((c) => Number(/rgb\((\d+)/.exec(c)![1]));
    expect(red.every((v, i) => i === 0 || v <= red[i - 1])).toBe(true);
    expect(pctColor(10, 20)).toBe("rgb(132, 152, 181)");   // mitad exacta entre blanco y azul profundo
  });

  it("el relleno es 0,5", () => expect(PCT_FILL_OPACITY).toBe(0.5));

  it("dominio: de 0 al percentil 95 de los puntos medios, y el máximo publicado se informa aparte", () => {
    const rows = [...Array.from({ length: 19 }, (_, i) => pen(`9${String(i).padStart(4, "0")}`, `C${i}`, i + 1, i + 1, 100)), pen("99999", "Extrema", 90, 90, 100)];
    const d = pctDomain(rows)!;
    expect(d.maxPublished).toBe(90);
    expect(d.capped).toBe(true);
    expect(d.max).toBeGreaterThanOrEqual(19);
    expect(d.max).toBeLessThan(25);                       // el valor extremo (90 %) no aplana al resto
    expect(pctDomain([pen("90001", "A", 5, 5, 100)])).toEqual({ max: 5, maxPublished: 5, capped: false });
    expect(pctDomain([pen("90001", "A", 0, 0, 100)])!.max).toBe(1);   // todo en 0: dominio mínimo válido
    expect(pctDomain([])).toBeNull();
    expect(pctDomain([pen("90001", "A", null, null, 100)])).toBeNull();
  });

  it("el color sale del PUNTO MEDIO del rango", () => {
    const r = pen("90001", "A", 10, 30, 100);
    expect(pctMid(r)).toBe(20);
    expect(pctMid(pen("90002", "B", null, null, 100))).toBeNull();
  });

  it("texto: exacto, «entre a % y b %», cero y sin dato; nunca recorta a 100 %", () => {
    expect(pctRangeText(21.8, 21.8, true)).toBe("21,8 %");
    expect(pctRangeText(8.87, 20.69, false)).toBe("entre 8,9 % y 20,7 %");
    expect(pctRangeText(0, 0, true)).toBe("0,0 %");
    expect(pctRangeText(null, null)).toBe("sin dato");
    expect(pctRangeText(125, 125, true)).toBe("125,0 %");
  });

  it("el filtro «sin alta» muestra solo las comunas permitidas", () => {
    const rows = [pen("90001", "A", 1, 1, 10), pen("90002", "B", 2, 2, 10)];
    expect(penetracionRowsShown(rows, new Set(["90002"])).map((r) => r.cut)).toEqual(["90002"]);
    expect(penetracionRowsShown(rows, null)).toHaveLength(2);
  });
});

describe("ventana de la comuna: bloque «Previsión de salud»", () => {
  const txt = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
  const build = (ir: IsapreComunaRow | undefined, p: IsaprePenetracionRow | undefined, si = false) =>
    buildIsapreComunaPopup(ir, "x", "90001", "Todas las edades · ambos sexos", { row: p, sexoSinInfo: si, sources: SOURCES });

  it("exacta: beneficiarios, Población censada 2024 (INE) y penetración, con Fonasa pendiente SIN cifra y el sello", () => {
    const el = build(comuna("90001", "Exacta", 250, 250), pen("90001", "Exacta", 250, 250, 1000));
    expect(txt(el, "popup-prevision-title")).toBe("Previsión de salud");
    expect(txt(el, "popup-isapre")).toBe("Beneficiarios Isapre: 250");
    expect(txt(el, "popup-poblacion")).toBe("Población censada 2024 (INE): 1.000");
    expect(txt(el, "popup-penetracion")).toBe("Penetración: 25,0 %");
    expect(txt(el, "popup-fonasa")).toBe("Fonasa: pendiente (fase C)");
    expect(txt(el, "popup-fonasa")).not.toMatch(/[0-9%]/);
    expect(txt(el, "popup-seal")).toBe("Sello: Oficial con advertencia");
    expect(txt(el, "popup-fuentes")).toContain("Superintendencia de Salud");
    expect(txt(el, "popup-fuentes")).toContain("período hasta 2025-12-31; publicación 2026-01-28");
    expect(txt(el, "popup-fuentes")).toContain("INE, Censo 2024 (período hasta 2024-12-31; publicación 2025-03-27)");
    expect(el.querySelector('[data-testid="popup-over100"]')).toBeNull();
  });

  it("rango: «entre a y b» beneficiarios y «entre a % y b %»", () => {
    const el = build(comuna("90002", "Rango", 100, 140), pen("90002", "Rango", 100, 140, 1000));
    expect(txt(el, "popup-isapre")).toBe("Beneficiarios Isapre: entre 100 y 140");
    expect(txt(el, "popup-penetracion")).toBe("Penetración: entre 10,0 % y 14,0 %");
  });

  it("sin población censada o sin fila Isapre: «sin dato», jamás una cifra de respaldo ni 0", () => {
    const sinPob = build(comuna("90003", "SinPob", 5, 5), pen("90003", "SinPob", 5, 5, null));
    expect(txt(sinPob, "popup-poblacion")).toBe("Población censada 2024 (INE): sin dato");
    expect(txt(sinPob, "popup-penetracion")).toBe("Penetración: sin dato");
    const sinFila = build(undefined, pen("90004", "SinFila", null, null, 800));
    expect(txt(sinFila, "popup-isapre")).toContain("sin dato");
    expect(txt(sinFila, "popup-poblacion")).toBe("Población censada 2024 (INE): 800");
    expect(txt(sinFila, "popup-penetracion")).toBe("Penetración: sin dato");
    const sinNada = build(undefined, undefined);
    expect(txt(sinNada, "popup-poblacion")).toContain("sin dato");
    expect(txt(sinNada, "popup-penetracion")).toBe("Penetración: sin dato");
  });

  it("población 0 para el filtro: la penetración es «sin dato» (no 0 %)", () => {
    const el = build(comuna("90005", "Cero", 0, 0), pen("90005", "Cero", 0, 0, 0));
    expect(txt(el, "popup-poblacion")).toBe("Población censada 2024 (INE): 0");
    expect(txt(el, "popup-penetracion")).toBe("Penetración: sin dato");
  });

  it("sobre 100 %: se muestra tal cual y con la advertencia, sin afirmar una causa", () => {
    const el = build(comuna("90006", "Sobre", 5, 5), pen("90006", "Sobre", 5, 5, 4));
    expect(txt(el, "popup-penetracion")).toBe("Penetración: 125,0 %");
    expect(txt(el, "popup-over100")).toContain("Supera 100 %");
    expect(txt(el, "popup-over100")).toContain("[NO COMPROBADO]");
    expect(txt(el, "popup-over100")).toContain("la causa no está comprobada");
    expect(txt(el, "popup-over100")).toContain("poblaciones muy pequeñas");
    expect(txt(el, "popup-over100")).not.toMatch(/no (es|un) error|se debe a|debido a|porque|causa(da)? por/i);
  });

  it("sexo sin información: no hay penetración ni población (el Censo no tiene ese grupo)", () => {
    const el = build(comuna("90001", "A", 3, 3), undefined, true);
    expect(txt(el, "popup-poblacion")).toContain("sin dato");
    expect(txt(el, "popup-poblacion")).toContain("el Censo no tiene");
    expect(txt(el, "popup-penetracion")).toBe("Penetración: sin dato");
  });

  it("sin el parámetro de penetración el popup es el de antes (beneficiarios y advertencias, sin bloque)", () => {
    const el = buildIsapreComunaPopup(comuna("90001", "A", 10, 10), "x", "90001", "f");
    expect(el.textContent).toContain("Beneficiarios Isapre: 10");
    expect(el.querySelector('[data-testid="popup-prevision-title"]')).toBeNull();
  });
});

const baseProps = () => ({
  layer: { client_ready: false, client_ready_note: "Pendiente." }, filters: DEFAULT_ISAPRE_FILTERS, onFilters: vi.fn(), rows: [] as IsapreComunaRow[], breaks: [] as number[], loading: false, error: null,
  resumen: undefined, resumenError: null, sinAlta: undefined, sinAltaError: null, sinAltaLoading: false, sinAltaDef: "hospital" as const, onSinAltaDef: vi.fn(), sources: [], provenanceError: null,
  provenanceLoading: false, offset: 0, metric: "pct" as const, onMetric: vi.fn(), penRows: [] as IsaprePenetracionRow[], penShown: [] as IsaprePenetracionRow[], domain: null, penLoading: false, penError: null,
});

describe("panel con métrica «Penetración»", () => {
  it("selector de métrica con las dos opciones y el texto exacto de la nueva", () => {
    render(<IsapreChoroplethPanel {...baseProps()} metric="n" />);
    const select = screen.getByLabelText("Métrica") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Beneficiarios (n.º)", "Penetración (% de la población censada 2024)"]);
    expect(METRIC_LABEL.pct).toBe("Penetración (% de la población censada 2024)");
    fireEvent.change(select, { target: { value: "pct" } });
    expect(baseProps().onMetric).not.toBe(undefined);
  });

  it("con penetración: leyenda con los extremos del dominio (0 % y «≥ tope»), nota del percentil 95 y «Sin dato» gris punteado", () => {
    const rows = [pen("90001", "A", 5, 5, 100), pen("90002", "B", 40, 40, 100), pen("90003", "C", null, null, 100)];
    const domain = { max: 30, maxPublished: 40, capped: true };
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} domain={domain} />);
    expect(screen.getByTestId("isapre-pct-min").textContent).toBe("0 %");
    expect(screen.getByTestId("isapre-pct-max").textContent).toBe("≥ 30,0 %");
    expect(screen.getByTestId("isapre-pct-cap").textContent).toContain("percentil 95");
    expect(screen.getByTestId("isapre-pct-cap").textContent).toContain("40,0 %");
    expect(screen.getByTestId("isapre-pct-legend").querySelector("[data-fill-opacity]")?.getAttribute("data-fill-opacity")).toBe("0.5");
    expect(screen.getByTestId("isapre-legend").textContent).toContain("Sin dato");
    expect(screen.getByTestId("isapre-fonasa-pending").textContent).toBe("Fonasa: pendiente (fase C)");
  });

  it("sin tope aplicado, el extremo no lleva «≥»", () => {
    const rows = [pen("90001", "A", 5, 5, 100)];
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} domain={{ max: 5, maxPublished: 5, capped: false }} />);
    expect(screen.getByTestId("isapre-pct-max").textContent).toBe("5,0 %");
    expect(screen.queryByTestId("isapre-pct-cap")).toBeNull();
  });

  it("comunas sobre 100 %: se listan con su valor y la advertencia de que no se recorta", () => {
    const rows = [pen("90001", "Antártica", 5, 5, 4), pen("90002", "B", 1, 1, 100)];
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} domain={{ max: 1, maxPublished: 125, capped: true }} />);
    const t = screen.getByTestId("isapre-over100").textContent ?? "";
    expect(t).toContain("1 comuna supera 100 %");
    expect(t).toContain("Antártica: 125,0 %");
    expect(t).toContain("No se recorta a 100 %");
    expect(t).toContain("Puede reflejar diferencias de definición territorial o de fecha entre las dos fuentes, o el efecto de poblaciones muy pequeñas; la causa no está comprobada.");
    expect(t).not.toMatch(/no (es|un) error|señala/i);
  });

  it("advertencias de la métrica: método, asimetría, fechas distintas, comuna no declarada [NO COMPROBADO], sin Fonasa ni «resto»", () => {
    const rows = [pen("90001", "A", 5, 5, 100)];
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} domain={{ max: 5, maxPublished: 5, capped: false }} />);
    const w = screen.getByTestId("projects-warnings").textContent ?? "";
    for (const k of ["población censada 2024 (INE) del mismo sexo", "EXCLUYE la edad sin información e INCLUYE el sexo sin información", "diciembre de 2025", "[NO COMPROBADO]", "no hay «resto» ni «sin previsión»", "Sexo sin información"]) expect(w).toContain(k);
    expect(w).not.toMatch(/porque|se debe a|debido a|causa(da)? por/i);
    expect(Object.values(WARN_PENETRACION).map((v) => (typeof v === "function" ? v(20, 40) : v)).join(" ")).not.toMatch(/porque|se debe a|debido a|causa(da)? por/i);
  });

  it("con métrica de beneficiarios no aparece la leyenda de penetración", () => {
    render(<IsapreChoroplethPanel {...baseProps()} metric="n" />);
    expect(screen.queryByTestId("isapre-pct-legend")).toBeNull();
    expect(screen.getByTestId("isapre-fonasa-pending")).toBeTruthy();
  });

  it("sexo «sin información»: la opción se deshabilita con la penetración y se explica", () => {
    render(<IsapreChoroplethPanel {...baseProps()} />);
    const opt = [...(screen.getByLabelText("Sexo") as HTMLSelectElement).options].find((o) => o.value === "SI")!;
    expect(opt.disabled).toBe(true);
    expect(opt.textContent).toContain("el Censo no tiene ese grupo");
  });

  it("error de la RPC de penetración: se muestra, no se disfraza de «sin dato»", () => {
    render(<IsapreChoroplethPanel {...baseProps()} penError="permission denied" />);
    expect(screen.getByTestId("isapre-legend").textContent).toContain("No se pudo leer la penetración: permission denied");
  });

  it("1b-2 figura construida, con nivel y sello", () => {
    expect(QUESTIONS.find((q) => q.id === "1b-2")).toMatchObject({ state: "construida", level: "Respondida con rigor", seal: "Oficial con advertencia" });
    render(<IsapreChoroplethPanel {...baseProps()} />);
    expect(screen.getByTestId("question-1b-2").textContent).toContain("penetración");
  });
});

const T = (layer_id: string, renderer: ThematicLayerRow["renderer"], dataset: string): ThematicLayerRow =>
  ({ layer_id, renderer, dataset, default_params: null, client_ready: false, client_ready_note: "Pendiente." }) as ThematicLayerRow;
const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapContainer center={[-33, -70]} zoom={5} style={{ height: 300, width: 300 }}>
        <PrevisionHost thematic={[T("IS", "choropleth_isapre", "isapre_cartera")]} visibleLayerIds={new Set(["IS"])} />
      </MapContainer>
    </QueryClientProvider>,
  );
};
const PEN = [pen("90001", "A", 10, 10, 100), pen("90002", "B", 20, 30, 100), pen("90003", "C", null, null, 100)];

describe("PrevisionHost con la penetración", () => {
  it("pide la penetración SOLO con sexo (F/M/ambos) y edad (0 o 12): sin el filtro «sin alta» y sin 'SI'", async () => {
    svc.pen.mockResolvedValue(PEN);
    mount();
    await waitFor(() => expect(svc.pen).toHaveBeenCalledTimes(1));
    expect(svc.pen.mock.calls[0][0]).toEqual({ sexo: null, minTramo: 0 });
    fireEvent.change(screen.getByLabelText("Edad"), { target: { value: "12" } });
    await waitFor(() => expect(svc.pen.mock.calls.at(-1)?.[0]).toEqual({ sexo: null, minTramo: 12 }));
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "F" } });
    await waitFor(() => expect(svc.pen.mock.calls.at(-1)?.[0]).toEqual({ sexo: "F", minTramo: 12 }));
    fireEvent.change(screen.getByLabelText("Solo comunas sin alta complejidad"), { target: { value: "hospital" } });
    await waitFor(() => expect(svc.comuna.mock.calls.at(-1)?.[0]).toMatchObject({ sinAlta: "hospital" }));
    expect(svc.pen.mock.calls.every((c) => !("sinAlta" in c[0]) && c[0].sexo !== "SI")).toBe(true);
  });

  it("la métrica «Penetración» pasa a la capa los datos, el dominio y las fuentes; «sin dato» no entra al dominio", async () => {
    svc.pen.mockResolvedValue(PEN);
    svc.resumen.mockResolvedValue([{ snapshot_id: "i1", period_start: "2025-12-01", period_end: "2025-12-31", declared_date: "2026-01-28", extraction_date: "2026-01-22", suppress_below: 5, cells: 1, zeros_published: 0, suppressed_primary: 0, suppressed_complementary: 0, groups: 1, groups_total_suppressed: 0 }]);
    svc.prov.mockImplementation(async (d: string) => (d === "poblacion_censo2024" ? [{ source_key: "ine_censo2024_poblacion_comunal", name: "Censo", publisher: "INE", landing_url: null, attribution: null, license_label: "CC BY-SA 4.0", verification_status: "comprobado", scope_note: "", access_mode: "manual", freshness_status: "fresh", check_overdue: false, overdue_since: null, last_checked_at: null, snapshot_id: "c1", origin_url: null, sha256: null, captured_at: "2026-10-18T00:00:00Z", period_start: "2024-01-01", period_end: "2024-12-31", load_from: null, declared_date: "2025-03-27", definitive_until: null, quality_note: null }] : []));
    mount();
    await waitFor(() => expect(got.layer?.penRows).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Métrica"), { target: { value: "pct" } });
    await waitFor(() => expect(got.layer?.metric).toBe("pct"));
    expect((got.layer?.penShown as unknown[]).length).toBe(3);
    expect(got.layer?.domain).toMatchObject({ maxPublished: 25 });
    await waitFor(() => expect((got.layer?.sources as PenetracionSources).censo.declared_date).toBe("2025-03-27"));
    expect(got.layer?.sources).toEqual({ isapre: { period_end: "2025-12-31", declared_date: "2026-01-28" }, censo: { period_end: "2024-12-31", declared_date: "2025-03-27" } });
    expect(screen.getByTestId("isapre-pct-legend")).toBeTruthy();
  });

  it("con el filtro «sin alta» solo se pintan las comunas de ese conjunto", async () => {
    svc.pen.mockResolvedValue(PEN);
    svc.comuna.mockImplementation(async (f: { sinAlta: string | null }) => (f.sinAlta ? [comuna("90002", "B", 20, 30)] : [comuna("90001", "A", 10, 10), comuna("90002", "B", 20, 30)]));
    mount();
    await waitFor(() => expect(got.layer?.penRows).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Solo comunas sin alta complejidad"), { target: { value: "hospital" } });
    await waitFor(() => expect((got.layer?.penShown as IsaprePenetracionRow[]).map((r) => r.cut)).toEqual(["90002"]));
  });

  it("al pasar a «Penetración» con sexo «sin información» se vuelve a «Ambos» y no se consulta con 'SI'", async () => {
    svc.pen.mockResolvedValue(PEN);
    mount();
    await waitFor(() => expect(svc.pen).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "SI" } });
    await waitFor(() => expect(svc.comuna.mock.calls.at(-1)?.[0]).toMatchObject({ sexo: "SI" }));
    expect(svc.pen.mock.calls.every((c) => c[0].sexo !== "SI")).toBe(true);
    fireEvent.change(screen.getByLabelText("Métrica"), { target: { value: "pct" } });
    await waitFor(() => expect((screen.getByLabelText("Sexo") as HTMLSelectElement).value).toBe(""));
    expect(svc.pen.mock.calls.every((c) => c[0].sexo !== "SI")).toBe(true);
  });

  it("si la RPC de penetración falla muestra el motivo; el mapa de beneficiarios sigue", async () => {
    svc.pen.mockRejectedValue(new Error("42883 function does not exist"));
    svc.comuna.mockResolvedValue([comuna("90001", "A", 10, 10)]);
    mount();
    fireEvent.change(screen.getByLabelText("Métrica"), { target: { value: "pct" } });
    await waitFor(() => expect(screen.getByTestId("isapre-legend").textContent).toContain("42883 function does not exist"), { timeout: 5000 });
    expect((got.layer?.rows as unknown[]).length).toBe(1);
  });
});

describe("capa en el mapa: relleno al 50 %, gris punteado sin dato", () => {
  const feat = (c: string) => ({ type: "Feature", properties: { codigo_comuna: c }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  const setup = async () => {
    geo.value = { ready: true, nombresPorCodigo: { "90001": "A", "90002": "B", "90003": "C", "90004": "D" }, fc: { type: "FeatureCollection", features: ["90001", "90002", "90003", "90004"].map(feat) } };
    gj.props = null;
    svc.comuna.mockResolvedValue([comuna("90001", "A", 0, 0), comuna("90002", "B", 50, 50)]);
    svc.pen.mockResolvedValue([pen("90001", "A", 0, 0, 100), pen("90002", "B", 50, 50, 100), pen("90003", "C", null, null, 100), pen("90004", "D", 5, 5, 4)]);
    mount();
    await waitFor(() => expect(got.layer?.penShown).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Métrica"), { target: { value: "pct" } });
    await waitFor(() => expect(got.layer?.metric).toBe("pct"));
  };

  it("cada comuna con su color continuo al 50 %, y sin dato en gris punteado", async () => {
    await setup();
    const max = (got.layer?.domain as { max: number }).max;
    const style = (c: string) => gj.props!.style(feat(c));
    expect(style("90001")).toMatchObject({ fillColor: "rgb(255, 255, 255)", fillOpacity: 0.5 });
    expect(style("90002")).toMatchObject({ fillColor: pctColor(Math.min(50, max), max), fillOpacity: 0.5 });
    expect(style("90003")).toMatchObject({ fillColor: "#9ca3af", fillOpacity: 0.4, dashArray: "3 3" });
    expect(style("90003").dashArray).toBe("3 3");
    expect(style("90001").dashArray).toBeUndefined();
    expect(style("99999")).toMatchObject({ fillColor: "#9ca3af", dashArray: "3 3" });         // comuna que no figura: sin dato
  });

  it("una comuna sobre 100 % se pinta con el azul del tope, sin recorte del dato", async () => {
    await setup();
    const max = (got.layer?.domain as { max: number }).max;
    expect(gj.props!.style(feat("90004"))).toMatchObject({ fillColor: pctColor(125, max), fillOpacity: 0.5 });
    expect(pctColor(125, max)).toBe(`rgb(${PCT_BLUE.join(", ")})`);
  });

  it("la ventana de cada comuna trae el bloque «Previsión de salud» con ambas fuentes, también con la métrica de beneficiarios", async () => {
    await setup();
    await waitFor(() => expect((got.layer?.sources as PenetracionSources | undefined)?.censo.period_end).toBe("2024-12-31"));
    const bound: Array<() => HTMLElement> = [];
    gj.props!.onEachFeature(feat("90002"), { bindPopup: (f: () => HTMLElement) => bound.push(f), on: () => undefined });
    const el = bound[0]();
    expect(el.querySelector('[data-testid="popup-penetracion"]')?.textContent).toBe("Penetración: 50,0 %");
    expect(el.querySelector('[data-testid="popup-poblacion"]')?.textContent).toBe("Población censada 2024 (INE): 100");
    expect(el.querySelector('[data-testid="popup-fonasa"]')?.textContent).toBe("Fonasa: pendiente (fase C)");
    expect(el.querySelector('[data-testid="popup-seal"]')?.textContent).toBe("Sello: Oficial con advertencia");
  });
});
