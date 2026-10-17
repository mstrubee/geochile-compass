/**
 * Parte 4 (front): utilidades, servicio, popups y paneles. Los datos son FIXTURES etiquetadas (no son cifras de los servicios);
 * los casos «reales» (Praderas La Dehesa, CUT de 4 dígitos…) están cubiertos en los tests SQL y del ETL con recortes reales.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { LayerProvenanceRow } from "@/types/permits";
import type { CrfPolygonRow, IneCoverageRow, InePermitPointRow, SeiaProjectRow, SeiaSummaryRow } from "@/types/projects";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import { clusterRadius, coverageWarning, fmtDate, MIN_PRECISION_OPTIONS, roundBounds, safeHttpUrl, WARN } from "@/utils/projectsScale";
import { fetchInePermitPoints, fetchSeiaProjects, inePermitPointsArgs, seiaProjectsArgs } from "@/services/projectsService";
import { CrfPopup, PermitClusterPopup, PermitPointPopup, SeiaPopup } from "@/components/map/ProjectPopups";
import { InePermitPointsPanel } from "@/components/map/InePermitPointsPanel";
import { IneCrfPanel } from "@/components/map/IneCrfPanel";
import { SeiaProjectsPanel } from "@/components/map/SeiaProjectsPanel";

beforeEach(() => rpcMock.mockReset());

const prov = (over: Partial<LayerProvenanceRow> = {}): LayerProvenanceRow => ({
  source_key: "fixture", name: "FIXTURE", publisher: "Publicador de prueba", landing_url: "https://example.test/", attribution: "Atribución de prueba",
  license_label: null, verification_status: "comprobado", scope_note: "Alcance de prueba", access_mode: "automatic", freshness_status: "fresh", check_overdue: false,
  overdue_since: null, last_checked_at: null, snapshot_id: "snap-1", origin_url: "https://example.test/layer/1", sha256: "ab".repeat(32),
  captured_at: "2026-10-17T12:00:00Z", period_start: "2010-01-01", period_end: "2025-12-31", load_from: null, declared_date: "2026-07-30",
  definitive_until: null, quality_note: null, ...over,
});

describe("utilidades", () => {
  it("SEIA: coordenadas de grado entero se avisan como ubicación APROXIMADA y no se mueven", () => {
    const first = render(<SeiaPopup row={{ ...seiaRow, lon: -71, lat: -33, geo_status: 0, review_decision: null }} />);
    expect(screen.getByTestId("popup-seia-coarse").textContent).toContain("APROXIMADA");
    first.unmount();
    render(<SeiaPopup row={{ ...seiaRow, lon: -70.72, lat: -33.8, geo_status: 0, review_decision: null }} />);
    expect(screen.queryByTestId("popup-seia-coarse")).toBeNull();
  });
  it("el radio de un cluster crece con las unidades y está acotado", () => {
    expect(clusterRadius(1)).toBeLessThan(clusterRadius(100));
    expect(clusterRadius(100)).toBeLessThan(clusterRadius(100000));
    expect(clusterRadius(10 ** 9)).toBeLessThanOrEqual(34);
    expect(clusterRadius(0)).toBe(clusterRadius(1));
  });
  it("solo se enlazan URLs http(s)", () => {
    expect(safeHttpUrl("https://seia.sea.gob.cl/x?id=1")).toContain("https://seia.sea.gob.cl/x");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(safeHttpUrl("no es url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
  it("redondea la caja y formatea fechas", () => {
    expect(roundBounds({ west: -70.123456, south: -33.987654, east: -70.0, north: -33.5 })).toEqual({ west: -70.12, south: -33.99, east: -70, north: -33.5 });
    expect(fmtDate("2020-08-10T00:00:00Z")).toBe("10-08-2020");
    expect(fmtDate(null)).toBeNull();
  });
  it("la cobertura se dice con números reales, no con un texto fijo", () => {
    expect(coverageWarning({ comunas: 117, comunas_total: 346 })).toContain("117 de 346");
    expect(coverageWarning(undefined)).toContain("Cobertura parcial");
  });
  it("por defecto se exige precisión moderada o mejor", () => {
    expect(MIN_PRECISION_OPTIONS[0].value).toBe(2);
  });
});

describe("servicio", () => {
  const b = { west: -71, south: -34, east: -70, north: -33 };
  it("mapea filtros a la RPC (vacío = null, zoom redondeado)", () => {
    expect(inePermitPointsArgs(b, 12.6, { years: [2024], uso: null, minPrecision: 2 })).toMatchObject({
      p_west: -71, p_north: -33, p_zoom: 13, p_years: [2024], p_uso: null, p_min_precision: 2, p_limit: 3000 });
    expect(inePermitPointsArgs(b, 5, { years: [], uso: [], minPrecision: 0 })).toMatchObject({ p_years: null, p_uso: null, p_min_precision: 0 });
    expect(seiaProjectsArgs(b, { states: ["Aprobado"], forms: null, yearFrom: 2015, yearTo: null })).toMatchObject({
      p_states: ["Aprobado"], p_forms: null, p_year_from: 2015, p_year_to: null });
  });
  it("un error de la RPC se propaga (no se confunde con «sin datos»)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchInePermitPoints(b, 10, { years: null, uso: null, minPrecision: 2 })).rejects.toThrow("boom");
    await expect(fetchSeiaProjects(b, { states: null, forms: null, yearFrom: null, yearTo: null })).rejects.toThrow("boom");
  });
  it("sin filas devuelve []", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(fetchInePermitPoints(b, 10, { years: null, uso: null, minPrecision: 2 })).resolves.toEqual([]);
  });
});

const point: InePermitPointRow = { kind: "point", lon: -70.6, lat: -33.4, n_points: 1, units: 12, area_m2: 840, src_oid: 5, comuna_cut: "13101", year: 2019, uso: 1,
  glosa: "Edificio de departamentos", floors: 8, geo_precision: 1, geo_status: 2 };
const seiaRow: SeiaProjectRow = { service_layer: 2, expediente_id: 2147600353, name: "Proyecto de prueba", form: "DIA", typology_letter: "h.1", typology_name: "h.1) Proyectos inmobiliarios",
  status_declared: "Aprobado", comunas_declared: "Lo Barnechea", titular: "Titular S.A.", submitted_at: "2020-08-10", qualified_at: "2021-03-08", investment_usd: 59217796,
  expediente_url: "https://seia.sea.gob.cl/expediente/x", lon: -70.72, lat: -33.8, geo_status: 2, geo_distance_m: 21500, review_decision: "propose_correction",
  proposed_lon: -70.5, proposed_lat: -33.35, review_note: "revisión de prueba", snapshot_id: "s", captured_at: "2026-10-17T00:00:00Z" };

describe("popups (dicen qué es y qué no es el dato)", () => {
  it("punto INE: año solamente, sin número de permiso, un punto no es un permiso, ubicación dudosa", () => {
    render(<PermitPointPopup row={point} />);
    const t = screen.getByTestId("popup-permit-point").textContent ?? "";
    expect(t).toContain("año 2019"); expect(t).toContain("Unidades"); expect(t).toContain("12");
    expect(t).toContain(WARN.yearOnly); expect(t).toContain(WARN.noPermitNumber); expect(t).toContain(WARN.recordNotPermit);
    expect(t).toContain("Baja"); expect(t).toContain("Fuera de su comuna declarada");
    expect(t).toContain("unidad no declarada");
  });
  it("cluster: suma de unidades y puntos, y la misma advertencia", () => {
    render(<PermitClusterPopup row={{ ...point, kind: "cluster", units: 3400, n_points: 210 }} />);
    const t = screen.getByTestId("popup-permit-cluster").textContent ?? "";
    expect(t).toContain("3.400"); expect(t).toContain("210"); expect(t).toContain(WARN.recordNotPermit);
  });
  it("CRF: obra terminada, no un permiso; avisa si el polígono se reparó", () => {
    const row: CrfPolygonRow = { src_oid: 1, comuna_cut: "01401", year: 2015, dwellings: 58, geom_status: 1, geojson: "{}" };
    render(<CrfPopup row={row} />);
    const t = screen.getByTestId("popup-crf").textContent ?? "";
    expect(t).toContain("TERMINADA, no un permiso"); expect(t).toContain("reparado"); expect(t).toContain("58");
  });
  it("SEIA: estado, fecha de calificación (no es permiso), inversión declarada, ubicación dudosa con distancia, corrección aparte, enlace seguro", () => {
    render(<SeiaPopup row={seiaRow} />);
    const t = screen.getByTestId("popup-seia").textContent ?? "";
    expect(t).toContain("Aprobado"); expect(t).toContain("Inversión declarada"); expect(t).toContain("US$ 59.217.796");
    expect(t).toContain(WARN.seiaQualified); expect(t).toContain("FUERA de la comuna declarada"); expect(t).toContain("21.500 m");
    expect(t).toContain("no se movió"); expect(t).toContain("PROPUESTA (no oficial)");
    expect(screen.getByRole("link", { name: /Expediente en el SEIA/ }).getAttribute("href")).toBe("https://seia.sea.gob.cl/expediente/x");
  });
  it("SEIA: un enlace javascript: no se renderiza como enlace", () => {
    render(<SeiaPopup row={{ ...seiaRow, expediente_url: "javascript:alert(1)" }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("SEIA: sin inversión dice «no declarada», no 0", () => {
    render(<SeiaPopup row={{ ...seiaRow, investment_usd: null, geo_status: 0, review_decision: null }} />);
    expect(screen.getByTestId("popup-seia").textContent).toContain("no declarada");
    expect(screen.queryByTestId("popup-seia-doubtful")).toBeNull();
  });
});

const coverage: IneCoverageRow[] = [2018, 2019, 2024].map((y, i) => ({ year: y, points: 1000 + i, units: 9000 + i, comunas: 117 + i, comunas_total: 346,
  precision_high: 900, precision_moderate: 50, precision_low: 40 + i, precision_none: 10, outside_declared: 0 }));

describe("panel de permisos georreferenciados", () => {
  const base = { filters: { years: [2024], uso: null, minPrecision: 2 as const }, onFilters: vi.fn(), view: "clusters" as const, onView: vi.fn(), coverage,
    vsMinvu: [{ year: 2024, ine_housing_units: 60000, ine_housing_only_units: 30000, minvu_units_same_comunas: 80000, ratio: 0.75, minvu_national_units: 86000, ine_covered_comunas: 119 }],
    sources: [prov()], provenanceError: null, provenanceLoading: false, loading: false, error: null, offset: 0, zoom: 9 };
  it("las advertencias están siempre visibles y la cobertura usa los números reales", () => {
    render(<InePermitPointsPanel {...base} />);
    const w = screen.getByTestId("projects-warnings").textContent ?? "";
    expect(w).toContain(WARN.yearOnly); expect(w).toContain(WARN.noPermitNumber); expect(w).toContain(WARN.recordNotPermit);
    expect(w).toContain("119 de 346"); expect(w).toContain("excluida: 52 puntos");        // 2024: baja 42 + sin dato 10
  });
  it("licencia por confirmar y fuente verificada/no verificada", () => {
    const { rerender } = render(<InePermitPointsPanel {...base} />);
    expect(screen.getByTestId("license-line").textContent).toContain("por confirmar");
    expect(screen.queryByTestId("badge-unverified")).toBeNull();
    rerender(<InePermitPointsPanel {...base} sources={[prov({ verification_status: "documentado" })]} />);
    expect(screen.getByTestId("badge-unverified")).toBeTruthy();
    rerender(<InePermitPointsPanel {...base} sources={[prov({ freshness_status: "stale", overdue_since: "2026-11-30" })]} />);
    expect(screen.getByTestId("badge-stale").textContent).toContain("30-11-2026");
  });
  it("los filtros notifican: destino, precisión y rango de años", () => {
    const onFilters = vi.fn();
    render(<InePermitPointsPanel {...base} onFilters={onFilters} />);
    fireEvent.click(screen.getByLabelText("No habitacional"));
    expect(onFilters).toHaveBeenLastCalledWith(expect.objectContaining({ uso: [1, 2] }));
    fireEvent.change(screen.getByLabelText("Precisión mínima"), { target: { value: "0" } });
    expect(onFilters).toHaveBeenLastCalledWith(expect.objectContaining({ minPrecision: 0 }));
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2018" } });
    expect(onFilters).toHaveBeenLastCalledWith(expect.objectContaining({ years: [2018, 2019, 2024].filter((y) => y >= 2018 && y <= 2024) }));
  });
  it("el cuadre con MINVU es un diagnóstico explicado, no un error", () => {
    render(<InePermitPointsPanel {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /Cuadre con MINVU/ }));
    const d = screen.getByTestId("permit-points-diag").textContent ?? "";
    expect(d).toContain("0.75"); expect(d).toContain("diagnóstico, no un error"); expect(d).toContain("2019 y 2020");
  });
  it("sin datos cargados lo dice", () => {
    render(<InePermitPointsPanel {...base} sources={[]} coverage={[]} filters={{ years: null, uso: null, minPrecision: 2 }} />);
    expect(screen.getByText(/Todavía no hay datos cargados/)).toBeTruthy();
  });
  it("la ficha de procedencia muestra servicio, huella, captura y licencia", () => {
    render(<InePermitPointsPanel {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver ficha de procedencia/ }));
    const d = within(screen.getByTestId("provenance-dialog"));
    expect(d.getByText("https://example.test/layer/1")).toBeTruthy();
    expect(d.getByText("ab".repeat(32))).toBeTruthy();
    expect(d.getByText(/Por confirmar: el servicio no declara licencia/)).toBeTruthy();
    expect(d.getByText("Qué NO dice esta capa")).toBeTruthy();
  });
  it("un error de procedencia se muestra, no se oculta", () => {
    render(<InePermitPointsPanel {...base} sources={[]} provenanceError="sin permiso" />);
    expect(screen.getByRole("alert").textContent).toContain("sin permiso");
  });
});

describe("panel de recepciones finales", () => {
  const crfCov = [{ year: 2015, polygons: 1500, dwellings: 90000, comunas: 152, comunas_total: 346, repaired: 3 }];
  const base = { years: [2015], onYears: vi.fn(), coverage: crfCov, sources: [prov()], provenanceError: null, provenanceLoading: false, loading: false, error: null, truncated: false, offset: 1, zoom: 9 };
  it("obra terminada, no permiso; cobertura real; polígonos reparados", () => {
    render(<IneCrfPanel {...base} />);
    const w = screen.getByTestId("projects-warnings").textContent ?? "";
    expect(w).toContain("TERMINADA"); expect(w).toContain("152 de 346"); expect(w).toContain("3 polígonos"); expect(w).toContain("Solo hay año de emisión");
    expect(screen.getByTestId("crf-legend").textContent).toContain("zoom ≥ 12");
  });
  it("con zoom alto explica que cada polígono es una obra; avisa si se truncó", () => {
    render(<IneCrfPanel {...base} zoom={14} truncated />);
    expect(screen.getByTestId("crf-legend").textContent).toContain("huella de una obra terminada");
    expect(screen.getByRole("status").textContent).toContain("Hay más polígonos");
  });
  it("se apila a la izquierda según el offset", () => {
    render(<IneCrfPanel {...base} offset={2} />);
    expect(screen.getByTestId("crf-panel").getAttribute("style")).toContain("2 * 19.25rem");
  });
});

describe("panel de proyectos SEIA", () => {
  const summary: SeiaSummaryRow[] = [
    { service_layer: 2, status_declared: "Aprobado", geo_status: 0, projects: 90, investment_usd: 1 },
    { service_layer: 2, status_declared: "Aprobado", geo_status: 2, projects: 6, investment_usd: 1 },
    { service_layer: 2, status_declared: "Desistido", geo_status: 3, projects: 4, investment_usd: 1 },
    { service_layer: 1, status_declared: "En Calificación", geo_status: 0, projects: 2, investment_usd: 1 }];
  const base = { filters: { states: ["Aprobado"], forms: null, yearFrom: null, yearTo: null }, onFilters: vi.fn(), summary, sources: [prov()], provenanceError: null,
    provenanceLoading: false, loading: false, error: null, shown: 96, offset: 0 };
  it("las advertencias del SEIA y la cuenta de ubicaciones dudosas salen de los datos", () => {
    render(<SeiaProjectsPanel {...base} />);
    const w = screen.getByTestId("projects-warnings").textContent ?? "";
    expect(w).toContain(WARN.seiaScope); expect(w).toContain(WARN.seiaQualified); expect(w).toContain(WARN.seiaInvestment); expect(w).toContain(WARN.seiaTypology);
    expect(w).toContain("6 de 96 proyectos tienen ubicación dudosa");           // solo «Aprobado» (Desistido no está elegido)
  });
  it("los estados disponibles vienen de la base y se pueden alternar", () => {
    const onFilters = vi.fn();
    render(<SeiaProjectsPanel {...base} onFilters={onFilters} />);
    expect((screen.getByLabelText("Aprobado") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Desistido") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Desistido"));
    expect(onFilters).toHaveBeenLastCalledWith(expect.objectContaining({ states: ["Aprobado", "Desistido"] }));
    fireEvent.click(screen.getByLabelText("EIA"));
    expect(onFilters).toHaveBeenLastCalledWith(expect.objectContaining({ forms: ["DIA"] }));
  });
  it("un error de lectura se muestra", () => {
    render(<SeiaProjectsPanel {...base} error="falló" />);
    expect(screen.getByRole("alert").textContent).toContain("falló");
  });
});
