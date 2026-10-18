/**
 * Salud, Fase 1b (front): utilidades, servicio, popup y paneles de previsión. Datos FIXTURE sintéticos (CUT 9xxxx / valores inventados), no cifras de los archivos reales.
 * Las cifras reales (116.128 en 1b-1, 67 de 96 estimaciones publicables…) se verifican con los archivos reales en HALLAZGOS_FASE1B y en las pruebas SQL/ETL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LayerProvenanceRow } from "@/types/permits";
import type { CasenRegionRow, IsapreComunaRow, IsapreResumenRow, IsapreSinAltaRow } from "@/types/prevision";
import { DEFAULT_ISAPRE_FILTERS } from "@/types/prevision";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock, from: vi.fn() } }));

import { fetchCasenRegion, fetchIsapreComuna, fetchIsapreResumen, fetchIsapreSinAlta, isapreComunaArgs } from "@/services/previsionService";
import {
  casenByRegion, casenCounts, casenRangeText, countInexact, isapreFilterLabel, midpoint, QUESTIONS, QUESTION_STATE_TEXT, rangeText, totalRange, WARN_CASEN, WARN_ISAPRE,
} from "@/utils/previsionScale";
import { buildIsapreComunaPopup } from "@/utils/previsionPopup";
import { CASEN_SECTION_TITLE, CasenRegionSection, IsapreChoroplethPanel, QuestionsBlock } from "@/components/map/PrevisionPanels";

beforeEach(() => rpcMock.mockReset());

const prov = (over: Partial<LayerProvenanceRow> = {}): LayerProvenanceRow => ({
  source_key: "superdesalud_isapre_cartera_comunal", name: "FIXTURE", publisher: "Publicador de prueba", landing_url: "https://example.test/", attribution: "Atribución de prueba",
  license_label: null, verification_status: "comprobado", scope_note: "Alcance de prueba", access_mode: "manual", freshness_status: "fresh", check_overdue: false,
  overdue_since: null, last_checked_at: null, snapshot_id: "snap-1", origin_url: "https://example.test/x.xlsx", sha256: "ab".repeat(32),
  captured_at: "2026-10-18T12:00:00Z", period_start: "2025-12-01", period_end: "2025-12-31", load_from: null, declared_date: "2026-01-28",
  definitive_until: null, quality_note: null, ...over,
});

const row = (cut: string, name: string, lo: number, hi: number, over: Partial<IsapreComunaRow> = {}): IsapreComunaRow =>
  ({ cut, name, region_cut: cut.slice(0, 2), n_lo: lo, n_hi: hi, exact: lo === hi, suppressed_cells: lo === hi ? 0 : 3, snapshot_id: "s1", period_end: "2025-12-31", ...over });

const resumen: IsapreResumenRow = {
  snapshot_id: "s1", period_start: "2025-12-01", period_end: "2025-12-31", declared_date: "2026-01-28", extraction_date: "2026-01-22", suppress_below: 5,
  cells: 1000, zeros_published: 400, suppressed_primary: 120, suppressed_complementary: 30, groups: 100, groups_total_suppressed: 7,
};
const sinAlta: IsapreSinAltaRow = {
  comunas_sin_alta: 20, comunas_con_dato: 18, benef_exacto: 5000, benef_pub_lo: 4900, benef_pub_hi: 5100, consistente: true, benef_total_comunas: 90000,
  snapshot_id: "s1", period_end: "2025-12-31", health_snapshot_id: "h1",
};

const casen = (region_cut: string, sistema: CasenRegionRow["sistema"], over: Partial<CasenRegionRow> = {}): CasenRegionRow => ({
  region_cut, region_name: region_cut === "13" ? "Metropolitana" : "Otra región", sistema, publishable: true, reason: null, n_sample: 500, pct: 14.25, se: 0.7, ci_lo: 12.9, ci_hi: 15.6,
  snapshot_id: "c1", period_end: "2024-12-31", ...over,
});

describe("utilidades", () => {
  it("rangeText: exacto o «entre a y b»; el cero es cero", () => {
    expect(rangeText(120, 120)).toBe("120");
    expect(rangeText(0, 0)).toBe("0");
    expect(rangeText(100, 250, false)).toBe("entre 100 y 250");
    expect(rangeText(100, 100, false)).toBe("100");
  });

  it("totalRange, countInexact y midpoint", () => {
    const rows = [row("90001", "A", 10, 10), row("90002", "B", 20, 30), row("90003", "C", 0, 0)];
    expect(totalRange(rows)).toEqual({ lo: 30, hi: 40 });
    expect(countInexact(rows)).toBe(1);
    expect(midpoint(rows[1])).toBe(25);
    expect(totalRange(undefined)).toEqual({ lo: 0, hi: 0 });
  });

  it("isapreFilterLabel dice edad, sexo y definición de alta complejidad", () => {
    expect(isapreFilterLabel(DEFAULT_ISAPRE_FILTERS)).toBe("Todas las edades · ambos sexos");
    const l = isapreFilterLabel({ sexo: "F", minTramo: 12, sinAlta: "ampliada" });
    expect(l).toContain("60 años o más");
    expect(l).toContain("Mujeres");
    expect(l).toContain("ampliada");
  });

  it("casenRangeText: rango primero y centro después; sin valor dice por qué", () => {
    expect(casenRangeText(casen("13", "isapre"))).toBe("entre 12,9 % y 15,6 % (centro 14,3 %)");
    const t = casenRangeText(casen("13", "otro", { publishable: false, reason: "menos de 60 casos muestrales", pct: null, ci_lo: null, ci_hi: null }));
    expect(t).toBe("no publicable: menos de 60 casos muestrales");
    expect(t).not.toMatch(/\d %/);
    // defensa de la interfaz: si por error llegaran valores en una fila no publicable, NO se muestran
    expect(casenRangeText(casen("13", "otro", { publishable: false, reason: "no fiable", pct: 14, ci_lo: 12, ci_hi: 15 }))).toBe("no publicable: no fiable");
  });

  it("casenByRegion y casenCounts", () => {
    const rows = [casen("13", "isapre"), casen("01", "fonasa"), casen("13", "fonasa"), casen("01", "otro", { publishable: false, reason: "x", pct: null, ci_lo: null, ci_hi: null })];
    expect(casenByRegion(rows).map((r) => r.region_cut)).toEqual(["01", "13"]);
    expect(Object.keys(casenByRegion(rows)[1].bySistema).sort()).toEqual(["fonasa", "isapre"]);
    expect(casenCounts(rows)).toEqual({ total: 4, publishable: 3 });
    expect(casenCounts(undefined)).toEqual({ total: 0, publishable: 0 });
  });

  it("las preguntas: 1b-1, 1b-2 y 1b-3 construidas; 1b-4 y 1b-5 no respondibles, con motivo", () => {
    const st = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.state]));
    expect(st).toEqual({ "1b-1": "construida", "1b-2": "construida", "1b-3": "construida", "1b-4": "no_respondible", "1b-5": "no_respondible" });
    for (const id of ["1b-4", "1b-5"]) expect(QUESTION_STATE_TEXT[id].length).toBeGreaterThan(20);
    expect(QUESTION_STATE_TEXT["1b-2"]).toBeUndefined();
    expect(QUESTIONS.find((q) => q.id === "1b-2")).toMatchObject({ level: "Respondida con rigor", seal: "Oficial con advertencia" });
    expect(QUESTIONS.find((q) => q.id === "1b-3")?.level).toMatch(/Estimada/);
    expect(QUESTIONS.find((q) => q.id === "1b-1")?.level).toMatch(/rigor/);
  });

  it("regla de redacción: ninguna advertencia afirma una causa [NO COMPROBADO]; lo no declarado se dice «no declara»", () => {
    const all = [...Object.values(WARN_CASEN), ...Object.entries(WARN_ISAPRE).map(([, v]) => (typeof v === "function" ? v(5) : v))].join(" ");
    expect(all).not.toMatch(/porque|se debe a|debido a|causa(da)? por/i);
    expect(WARN_ISAPRE.comuna).toMatch(/no declara/);
    expect(WARN_ISAPRE.suppression(5)).toMatch(/no declara una norma/);
    expect(WARN_ISAPRE.suppression(5)).toContain("1 a 4");
  });
});

describe("servicio", () => {
  it("get_isapre_comuna recibe sexo, edad mínima y definición de alta; null = sin filtro", async () => {
    rpcMock.mockResolvedValue({ data: [row("90001", "A", 1, 2)], error: null });
    await fetchIsapreComuna({ sexo: "F", minTramo: 12, sinAlta: "hospital" });
    expect(rpcMock).toHaveBeenCalledWith("get_isapre_comuna", { p_sexo: "F", p_min_tramo: 12, p_sin_alta: "hospital" });
    expect(isapreComunaArgs(DEFAULT_ISAPRE_FILTERS)).toEqual({ p_sexo: null, p_min_tramo: 0, p_sin_alta: null });
  });

  it("1b-1: pasa la definición y la edad; un error de la RPC se propaga (no se vuelve «sin datos»)", async () => {
    rpcMock.mockResolvedValueOnce({ data: [sinAlta], error: null });
    expect((await fetchIsapreSinAlta("ampliada", 12))[0].benef_exacto).toBe(5000);
    expect(rpcMock).toHaveBeenCalledWith("get_isapre_resumen_sin_alta", { p_alta: "ampliada", p_min_tramo: 12 });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "el conjunto cubre 3 comunas (< 10)" } });
    await expect(fetchIsapreSinAlta("hospital", 12)).rejects.toThrow("3 comunas");
  });

  it("resumen y CASEN: errores se propagan; sin datos = []", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(fetchIsapreResumen()).rejects.toThrow("permission denied");
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchCasenRegion()).toEqual([]);
    expect(rpcMock).toHaveBeenLastCalledWith("get_casen_prevision_region", {});
  });
});

describe("popup", () => {
  it("rango, cero publicado, sin dato; usa textContent (sin HTML inyectado)", () => {
    const ranged = buildIsapreComunaPopup(row("90001", "<b>Evil</b>", 100, 140), "x", "90001", "Todas las edades");
    expect(ranged.textContent).toContain("Beneficiarios Isapre: entre 100 y 140");
    expect(ranged.textContent).toContain("celdas con conteos pequeños suprimidos");
    expect(ranged.querySelector("b")).toBeNull();
    expect(buildIsapreComunaPopup(row("90002", "Cero", 0, 0), "x", "90002", "f").textContent).toContain("Beneficiarios Isapre: 0 (cero publicado)");
    const nodata = buildIsapreComunaPopup(undefined, "Antártica", "12202", "f").textContent ?? "";
    expect(nodata).toContain("sin dato (no es lo mismo que 0)");
    expect(nodata).not.toContain("Beneficiarios Isapre:");
    expect(nodata).toContain("no declara");
  });
});

const isapreProps = (over: Record<string, unknown> = {}) => ({
  layer: { client_ready: false, client_ready_note: "Pendiente." }, filters: DEFAULT_ISAPRE_FILTERS, onFilters: vi.fn(),
  rows: [row("90001", "A", 10, 10), row("90002", "B", 20, 30)], breaks: [10, 20, 30, 40], loading: false, error: null,
  resumen, resumenError: null, sinAlta, sinAltaError: null, sinAltaLoading: false, sinAltaDef: "hospital" as const, onSinAltaDef: vi.fn(),
  sources: [prov()], provenanceError: null, provenanceLoading: false, offset: 0, ...over,
});

describe("panel Isapre", () => {
  it("muestra nivel y sello, el aviso client_ready, el total como rango y que hay comunas en rango", () => {
    render(<IsapreChoroplethPanel {...isapreProps()} />);
    expect(screen.getByTestId("prevision-level-seal").textContent).toContain("Respondida con rigor");
    expect(screen.getByTestId("prevision-level-seal").textContent).toContain("Oficial con advertencia");
    expect(screen.getByTestId("health-not-client-ready")).toBeTruthy();
    expect(screen.getByTestId("isapre-legend").textContent).toContain("30 a 40 beneficiarios en 2 comunas");
    expect(screen.getByTestId("isapre-inexact").textContent).toContain("1 comunas se muestran como rango");
  });

  it("1b-1: muestra el agregado exacto, el rango publicado, y avisa si no son consistentes", () => {
    const { rerender } = render(<IsapreChoroplethPanel {...isapreProps()} />);
    expect(screen.getByTestId("isapre-sin-alta-value").textContent).toContain("5.000");
    expect(screen.getByTestId("isapre-sin-alta").textContent).toContain("entre 4.900 y 5.100");
    expect(screen.getByTestId("isapre-sin-alta").textContent).not.toContain("FUERA");
    rerender(<IsapreChoroplethPanel {...isapreProps({ sinAlta: { ...sinAlta, consistente: false } })} />);
    expect(screen.getByTestId("isapre-sin-alta").textContent).toContain("FUERA del rango publicado");
  });

  it("1b-1 con error de la base: lo muestra y no pinta cifra", () => {
    render(<IsapreChoroplethPanel {...isapreProps({ sinAlta: undefined, sinAltaError: "el conjunto cubre 3 comunas (< 10)" })} />);
    expect(screen.getByTestId("isapre-sin-alta").textContent).toContain("el conjunto cubre 3 comunas");
    expect(screen.queryByTestId("isapre-sin-alta-value")).toBeNull();
  });

  it("1b-1 dice qué significa «60+»: sin la edad sin información, con el sexo sin información, y que el total NO es el del país", () => {
    render(<IsapreChoroplethPanel {...isapreProps()} />);
    expect(screen.getByTestId("isapre-age60-note").textContent).toMatch(/EXCLUYE a quienes no informan edad.*INCLUYE a quienes no informan sexo/);
    const t = screen.getByTestId("isapre-sin-alta").textContent ?? "";
    expect(t).toContain("90.000");
    expect(t).toContain("no es el total del país");
    expect(t).not.toContain("Total del país");
    expect(screen.getByLabelText("Edad").textContent).toContain("sin la edad sin información");
  });

  it("los filtros devuelven edad, sexo y «solo comunas sin alta complejidad» (D1)", () => {
    const onFilters = vi.fn();
    render(<IsapreChoroplethPanel {...isapreProps({ onFilters })} />);
    fireEvent.change(screen.getByLabelText("Edad"), { target: { value: "12" } });
    expect(onFilters).toHaveBeenLastCalledWith({ sexo: null, minTramo: 12, sinAlta: null });
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "M" } });
    expect(onFilters).toHaveBeenLastCalledWith({ sexo: "M", minTramo: 0, sinAlta: null });
    fireEvent.change(screen.getByLabelText("Solo comunas sin alta complejidad"), { target: { value: "ampliada" } });
    expect(onFilters).toHaveBeenLastCalledWith({ sexo: null, minTramo: 0, sinAlta: "ampliada" });
  });

  it("las advertencias de uso siempre están (alcance, provisional, comuna no declarada, período, supresión, 0 ≠ sin dato, acceso)", () => {
    render(<IsapreChoroplethPanel {...isapreProps()} />);
    const w = screen.getByTestId("projects-warnings").textContent ?? "";
    for (const k of ["NO incluye Fonasa", "PROVISIONAL", "no declara qué comuna", "no es la fecha de publicación", "1 a 4", "Sin dato", "NO significa sin acceso", "EXCLUYE a quienes no informan edad", "INCLUYE a quienes no informan sexo"]) expect(w).toContain(k);
    expect(screen.getByTestId("license-line").textContent).toContain("por confirmar");
  });

  it("la pregunta 1b-2 se ve construida con su nivel y sello, y la 1b-5 (no respondible) con su motivo", () => {
    render(<IsapreChoroplethPanel {...isapreProps()} />);
    expect(screen.getByTestId("question-1b-2").textContent).toContain("Nivel: Respondida con rigor · Sello: Oficial con advertencia");
    expect(screen.getByTestId("question-1b-2").textContent).not.toContain("En espera");
    expect(screen.getByTestId("question-1b-5").textContent).toContain("faltan los archivos de Fonasa");
    expect(screen.getByTestId("question-1b-5").textContent).toContain("No respondible hoy");
  });

  it("la ficha dice período, publicación y extracción por separado, y las estadísticas de la supresión", () => {
    render(<IsapreChoroplethPanel {...isapreProps()} />);
    const t = screen.getByTestId("isapre-resumen").textContent ?? "";
    expect(t).toContain("2025-12-31");
    expect(t).toContain("Publicación declarada: 2026-01-28");
    expect(t).toContain("Extracción: 2026-01-22");
    expect(t).toContain("120 se suprimieron por tener entre 1 y 4 personas");
  });

  it("error de lectura: lo muestra, no lo disfraza de «sin datos»", () => {
    render(<IsapreChoroplethPanel {...isapreProps({ rows: undefined, error: "permission denied" })} />);
    expect(screen.getByTestId("isapre-legend").textContent).toContain("No se pudieron leer los datos: permission denied");
  });
});

describe("sección CASEN regional (dentro del panel Isapre)", () => {
  const casenProps = (rows: CasenRegionRow[], over: Record<string, unknown> = {}) => ({
    layer: { client_ready: false, client_ready_note: "Pendiente." }, open: true, onOpenChange: vi.fn(), rows, loading: false, error: null,
    sources: [prov({ source_key: "mds_casen_2024_nacional" })], provenanceError: null, provenanceLoading: false, ...over,
  });

  it("estimada con rango: nivel y sello, solo Fonasa e Isapre por defecto, y nunca una cifra puntual sola", () => {
    render(<CasenRegionSection {...casenProps([casen("13", "fonasa"), casen("13", "isapre"), casen("13", "otro")])} />);
    expect(screen.getByTestId("casen-level-seal").textContent).toContain("Estimada con rango (intervalo de confianza del 95 %)");
    expect(screen.getByTestId("casen-level-seal").textContent).toContain("Sello: Estimado");
    expect(screen.getByTestId("casen-13-isapre").textContent).toContain("entre 12,9 % y 15,6 %");
    expect(screen.queryByTestId("casen-13-otro")).toBeNull();
    fireEvent.click(screen.getByLabelText("Mostrar todos los sistemas"));
    expect(screen.getByTestId("casen-13-otro")).toBeTruthy();
  });

  it("estimación no publicable: sin números, con el motivo, y se cuentan", () => {
    render(<CasenRegionSection {...casenProps([casen("13", "isapre"), casen("01", "isapre", { publishable: false, reason: "menos de 60 casos muestrales", pct: null, ci_lo: null, ci_hi: null })])} />);
    const t = screen.getByTestId("casen-01-isapre").textContent ?? "";
    expect(t).toContain("no publicable: menos de 60 casos muestrales");
    expect(t).not.toMatch(/\d %/);
    expect(screen.getByTestId("casen-counts").textContent).toContain("1 de 2 estimaciones");
  });

  it("no pinta comunas, dice que no es representativa a ese nivel; 1b-4 no respondible; no se suma con otras fuentes", () => {
    render(<CasenRegionSection {...casenProps([casen("13", "isapre")])} />);
    expect(screen.getByTestId("casen-region-body").textContent).toContain("la encuesta no es representativa a ese nivel");
    expect(screen.getByTestId("question-1b-4").textContent).toContain("No respondible hoy");
    expect(screen.getByTestId("projects-warnings").textContent).toContain("No se suma con Isapre ni con Fonasa");
  });

  it("error o vacío: lo dice", () => {
    const { rerender } = render(<CasenRegionSection {...casenProps([], { error: "boom" })} />);
    expect(screen.getByTestId("casen-regions").textContent).toContain("No se pudieron leer los datos: boom");
    rerender(<CasenRegionSection {...casenProps([])} />);
    expect(screen.getByTestId("casen-regions").textContent).toContain("Todavía no hay estimaciones cargadas");
  });

  it("es plegable: el título es «Previsión regional (CASEN 2024, estimada)», cerrada no monta su cuerpo y avisa al abrirse", () => {
    const onOpenChange = vi.fn();
    render(<CasenRegionSection {...casenProps([casen("13", "isapre")], { open: false, onOpenChange })} />);
    expect(CASEN_SECTION_TITLE).toBe("Previsión regional (CASEN 2024, estimada)");
    const d = screen.getByTestId("casen-region-section") as HTMLDetailsElement;
    expect(d.querySelector("summary")?.textContent).toBe("Previsión regional (CASEN 2024, estimada)");
    expect(d.open).toBe(false);
    expect(screen.queryByTestId("casen-region-body")).toBeNull();
    d.open = true;
    fireEvent(d, new Event("toggle"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("la sección conserva su PROPIO client_ready: con la capa Isapre apta y CASEN no, el aviso de CASEN sigue y el de Isapre no aparece", () => {
    render(<IsapreChoroplethPanel {...isapreProps({ layer: { client_ready: true, client_ready_note: null }, casen: casenProps([casen("13", "isapre")], { layer: { client_ready: false, client_ready_note: "CASEN pendiente." } }) })} />);
    const avisos = screen.getAllByTestId("health-not-client-ready");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].textContent).toContain("CASEN pendiente.");
    expect(screen.getByTestId("casen-region-section").contains(avisos[0])).toBe(true);
  });

  it("con la capa Isapre NO apta y CASEN apta, solo aparece el aviso de Isapre", () => {
    render(<IsapreChoroplethPanel {...isapreProps({ layer: { client_ready: false, client_ready_note: "Isapre pendiente." }, casen: casenProps([casen("13", "isapre")], { layer: { client_ready: true, client_ready_note: null } }) })} />);
    const avisos = screen.getAllByTestId("health-not-client-ready");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].textContent).toContain("Isapre pendiente.");
    expect(screen.getByTestId("casen-region-section").contains(avisos[0])).toBe(false);
  });

  it("el panel Isapre trae la sección dentro, con su título; sin la prop no hay sección", () => {
    const { rerender } = render(<IsapreChoroplethPanel {...isapreProps()} />);
    expect(screen.queryByTestId("casen-region-section")).toBeNull();
    rerender(<IsapreChoroplethPanel {...isapreProps({ casen: casenProps([casen("13", "isapre")], { open: false }) })} />);
    expect(screen.getByTestId("isapre-choropleth-panel").contains(screen.getByTestId("casen-region-section"))).toBe(true);
    expect(screen.getByTestId("casen-region-section").textContent).toContain("Previsión regional (CASEN 2024, estimada)");
  });
});

describe("QuestionsBlock", () => {
  it("solo lista las preguntas pedidas", () => {
    render(<QuestionsBlock ids={["1b-3"]} />);
    expect(screen.getByTestId("question-1b-3")).toBeTruthy();
    expect(screen.queryByTestId("question-1b-1")).toBeNull();
  });
});
