/**
 * Permisos de edificación (front). Los datos de abajo son FIXTURES ETIQUETADAS como tales (no son cifras de MINVU):
 * sirven para probar la lógica de períodos, escala, servicio y panel. Los valores reales se verifican en el ETL
 * (etl/permisos/tests, con archivos MINVU reales recortados).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LayerProvenanceRow, PermitChoroplethRow, PermitSelection } from "@/types/permits";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock, from: fromMock } }));

import { availableYears, defaultSelection, monthRange, monthsOfYear, normalizeSelection } from "@/utils/permitsPeriods";
import { classify, formatPermitValue, legendEntries, NO_DATA_COLOR, periodLabel, quantileBreaks, ZERO_COLOR } from "@/utils/permitsScale";
import { choroplethArgs, fetchPermitChoropleth, fetchThematicLayers } from "@/services/permitsService";
import { PermitsPanel } from "@/components/map/PermitsPanel";

const prov = (over: Partial<LayerProvenanceRow>): LayerProvenanceRow => ({
  source_key: "x", name: "FIXTURE", publisher: "Publicador de prueba", landing_url: "https://example.test/", attribution: "Atribución de prueba",
  license_label: null, verification_status: "comprobado", scope_note: null, access_mode: "manual", freshness_status: "fresh", check_overdue: false,
  overdue_since: null, last_checked_at: null, snapshot_id: "s", origin_url: "https://example.test/f.xlsx", sha256: "00", captured_at: "2026-10-16T12:00:00Z",
  period_start: null, period_end: null, load_from: null, declared_date: "2026-09-11", definitive_until: 2024, quality_note: "2025 en adelante es preliminar", ...over,
});
const ANNUAL = prov({ source_key: "minvu_cedoc_permisos_anual", period_start: "2002-01-01", period_end: "2026-07-31", load_from: "2002-01-01" });
const MONTHLY = prov({ source_key: "minvu_cedoc_permisos_mensual", period_start: "2021-08-01", period_end: "2026-07-31", load_from: "2021-08-01" });

const SEL: PermitSelection = { mode: "year", year: 2025, month: null, metric: "units", display: "value", destination: "housing_total" };

beforeEach(() => { rpcMock.mockReset(); fromMock.mockReset(); });

describe("períodos elegibles (derivados de lo publicado)", () => {
  it("el año en curso (parcial) no es elegible en modo año", () => {
    const ys = availableYears(ANNUAL);
    expect(ys[0]).toBe(2002);
    expect(ys[ys.length - 1]).toBe(2025);
    expect(ys).not.toContain(2026);
  });
  it("un archivo que cierra en diciembre incluye ese año", () => {
    expect(availableYears({ ...ANNUAL, period_end: "2025-12-31" }).at(-1)).toBe(2025);
  });
  it("meses del año en curso llegan hasta el último publicado; ytd exige enero cargado", () => {
    const r = monthRange(MONTHLY);
    expect(monthsOfYear(r, 2026, "month")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(monthsOfYear(r, 2021, "month")[0]).toBe(8);
    expect(monthsOfYear(r, 2021, "ytd")).toEqual([]);
    expect(monthsOfYear(r, 2019, "month")).toEqual([]);
  });
  it("selección por defecto = último año completo; normalizar corrige un año no disponible", () => {
    expect(defaultSelection([ANNUAL, MONTHLY])).toMatchObject({ mode: "year", year: 2025 });
    expect(normalizeSelection({ ...SEL, year: 2030 }, [ANNUAL, MONTHLY]).year).toBe(2025);
    expect(normalizeSelection({ ...SEL, mode: "month", year: 2026, month: 12 }, [ANNUAL, MONTHLY])).toMatchObject({ year: 2026, month: 7 });
  });
  it("sin nada cargado no hay selección", () => {
    expect(defaultSelection([])).toBeNull();
  });
});

describe("escala y leyenda", () => {
  it("null es 'sin dato' (gris), 0 es un valor real distinto", () => {
    expect(classify(null, "value", [10, 20]).color).toBe(NO_DATA_COLOR);
    expect(classify(0, "value", [10, 20])).toMatchObject({ kind: "zero", color: ZERO_COLOR });
    expect(classify(null, "yoy", [])).toMatchObject({ kind: "nodata" });
  });
  it("cuantiles ignoran los 0 y no repiten cortes", () => {
    expect(quantileBreaks([0, 0, 0])).toEqual([]);
    const b = quantileBreaks([1, 1, 1, 1, 1, 50, 60, 70, 80, 90]);
    expect(new Set(b).size).toBe(b.length);
  });
  it("la leyenda siempre incluye 'Sin dato (no es 0)'", () => {
    expect(legendEntries("value", "units", [5, 10, 20, 40]).some((e) => e.kind === "nodata" && e.label.includes("no es 0"))).toBe(true);
    expect(legendEntries("yoy", "units", []).some((e) => e.kind === "nodata")).toBe(true);
  });
  it("formatos y etiqueta de período", () => {
    expect(formatPermitValue(null, "units", "value")).toBe("sin dato");
    expect(formatPermitValue(null, "units", "yoy")).toBe("no calculable");
    expect(formatPermitValue(12.34, "units", "yoy")).toContain("+12,3");
    expect(periodLabel({ mode: "ytd", year: 2026, month: 7 })).toBe("ene–jul 2026");
  });
});

describe("servicio", () => {
  it("el modo decide la fuente y los parámetros de la RPC", () => {
    expect(choroplethArgs(SEL)).toMatchObject({ p_source_key: "minvu_cedoc_permisos_anual", p_granularity: "year", p_month: null });
    expect(choroplethArgs({ ...SEL, mode: "ytd", year: 2026, month: 7 })).toMatchObject({ p_source_key: "minvu_cedoc_permisos_mensual", p_granularity: "ytd", p_month: 7 });
  });
  it("un error de la RPC se propaga (no se muestra como 'sin datos')", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchPermitChoropleth(SEL)).rejects.toThrow("boom");
  });
  it("sin tabla thematic_layers (migración pendiente) devuelve [] sin lanzar", async () => {
    fromMock.mockReturnValue({ select: () => Promise.resolve({ data: null, error: { message: "relation does not exist" } }) });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(fetchThematicLayers()).resolves.toEqual([]);
  });
});

describe("PermitsPanel", () => {
  const rows: PermitChoroplethRow[] = [
    { comuna_cut: "01101", comuna_name: "A", value: 10, prev_value: 8, yoy_pct: 25, coverage_ok: true, is_provisional: true, snapshot_ids: null },
    { comuna_cut: "01107", comuna_name: "B", value: null, prev_value: null, yoy_pct: null, coverage_ok: false, is_provisional: null, snapshot_ids: null },
  ];
  const renderPanel = (provenance: LayerProvenanceRow[] | undefined, selection = SEL, onChange = vi.fn()) =>
    render(<PermitsPanel selection={selection} onChange={onChange} provenance={provenance} provenanceError={null} loading={false} error={null} rows={rows} breaks={[5, 10]} missingPolygons={["12202"]} />);

  it("muestra fuente, último período, fechas y calidad preliminar", () => {
    renderPanel([ANNUAL, MONTHLY]);
    const src = screen.getByTestId("permits-source");
    expect(src.textContent).toContain("Publicador de prueba");
    expect(src.textContent).toContain("31-07-2026");     // último período publicado
    expect(src.textContent).toContain("16-10-2026");     // capturado
    expect(src.textContent).toContain("11-09-2026");     // fecha declarada por el origen
    expect(screen.getByTestId("permits-quality-note").textContent).toContain("desde 2025");
    expect(screen.queryByTestId("badge-unverified")).toBeNull();
  });
  it("una fuente no verificada se marca como tal", () => {
    renderPanel([{ ...ANNUAL, verification_status: "documentado" }]);
    expect(screen.getByTestId("badge-unverified")).toBeTruthy();
  });
  it("una fuente atrasada muestra la alerta de frescura", () => {
    renderPanel([{ ...ANNUAL, freshness_status: "stale", overdue_since: "2026-11-30" }]);
    expect(screen.getByTestId("badge-stale").textContent).toContain("30-11-2026");
  });
  it("la leyenda explica 'sin dato', cuenta las comunas sin dato y lista polígonos faltantes", () => {
    renderPanel([ANNUAL, MONTHLY]);
    expect(screen.getByTestId("permits-legend").textContent).toContain("Sin dato (no es 0)");
    expect(screen.getByText(/1 comuna\(s\) sin dato/)).toBeTruthy();
    expect(screen.getByText(/12202/)).toBeTruthy();
  });
  it("el selector de año no ofrece el año parcial", () => {
    renderPanel([ANNUAL, MONTHLY]);
    const opts = Array.from((screen.getByLabelText("Año") as HTMLSelectElement).options).map((o) => o.value);
    expect(opts).toContain("2025");
    expect(opts).not.toContain("2026");
  });
  it("cambiar la métrica a variación interanual notifica la selección", () => {
    const onChange = vi.fn();
    renderPanel([ANNUAL, MONTHLY], SEL, onChange);
    fireEvent.change(screen.getByLabelText("Métrica"), { target: { value: "yoy" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ display: "yoy" }));
  });
  it("sin datos cargados lo dice", async () => {
    renderPanel([prov({ source_key: "minvu_cedoc_permisos_anual", freshness_status: "never_loaded" })]);
    await waitFor(() => expect(screen.getByText(/Todavía no hay datos cargados/)).toBeTruthy());
  });
});
