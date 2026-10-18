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
import { PCT_APPROX_NOTE, pctIsApprox, pctMid, pctRangeText, penetracionRowsShown, QUESTIONS, WARN_PENETRACION } from "@/utils/previsionScale";
import { FILL_OPACITY, N_SCALE, PCT_SCALE, VIRIDIS_7 } from "@/utils/isapreClasses";

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

describe("utilidades de penetración", () => {
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

  it("el criterio es el texto ya redondeado: si los dos extremos dicen lo mismo con 1 decimal, un solo valor con «≈»; si no, «entre a % y b %»", () => {
    const hualpen = pen("08112", "Hualpén", 4643, 4662, 87731);
    expect(hualpen.pct_lo).toBeCloseTo(5.2921, 3);
    expect(hualpen.pct_hi).toBeCloseTo(5.3138, 3);
    expect(pctRangeText(hualpen.pct_lo, hualpen.pct_hi, hualpen.exact)).toBe("≈ 5,3 %");
    const camarones = pen("15102", "Camarones", 2, 4, 861);
    expect(pctRangeText(camarones.pct_lo, camarones.pct_hi, camarones.exact)).toBe("entre 0,2 % y 0,5 %");
    const vitacura = pen("13132", "Vitacura", 77372, 77372, 86420);
    expect(pctRangeText(vitacura.pct_lo, vitacura.pct_hi, vitacura.exact)).toBe("89,5 %");
    // exacto sin «≈» aunque el decimal sea el mismo; extremos que redondean distinto (5,24 y 5,26) siguen como «entre»
    expect(pctRangeText(5.3, 5.3, true)).toBe("5,3 %");
    expect(pctRangeText(5.24, 5.26, false)).toBe("entre 5,2 % y 5,3 %");
    expect(pctRangeText(5.25, 5.34, false)).toBe("≈ 5,3 %");
    expect(pctIsApprox(5.29, 5.31, false)).toBe(true);
    expect(pctIsApprox(5.29, 5.31, true)).toBe(false);
    expect(pctIsApprox(0.23, 0.46, false)).toBe(false);
    expect(pctIsApprox(null, 5, false)).toBe(false);
    expect(PCT_APPROX_NOTE).toBe("rango publicado menor que 0,1 puntos");
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

  it("Hualpén (4.643–4.662 sobre 87.731): «≈ 5,3 %» con la nota; Camarones (2–4 sobre 861): «entre 0,2 % y 0,5 %» sin nota; Vitacura exacta: «89,5 %»", () => {
    const hualpen = build(comuna("08112", "Hualpén", 4643, 4662), pen("08112", "Hualpén", 4643, 4662, 87731));
    expect(txt(hualpen, "popup-isapre")).toBe("Beneficiarios Isapre: entre 4.643 y 4.662");
    expect(txt(hualpen, "popup-penetracion")).toBe("Penetración: ≈ 5,3 %");
    expect(txt(hualpen, "popup-pct-approx")).toBe("(rango publicado menor que 0,1 puntos)");
    expect(hualpen.textContent).not.toContain("entre 5,3 % y 5,3 %");
    const camarones = build(comuna("15102", "Camarones", 2, 4), pen("15102", "Camarones", 2, 4, 861));
    expect(txt(camarones, "popup-penetracion")).toBe("Penetración: entre 0,2 % y 0,5 %");
    expect(camarones.querySelector('[data-testid="popup-pct-approx"]')).toBeNull();
    expect(camarones.textContent).not.toContain("≈");
    const vitacura = build(comuna("13132", "Vitacura", 77372, 77372), pen("13132", "Vitacura", 77372, 77372, 86420));
    expect(txt(vitacura, "popup-penetracion")).toBe("Penetración: 89,5 %");
    expect(vitacura.querySelector('[data-testid="popup-pct-approx"]')).toBeNull();
    expect(vitacura.textContent).not.toContain("≈");
  });

  it("«≈» y «el rango abarca dos clases» conviven sin contradicción: 4,96–5,04 % se lee «≈ 5,0 %» y cruza «2–5 %» y «5–10 %»", () => {
    const r = pen("90009", "Borde", 4960, 5040, 100000);
    const el = buildIsapreComunaPopup(comuna("90009", "Borde", 4960, 5040), "x", "90009", "f", { row: r, sexoSinInfo: false, sources: SOURCES, metric: "pct" });
    expect(txt(el, "popup-penetracion")).toBe("Penetración: ≈ 5,0 %");
    expect(txt(el, "popup-pct-approx")).toBe("(rango publicado menor que 0,1 puntos)");
    expect(txt(el, "popup-range-classes")).toContain("El rango abarca dos clases (2–5 % y 5–10 %)");
    expect(txt(el, "popup-range-classes")).not.toMatch(/entre|≈/);                                  // la nota habla de clases, no repite el rango
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

  it("Beneficiarios: si el rango publicado cruza clases lo dice la ventana (con y sin el bloque de previsión); con la métrica de penetración, solo la nota de penetración", () => {
    const cruza = comuna("90007", "Cruza", 250, 320);
    const sin = buildIsapreComunaPopup(cruza, "x", "90007", "f");
    expect(sin.querySelector('[data-testid="popup-range-classes"]')?.textContent).toContain("El rango abarca dos clases (100 – <300 y 300 – <1.000)");
    const con = buildIsapreComunaPopup(cruza, "x", "90007", "f", { row: pen("90007", "Cruza", 250, 320, 100000), sexoSinInfo: false, sources: SOURCES, metric: "n" });
    expect(con.querySelector('[data-testid="popup-range-classes"]')?.textContent).toContain("100 – <300 y 300 – <1.000");
    const pct = buildIsapreComunaPopup(cruza, "x", "90007", "f", { row: pen("90007", "Cruza", 250, 320, 100000), sexoSinInfo: false, sources: SOURCES, metric: "pct" });
    expect(pct.querySelector('[data-testid="popup-range-classes"]')).toBeNull();                     // 0,25–0,32 %: una sola clase de penetración
    const unaClase = buildIsapreComunaPopup(comuna("90008", "Una", 120, 140), "x", "90008", "f");
    expect(unaClase.querySelector('[data-testid="popup-range-classes"]')).toBeNull();
  });

  it("sin el parámetro de penetración el popup es el de antes (beneficiarios y advertencias, sin bloque)", () => {
    const el = buildIsapreComunaPopup(comuna("90001", "A", 10, 10), "x", "90001", "f");
    expect(el.textContent).toContain("Beneficiarios Isapre: 10");
    expect(el.querySelector('[data-testid="popup-prevision-title"]')).toBeNull();
  });
});

const baseProps = () => ({
  layer: { client_ready: false, client_ready_note: "Pendiente." }, filters: DEFAULT_ISAPRE_FILTERS, onFilters: vi.fn(), rows: [] as IsapreComunaRow[], loading: false, error: null,
  resumen: undefined, resumenError: null, sinAlta: undefined, sinAltaError: null, sinAltaLoading: false, sinAltaDef: "hospital" as const, onSinAltaDef: vi.fn(), sources: [], provenanceError: null,
  provenanceLoading: false, offset: 0, metric: "pct" as const, onMetric: vi.fn(), penRows: [] as IsaprePenetracionRow[], penShown: [] as IsaprePenetracionRow[], penLoading: false, penError: null,
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

  it("con penetración: una fila por clase con su color, rango y número de comunas, más «Sin dato»; el Fonasa pendiente sin cifra", () => {
    const rows = [pen("90001", "A", 5, 5, 100), pen("90002", "B", 40, 40, 100), pen("90003", "C", null, null, 100), pen("90004", "D", 0, 0, 100)];
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} />);
    const r = [...screen.getByTestId("isapre-class-legend").querySelectorAll('[data-testid="isapre-legend-row"]')];
    expect(r.map((e) => e.getAttribute("data-kind"))).toEqual(["zero", "class", "class", "class", "class", "class", "class", "class", "nodata"]);
    expect(r.map((e) => e.querySelector("span.flex-1")?.textContent)).toEqual(["0 % (cero publicado)", ...PCT_SCALE.labels, "Sin dato"]);
    expect(r.map((e) => e.getAttribute("data-count"))).toEqual(["1", "0", "0", "1", "0", "0", "1", "0", "1"]);   // 0 · 0–2 · 2–5 · 5–10 · 10–20 · 20–35 · 35–50 · ≥50 · sin dato (40 % cae en 40–60 %)
    expect(r.map((e) => e.getAttribute("data-color"))).toEqual(["#d6cfc4", ...VIRIDIS_7, "#9ca3af"]);
    expect(screen.getByTestId("isapre-fonasa-pending").textContent).toBe("Fonasa: pendiente (fase C)");
  });

  it("con valores justo en 40 y 60: 40 en «40–60 %», 60 en «≥ 60 %», y la leyenda los cuenta ahí", () => {
    const rows = [pen("90001", "A", 39.9, 39.9, 100), pen("90002", "B", 40, 40, 100), pen("90003", "C", 59.9, 59.9, 100), pen("90004", "D", 60, 60, 100)];
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} />);
    const r = [...screen.getByTestId("isapre-class-legend").querySelectorAll('[data-testid="isapre-legend-row"]')];
    expect(r.map((e) => e.querySelector("span.flex-1")?.textContent).slice(4, 8)).toEqual(["20–40 %", "40–60 %", "≥ 60 %", "Sin dato"]);
    expect(r.map((e) => e.getAttribute("data-count")).slice(4, 8)).toEqual(["1", "2", "1", "0"]);
  });

  it("las clases vacías se muestran igual, con 0 comunas; sin penetración que mostrar siguen las 7 filas", () => {
    render(<IsapreChoroplethPanel {...baseProps()} penRows={[]} penShown={[]} />);
    const r = [...screen.getByTestId("isapre-class-legend").querySelectorAll('[data-testid="isapre-legend-row"]')];
    expect(r).toHaveLength(8);                                                                       // 7 clases + Sin dato (el 0 solo si hay comunas con 0)
    expect(r.slice(0, 7).every((e) => e.getAttribute("data-count") === "0")).toBe(true);
    expect(r[7].getAttribute("data-count")).toBe("");                                                // total de comunas desconocido: sin cifra inventada
  });

  it("comunas sobre 100 %: se listan con su valor y la advertencia de que no se recorta", () => {
    const rows = [pen("90001", "Antártica", 5, 5, 4), pen("90002", "B", 1, 1, 100)];
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} />);
    const t = screen.getByTestId("isapre-over100").textContent ?? "";
    expect(t).toContain("1 comuna supera 100 %");
    expect(t).toContain("Antártica: 125,0 %");
    expect(t).toContain("No se recorta a 100 %");
    expect(t).toContain("Puede reflejar diferencias de definición territorial o de fecha entre las dos fuentes, o el efecto de poblaciones muy pequeñas; la causa no está comprobada.");
    expect(t).not.toMatch(/no (es|un) error|señala/i);
  });

  it("comunas sobre 100 % con rango casi exacto: «≈» y la nota, en el mismo criterio", () => {
    const rows = [pen("90001", "Casi", 12496, 12504, 10000)];                                       // 124,96–125,04 % → «≈ 125,0 %»
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} />);
    const t = screen.getByTestId("isapre-over100").textContent ?? "";
    expect(t).toContain("Casi: ≈ 125,0 % (rango publicado menor que 0,1 puntos)");
    expect(t).not.toContain("entre 125,0 % y 125,0 %");
  });

  it("advertencias de la métrica: método, asimetría, fechas distintas, comuna no declarada [NO COMPROBADO], sin Fonasa ni «resto»", () => {
    const rows = [pen("90001", "A", 5, 5, 100)];
    render(<IsapreChoroplethPanel {...baseProps()} penRows={rows} penShown={rows} />);
    const w = screen.getByTestId("projects-warnings").textContent ?? "";
    for (const k of ["población censada 2024 (INE) del mismo sexo", "EXCLUYE la edad sin información e INCLUYE el sexo sin información", "diciembre de 2025", "[NO COMPROBADO]", "no hay «resto» ni «sin previsión»", "Sexo sin información", "clases fijas (0–2 %, 2–5 %, 5–10 %, 10–20 %, 20–40 %, 40–60 % y ≥ 60 %)"]) expect(w).toContain(k);
    expect(w).not.toContain("percentil 95");
    expect(w).not.toMatch(/porque|se debe a|debido a|causa(da)? por/i);
    expect(Object.values(WARN_PENETRACION).join(" ")).not.toMatch(/porque|se debe a|debido a|causa(da)? por/i);
  });

  it("con métrica de beneficiarios no aparece la leyenda de penetración", () => {
    render(<IsapreChoroplethPanel {...baseProps()} metric="n" />);
    expect(screen.getAllByTestId("isapre-legend-row").some((e) => e.querySelector("span.flex-1")?.textContent === "< 100")).toBe(true);   // leyenda de Beneficiarios, no la de Penetración
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

  it("Beneficiarios: la leyenda cuenta las comunas de cada clase con los mismos cortes de la capa y «Sin dato» sale del total", () => {
    const rows = [comuna("90001", "A", 0, 0), comuna("90002", "B", 50, 50), comuna("90003", "C", 100, 100), comuna("90004", "D", 5000, 6000), comuna("90005", "E", 220000, 221000)];
    const total = [...rows.map((r) => pen(r.cut, r.name, r.n_lo, r.n_hi, 1000)), pen("90006", "F", null, null, 1000), pen("90007", "G", null, null, 1000)];
    render(<IsapreChoroplethPanel {...baseProps()} metric="n" rows={rows} penRows={total} penShown={total} />);
    const r = [...screen.getByTestId("isapre-class-legend").querySelectorAll('[data-testid="isapre-legend-row"]')];
    expect(r.map((e) => e.getAttribute("data-kind"))).toEqual(["zero", "class", "class", "class", "class", "class", "class", "class", "nodata"]);
    expect(r.map((e) => e.getAttribute("data-count"))).toEqual(["1", "1", "1", "0", "0", "1", "0", "1", "2"]);    // 0 · <100 · 100–300 · … · 3.000–10.000 · … · ≥30.000 · sin dato (7 − 5)
    expect(r.map((e) => e.querySelector("span.flex-1")?.textContent)).toEqual(["0 (cero publicado)", ...N_SCALE.labels, "Sin dato"]);
    expect(r.slice(1, 8).map((e) => e.getAttribute("data-color"))).toEqual([...VIRIDIS_7]);
    expect(r[0].querySelector("span[data-fill-opacity]")?.getAttribute("data-fill-opacity")).toBe("0.7");
  });

  it("la leyenda queda ANTES de lo demás (nivel y sello, 1b-1, fuentes) y justo después de los filtros: se ve sin hacer scroll", () => {
    render(<IsapreChoroplethPanel {...baseProps()} />);
    const order = (a: string, b: string) => !!(screen.getByTestId(a).compareDocumentPosition(screen.getByTestId(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order("isapre-filters", "isapre-legend")).toBe(true);
    expect(order("isapre-legend", "prevision-level-seal")).toBe(true);
    expect(order("isapre-legend", "isapre-sin-alta")).toBe(true);
    expect(order("isapre-legend", "projects-source")).toBe(true);
    expect(order("health-not-client-ready", "isapre-filters")).toBe(true);
  });

  it("el aviso naranja de «no apta para clientes» es colapsable y está ABIERTO por defecto", () => {
    render(<IsapreChoroplethPanel {...baseProps()} />);
    const d = screen.getByTestId("health-not-client-ready") as HTMLDetailsElement;
    expect(d.tagName).toBe("DETAILS");
    expect(d.open).toBe(true);
    expect(d.querySelector("summary")?.textContent).toBe("Capa no apta para clientes");
    expect(d.textContent).toContain("Pendiente.");
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

  it("la métrica «Penetración» pasa a la capa los datos y las fuentes, y la leyenda trae una fila por clase", async () => {
    svc.pen.mockResolvedValue(PEN);
    svc.resumen.mockResolvedValue([{ snapshot_id: "i1", period_start: "2025-12-01", period_end: "2025-12-31", declared_date: "2026-01-28", extraction_date: "2026-01-22", suppress_below: 5, cells: 1, zeros_published: 0, suppressed_primary: 0, suppressed_complementary: 0, groups: 1, groups_total_suppressed: 0 }]);
    svc.prov.mockImplementation(async (d: string) => (d === "poblacion_censo2024" ? [{ source_key: "ine_censo2024_poblacion_comunal", name: "Censo", publisher: "INE", landing_url: null, attribution: null, license_label: "CC BY-SA 4.0", verification_status: "comprobado", scope_note: "", access_mode: "manual", freshness_status: "fresh", check_overdue: false, overdue_since: null, last_checked_at: null, snapshot_id: "c1", origin_url: null, sha256: null, captured_at: "2026-10-18T00:00:00Z", period_start: "2024-01-01", period_end: "2024-12-31", load_from: null, declared_date: "2025-03-27", definitive_until: null, quality_note: null }] : []));
    mount();
    await waitFor(() => expect(got.layer?.penRows).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Métrica"), { target: { value: "pct" } });
    await waitFor(() => expect(got.layer?.metric).toBe("pct"));
    expect((got.layer?.penShown as unknown[]).length).toBe(3);
    await waitFor(() => expect((got.layer?.sources as PenetracionSources).censo.declared_date).toBe("2025-03-27"));
    expect(got.layer?.sources).toEqual({ isapre: { period_end: "2025-12-31", declared_date: "2026-01-28" }, censo: { period_end: "2024-12-31", declared_date: "2025-03-27" } });
    expect(screen.getByTestId("isapre-class-legend").querySelectorAll('[data-testid="isapre-legend-row"]').length).toBeGreaterThanOrEqual(8);
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

describe("capa en el mapa: clases discretas viridis, relleno 0,7, borde visible, gris punteado sin dato", () => {
  const feat = (c: string) => ({ type: "Feature", properties: { codigo_comuna: c }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  const setup = async (metric: "n" | "pct") => {
    geo.value = { ready: true, nombresPorCodigo: { "90001": "A", "90002": "B", "90003": "C", "90004": "D", "90005": "E", "90006": "F", "90007": "G" }, fc: { type: "FeatureCollection", features: ["90001", "90002", "90003", "90004", "90005", "90006", "90007"].map(feat) } };
    gj.props = null;
    svc.comuna.mockResolvedValue([comuna("90001", "A", 0, 0), comuna("90002", "B", 50, 50), comuna("90004", "D", 2999, 3000), comuna("90005", "E", 30000, 30000)]);
    svc.pen.mockResolvedValue([pen("90001", "A", 0, 0, 100), pen("90002", "B", 50, 50, 100), pen("90003", "C", null, null, 100), pen("90004", "D", 5, 5, 4), pen("90005", "E", 3, 3, 100), pen("90006", "F", 40, 40, 100), pen("90007", "G", 60, 60, 100)]);
    mount();
    await waitFor(() => expect(got.layer?.penShown).toHaveLength(7));
    await waitFor(() => expect(got.layer?.rows).toHaveLength(4));
    if (metric === "pct") {
      fireEvent.change(screen.getByLabelText("Métrica"), { target: { value: "pct" } });
      await waitFor(() => expect(got.layer?.metric).toBe("pct"));
    }
  };
  const style = (c: string) => gj.props!.style(feat(c));

  it("Penetración: cada comuna con el color de su clase, relleno 0,7; el 0, su color propio; sin dato, gris punteado", async () => {
    await setup("pct");
    expect(style("90001")).toMatchObject({ fillColor: "#d6cfc4", fillOpacity: 0.7 });        // 0 % publicado
    expect(style("90005")).toMatchObject({ fillColor: VIRIDIS_7[1], fillOpacity: 0.7 });      // 3 % → «2–5 %»
    expect(style("90002")).toMatchObject({ fillColor: VIRIDIS_7[5], fillOpacity: 0.7 });      // 50 % → «40–60 %»
    expect(style("90004")).toMatchObject({ fillColor: VIRIDIS_7[6], fillOpacity: 0.7 });      // 125 %: sin recorte, última clase
    expect(style("90006")).toMatchObject({ fillColor: VIRIDIS_7[5], fillOpacity: 0.7 });      // 40 % cae en la clase SUPERIOR «40–60 %» (no en «20–40 %»)
    expect(style("90007")).toMatchObject({ fillColor: VIRIDIS_7[6], fillOpacity: 0.7 });      // 60 % cae en la clase SUPERIOR «≥ 60 %» (no en «40–60 %»)
    expect(style("90003")).toMatchObject({ fillColor: "#9ca3af", fillOpacity: 0.4, dashArray: "3 3" });
    expect(style("90001").dashArray).toBeUndefined();
    expect(style("99999")).toMatchObject({ fillColor: "#9ca3af", dashArray: "3 3" });         // comuna que no figura: sin dato
    expect(FILL_OPACITY).toBe(0.7);
  });

  it("Beneficiarios: mismas clases viridis; 2.999–3.000 (punto medio 2.999,5) en «1.000 – <3.000» y 30.000 en «≥ 30.000»", async () => {
    await setup("n");
    expect(style("90001")).toMatchObject({ fillColor: "#d6cfc4", fillOpacity: 0.7 });        // 0
    expect(style("90002")).toMatchObject({ fillColor: VIRIDIS_7[0], fillOpacity: 0.7 });      // 50 → «< 100»
    expect(style("90004")).toMatchObject({ fillColor: VIRIDIS_7[3], fillOpacity: 0.7 });
    expect(style("90005")).toMatchObject({ fillColor: VIRIDIS_7[6], fillOpacity: 0.7 });
    expect(style("90003")).toMatchObject({ fillColor: "#9ca3af", fillOpacity: 0.4, dashArray: "3 3" });
  });

  it("el borde de comuna es explícito y visible (no una variable CSS dentro de un atributo SVG)", async () => {
    await setup("n");
    const st = style("90002") as { color: string; weight: number };
    expect(st.color).toBe("#6b7280");
    expect(st.weight).toBeGreaterThanOrEqual(0.8);
  });

  it("la ventana de cada comuna trae el bloque «Previsión de salud» con ambas fuentes, también con la métrica de beneficiarios", async () => {
    await setup("n");
    await waitFor(() => expect((got.layer?.sources as PenetracionSources | undefined)?.censo.period_end).toBe("2024-12-31"));
    const bound: Array<() => HTMLElement> = [];
    gj.props!.onEachFeature(feat("90002"), { bindPopup: (f: () => HTMLElement) => bound.push(f), on: () => undefined });
    const el = bound[0]();
    expect(el.querySelector('[data-testid="popup-penetracion"]')?.textContent).toBe("Penetración: 50,0 %");
    expect(el.querySelector('[data-testid="popup-poblacion"]')?.textContent).toBe("Población censada 2024 (INE): 100");
    expect(el.querySelector('[data-testid="popup-fonasa"]')?.textContent).toBe("Fonasa: pendiente (fase C)");
    expect(el.querySelector('[data-testid="popup-seal"]')?.textContent).toBe("Sello: Oficial con advertencia");
  });

  it("un rango que cruza clases lo dice la ventana (la de la escala de la métrica activa); uno que cae en una sola, no", async () => {
    await setup("pct");
    const popup = (c: string) => { const b: Array<() => HTMLElement> = []; gj.props!.onEachFeature(feat(c), { bindPopup: (f: () => HTMLElement) => b.push(f), on: () => undefined }); return b[0](); };
    expect(popup("90004").querySelector('[data-testid="popup-range-classes"]')).toBeNull();     // 125 % exacto
    // 1–4 %: cruza «0–2 %» y «2–5 %»
    const ranged = buildIsapreComunaPopup(comuna("90004", "D", 1, 4), "D", "90004", "f", { row: pen("90004", "D", 1, 4, 100), sexoSinInfo: false, sources: SOURCES, metric: "pct" });
    expect(ranged.querySelector('[data-testid="popup-range-classes"]')?.textContent).toContain("El rango abarca dos clases (0–2 % y 2–5 %)");
  });
});
