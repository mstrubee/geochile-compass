/**
 * Salud, Fase 1a (front): utilidades, servicio, popups, paneles y ficha. Los datos son FIXTURES sintéticas (códigos 9xxxxx), no cifras del registro.
 * Las cifras reales (82 hospitales, 5.354 vigentes…) se verifican con el archivo real en el informe de la fase y en las pruebas SQL/ETL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LayerProvenanceRow, ThematicLayerRow } from "@/types/permits";
import { DEFAULT_HEALTH_FILTERS, type HealthComunaCountRow, type HealthComunaTipoRow, type HealthEstablishmentRow, type HealthSummaryRow, type HealthTipoRow } from "@/types/health";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock, from: fromMock } }));

import {
  breakdownByTipo, claseText, countingText, filterLabel, hasActiveFilters, pointRadius, rankComunas, summaryN, totalEstablishments, totalImputed, WARN, ALTA_LABEL, GEO_MARKED, GEO_NOT_DRAWN,
} from "@/utils/healthScale";
import { fetchHealthComunaCounts, fetchHealthComunaTipos, fetchHealthEstablishments, fetchHealthSummary, healthFilterArgs, healthPointsArgs } from "@/services/healthService";
import { fetchThematicLayers } from "@/services/permitsService";
import { withThematicClientReady, visibleIdsToHideForCapture } from "@/utils/clientReady";
import { HealthPopup } from "@/components/map/HealthPopup";
import { buildComunaPopup } from "@/utils/healthPopup";
import { HealthChoroplethPanel, HealthPointsPanel, ClientReadyNotice } from "@/components/map/HealthPanels";
import { HealthFichaDialog } from "@/components/map/HealthFichaDialog";

beforeEach(() => { rpcMock.mockReset(); fromMock.mockReset(); });

const prov = (over: Partial<LayerProvenanceRow> = {}): LayerProvenanceRow => ({
  source_key: "deis_establecimientos", name: "FIXTURE", publisher: "Publicador de prueba", landing_url: "https://example.test/", attribution: "Atribución de prueba",
  license_label: "CC0 de prueba", verification_status: "comprobado", scope_note: "Alcance de prueba", access_mode: "manual", freshness_status: "fresh", check_overdue: false,
  overdue_since: null, last_checked_at: null, snapshot_id: "snap-1", origin_url: "https://example.test/x.csv", sha256: "ab".repeat(32),
  captured_at: "2026-10-17T12:00:00Z", period_start: "2026-10-17", period_end: "2026-10-17", load_from: null, declared_date: "2026-10-14",
  definitive_until: null, quality_note: null, ...over,
});

const est = (over: Partial<HealthEstablishmentRow> = {}): HealthEstablishmentRow => ({
  code: "900001", name: "FIXTURE Hospital", tipo_glosa: "Hospital", comuna_cut: "13101", comuna_name: "Santiago", dependencia_norm: "servicio_salud", complejidad: "alta",
  tipo_atencion: "hospitalaria", clase_servicio: "hospitalario", clase_fuente: "oficial", estado: "vigente", alta_hospital: true, alta_ampliada: true,
  tiene_urgencia: true, address: "Calle Falsa 123", lon: -70.65, lat: -33.45, geo_status: 0, geo_distance_m: null, total_matching: 1, snapshot_id: "snap-1",
  captured_at: "2026-10-17T12:00:00Z", ...over,
});

const cnt = (cut: string, name: string, n: number, over: Partial<HealthComunaCountRow> = {}): HealthComunaCountRow => ({
  cut, name, region_cut: cut.slice(0, 2), region_name: cut.startsWith("13") ? "Metropolitana" : "Otra región", establishments: n, imputed: 0, not_drawable: 0, marked_geo: 0,
  rank: 1, snapshot_id: "snap-1", captured_at: "2026-10-17T12:00:00Z", ...over,
});

describe("utilidades", () => {
  it("rankComunas: más / menos tienen, con empates por nombre, región y los ceros verdaderos al final del «menos»", () => {
    const rows = [cnt("13101", "Santiago", 12), cnt("13102", "Cerrillos", 3), cnt("05101", "Valparaíso", 12), cnt("05102", "Casablanca", 0), cnt("13103", "Cerro Navia", 0)];
    expect(rankComunas(rows, "desc", 3).map((r) => r.name)).toEqual(["Santiago", "Valparaíso", "Cerrillos"]);
    expect(rankComunas(rows, "asc", 3).map((r) => r.name)).toEqual(["Casablanca", "Cerro Navia", "Cerrillos"]);
    expect(rankComunas(rows, "desc", 10, "13").map((r) => r.name)).toEqual(["Santiago", "Cerrillos", "Cerro Navia"]);
    expect(rankComunas(undefined, "desc")).toEqual([]);
  });

  it("totales: suma real y clase imputada", () => {
    const rows = [cnt("13101", "A", 10, { imputed: 2 }), cnt("13102", "B", 0), cnt("13103", "C", 5, { imputed: 1 })];
    expect(totalEstablishments(rows)).toBe(15);
    expect(totalImputed(rows)).toBe(3);
    expect(totalEstablishments(undefined)).toBe(0);
  });

  it("filterLabel y hasActiveFilters: dicen siempre qué definición y si hay cerrados", () => {
    expect(hasActiveFilters(DEFAULT_HEALTH_FILTERS)).toBe(false);                       // el ámbito por defecto («solo establecimientos») no cuenta como filtro activo
    expect(hasActiveFilters({ ...DEFAULT_HEALTH_FILTERS, ambito: null })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_HEALTH_FILTERS, tipo: ["hospital"] })).toBe(true);
    expect(filterLabel(DEFAULT_HEALTH_FILTERS)).toBe("Todos los establecimientos · vigentes");
    const f = { ...DEFAULT_HEALTH_FILTERS, alta: "ampliada" as const, dependencia: ["privado"], clase: ["ambulatorio" as const], includeClosed: true };
    expect(hasActiveFilters(f)).toBe(true);
    expect(filterLabel(f)).toContain(ALTA_LABEL.ampliada);
    expect(filterLabel(f)).toContain("Privado");
    expect(filterLabel(f)).toContain("vigentes y cerrados");
  });

  it("countingText: dice SIEMPRE qué se está contando (tipos, ámbito y estado)", () => {
    expect(countingText(DEFAULT_HEALTH_FILTERS)).toBe("Se cuenta: todos los tipos · solo establecimientos (sin unidades de atención ni programas) · solo vigentes.");
    expect(countingText({ ...DEFAULT_HEALTH_FILTERS, ambito: null, tipo: ["hospital", "clínica"], includeClosed: true }, { hospital: "Hospital", "clínica": "Clínica" }))
      .toBe("Se cuenta: solo Hospital o Clínica · incluye unidades de atención y programas · vigentes y cerrados.");
  });

  it("breakdownByTipo agrupa tipo/ámbito/estado conservando el orden y colapsando espacios dobles", () => {
    const rows: HealthComunaTipoRow[] = [
      { tipo_glosa: "Sala  Externa de Toma de Muestras (SETM)", ambito: "Unidad de Atención", estado: "vigente", n: 24 },
      { tipo_glosa: "Sala  Externa de Toma de Muestras (SETM)", ambito: "Unidad de Atención", estado: "cerrado", n: 1 },
      { tipo_glosa: "Hospital", ambito: "Establecimiento de Salud", estado: "vigente", n: 2 }];
    expect(breakdownByTipo(rows)).toEqual([
      { tipo: "Sala Externa de Toma de Muestras (SETM)", vigentes: 24, cerrados: 1, ambitos: ["Unidad de Atención"] },
      { tipo: "Hospital", vigentes: 2, cerrados: 0, ambitos: ["Establecimiento de Salud"] }]);
  });

  it("claseText: declara cuando la clase es imputada o no se declara", () => {
    expect(claseText({ clase_servicio: "hospitalario", clase_fuente: "oficial" })).toBe("Hospitalario");
    expect(claseText({ clase_servicio: "ambulatorio", clase_fuente: "tabla" })).toContain("imputada por tabla de diseño");
    expect(claseText({ clase_servicio: "sin_clasificar", clase_fuente: "sin_clasificar" })).toContain("la fuente no la declara");
  });

  it("estados de ubicación: borde/costero/fuera se marcan; sin coordenadas e inválida no se dibujan", () => {
    expect([...GEO_MARKED].sort()).toEqual([1, 2, 3]);
    expect([...GEO_NOT_DRAWN].sort()).toEqual([4, 6]);
    expect(pointRadius({ alta_ampliada: true })).toBeGreaterThan(pointRadius({ alta_ampliada: false }));
  });

  it("summaryN lee el resumen largo", () => {
    const s: HealthSummaryRow[] = [{ dimension: "estado", value: "vigente", n: 7 }, { dimension: "total", value: "todos", n: 9 }];
    expect(summaryN(s, "estado", "vigente")).toBe(7);
    expect(summaryN(s, "total")).toBe(9);
    expect(summaryN(s, "alta_hospital_vigentes")).toBeNull();
  });
});

describe("servicio", () => {
  it("los arreglos vacíos viajan como null y el bbox va completo", () => {
    expect(healthFilterArgs(DEFAULT_HEALTH_FILTERS)).toEqual({ p_include_closed: false, p_dependencia: null, p_complejidad: null, p_clase: null, p_alta: null,
      p_ambito: ["Establecimiento de Salud"], p_tipo: null });
    expect(healthFilterArgs({ ...DEFAULT_HEALTH_FILTERS, ambito: null, tipo: ["hospital"] })).toMatchObject({ p_ambito: null, p_tipo: ["hospital"] });
    expect(healthFilterArgs({ ...DEFAULT_HEALTH_FILTERS, dependencia: [], alta: "hospital", includeClosed: true, clase: ["ambulatorio"] }))
      .toMatchObject({ p_include_closed: true, p_dependencia: null, p_alta: "hospital", p_clase: ["ambulatorio"] });
    expect(healthPointsArgs({ west: -71, south: -34, east: -70, north: -33 }, DEFAULT_HEALTH_FILTERS)).toMatchObject({ p_west: -71, p_south: -34, p_east: -70, p_north: -33, p_limit: 6000 });
  });

  it("llama a las RPC correctas con sus argumentos", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await fetchHealthEstablishments({ west: -71, south: -34, east: -70, north: -33 }, DEFAULT_HEALTH_FILTERS);
    await fetchHealthComunaCounts({ ...DEFAULT_HEALTH_FILTERS, alta: "ampliada" });
    await fetchHealthSummary();
    await fetchHealthComunaTipos("04101");
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["get_health_establishments", "get_health_comuna_counts", "get_health_summary", "get_health_comuna_tipos"]);
    expect(rpcMock.mock.calls[3][1]).toEqual({ p_cut: "04101" });
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_alta: "ampliada" });
  });

  it("un error de la RPC se propaga (nunca se lee como «sin datos»); data null sin error es []", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(fetchHealthSummary()).rejects.toThrow("boom");
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchHealthComunaCounts(DEFAULT_HEALTH_FILTERS)).resolves.toEqual([]);
  });
});

describe("capas temáticas y client_ready (regla 6)", () => {
  it("fetchThematicLayers pide client_ready y, SOLO si la columna no existe (42703), repite la consulta anterior", async () => {
    const select = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'column "client_ready" does not exist', code: "42703" } })
      .mockResolvedValueOnce({ data: [{ layer_id: "L1", renderer: "choropleth_comuna", dataset: "building_permits", default_params: null }], error: null });
    fromMock.mockReturnValue({ select });
    const rows = await fetchThematicLayers();
    expect(select.mock.calls[0][0]).toContain("client_ready");
    expect(select.mock.calls[1][0]).not.toContain("client_ready");
    expect(rows).toHaveLength(1);
  });

  it("cualquier OTRO error (permisos, red, tabla ausente) no se esconde con un reintento: una sola consulta, [] y aviso en consola", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const err of [{ message: "permission denied for table thematic_layers", code: "42501" }, { message: "relation does not exist", code: "42P01" }, { message: "network" }]) {
      const select = vi.fn().mockResolvedValue({ data: null, error: err });
      fromMock.mockReturnValue({ select });
      await expect(fetchThematicLayers()).resolves.toEqual([]);
      expect(select).toHaveBeenCalledTimes(1);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("con la columna presente, una sola consulta y la bandera llega", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ layer_id: "H1", renderer: "points_health", dataset: "health_establishments", default_params: null, client_ready: false, client_ready_note: "n" }], error: null });
    fromMock.mockReturnValue({ select });
    const rows = await fetchThematicLayers();
    expect(select).toHaveBeenCalledTimes(1);
    expect(rows[0].client_ready).toBe(false);
  });

  it("withThematicClientReady pisa solo cuando la capa temática define la bandera; null = sin evaluar conserva lo previo", () => {
    const layers = [{ id: "A" }, { id: "H" }, { id: "P", client_ready: true as boolean | null }];
    const merged = withThematicClientReady(layers, [{ layer_id: "H", client_ready: false }, { layer_id: "P", client_ready: null }, { layer_id: "A", client_ready: null }]);
    expect(merged.find((l) => l.id === "H")?.client_ready).toBe(false);
    expect(merged.find((l) => l.id === "P")?.client_ready).toBe(true);
    expect((merged.find((l) => l.id === "A") as { client_ready?: unknown }).client_ready).toBeUndefined();
  });

  it("una capa de salud con client_ready = false se APAGA en la captura del informe; las demás no", () => {
    const layers = withThematicClientReady([{ id: "H" }, { id: "P" }], [{ layer_id: "H", client_ready: false }]);
    expect(visibleIdsToHideForCapture(new Set(["H", "P"]), layers)).toEqual(["H"]);
    expect(visibleIdsToHideForCapture(new Set(["P"]), layers)).toEqual([]);
  });

  it("ClientReadyNotice solo aparece con false y muestra la nota", () => {
    const { rerender } = render(<ClientReadyNotice layer={{ client_ready: false, client_ready_note: "Pendiente de revisión." }} />);
    expect(screen.getByTestId("health-not-client-ready").textContent).toContain("no entra a informes ni exportaciones");
    expect(screen.getByTestId("health-not-client-ready").textContent).toContain("Pendiente de revisión.");
    rerender(<ClientReadyNotice layer={{ client_ready: null }} />);
    expect(screen.queryByTestId("health-not-client-ready")).toBeNull();
    rerender(<ClientReadyNotice layer={{ client_ready: true }} />);
    expect(screen.queryByTestId("health-not-client-ready")).toBeNull();
  });
});

describe("popups", () => {
  it("HealthPopup: clase imputada, alta complejidad por definición, cerrado y ubicación marcada", () => {
    render(<HealthPopup row={est({ clase_fuente: "tabla", clase_servicio: "ambulatorio", alta_hospital: false, alta_ampliada: true, estado: "cerrado", geo_status: 3, geo_distance_m: 12345 })} />);
    const t = screen.getByTestId("health-popup").textContent ?? "";
    expect(t).toContain("imputada por tabla de diseño");
    expect(t).toContain("solo en la definición ampliada");
    expect(t).toContain("CERRADO");
    expect(t).toContain("FUERA de su comuna declarada");
    expect(t).toContain("12.345 m");
    expect(t).toContain("El punto es el original de la fuente");
    expect(t).toContain("NO mide capacidad");
  });

  it("HealthPopup de un hospital de alta complejidad dice que entra en las dos definiciones", () => {
    render(<HealthPopup row={est()} />);
    expect(screen.getByTestId("health-popup").textContent).toContain("hospital (definición por defecto y ampliada)");
  });

  it("buildComunaPopup: cero verdadero, sin dato ≠ 0, clase imputada y advertencia del registro (DOM seguro)", () => {
    const zero = buildComunaPopup(cnt("13101", "Santiago", 0, { rank: 200 }), "x", "13101", "Todos · vigentes");
    expect(zero.textContent).toContain("Establecimientos: 0 (cero verdadero)");
    expect(zero.textContent).toContain("Puesto 200 de 346");
    const none = buildComunaPopup(undefined, "Comuna X", "99999", "Todos · vigentes");
    expect(none.textContent).toContain("no es lo mismo que 0");
    const imp = buildComunaPopup(cnt("13101", "Santiago", 5, { imputed: 2, not_drawable: 1, marked_geo: 1 }), "x", "13101", "f");
    expect(imp.textContent).toContain("2 con clase imputada por tabla de diseño");
    expect(imp.textContent).toContain("1 sin ubicación dibujable");
    expect(imp.textContent).toContain(WARN.registry);
    const evil = buildComunaPopup(cnt("13101", "<img src=x onerror=alert(1)>", 1), "x", "13101", "f");
    expect(evil.querySelector("img")).toBeNull();
  });
});

const baseProps = {
  layer: { client_ready: false as boolean | null, client_ready_note: "Pendiente de revisión del dueño." },
  filters: DEFAULT_HEALTH_FILTERS, onFilters: vi.fn(), sources: [prov()], provenanceError: null, provenanceLoading: false,
  summary: undefined, summaryError: null, tipos: undefined, tiposError: null, onFichaOpen: vi.fn(), loading: false, error: null, offset: 0,
};

describe("panel de puntos", () => {
  it("muestra nivel y sello, advertencias del registro, cerrados ocultos y conteos de clase imputada y ubicación marcada", () => {
    render(<HealthPointsPanel {...baseProps} shown={100} totalMatching={100} imputedShown={7} markedShown={3} />);
    const p = screen.getByTestId("health-points-panel");
    expect(p.textContent).toContain("Respondida con rigor");
    expect(p.textContent).toContain("Oficial con advertencia");
    expect(p.textContent).toContain(WARN.registry);
    expect(p.textContent).toContain(WARN.closedHidden);
    expect(p.textContent).toContain("7 de 100 establecimientos tienen la clase");
    expect(p.textContent).toContain("3 establecimientos tienen la ubicación marcada");
    expect(p.textContent).toContain("no entra a informes ni exportaciones");
    expect(screen.getByTestId("projects-source")).toBeTruthy();
    expect(screen.getByTestId("license-line").textContent).toContain("CC0 de prueba");
  });

  it("incluir cerrados cambia el filtro y la advertencia; el filtro de alta nombra las dos definiciones", () => {
    const onFilters = vi.fn();
    const { rerender } = render(<HealthPointsPanel {...baseProps} onFilters={onFilters} shown={1} totalMatching={1} imputedShown={0} markedShown={0} />);
    fireEvent.click(screen.getByLabelText("Incluir cerrados"));
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ includeClosed: true }));
    fireEvent.change(screen.getByLabelText("Definición de alta complejidad"), { target: { value: "ampliada" } });
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ alta: "ampliada" }));
    const opts = Array.from((screen.getByLabelText("Definición de alta complejidad") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(opts).toEqual(expect.arrayContaining(["Sin filtro", ALTA_LABEL.hospital, ALTA_LABEL.ampliada]));
    fireEvent.change(screen.getByLabelText("Dependencia"), { target: { value: "privado" } });
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ dependencia: ["privado"] }));
    fireEvent.change(screen.getByLabelText("Dependencia"), { target: { value: "" } });
    expect(onFilters).toHaveBeenLastCalledWith(expect.objectContaining({ dependencia: null }));
    rerender(<HealthPointsPanel {...baseProps} filters={{ ...DEFAULT_HEALTH_FILTERS, includeClosed: true }} shown={1} totalMatching={1} imputedShown={0} markedShown={0} />);
    expect(screen.getByTestId("health-points-panel").textContent).toContain(WARN.closedShown);
  });

  it("avisa cuando se muestran menos puntos de los que hay, y un error de datos no se disfraza de vacío", () => {
    render(<HealthPointsPanel {...baseProps} shown={6000} totalMatching={6500} imputedShown={0} markedShown={0} error="boom" />);
    expect(screen.getByRole("alert").textContent).toContain("boom");
    expect(screen.getByTestId("health-points-legend").textContent).toContain("Se muestran los primeros");
  });

  it("apilado: respeta el offset recibido", () => {
    render(<HealthPointsPanel {...baseProps} offset={2} shown={0} totalMatching={0} imputedShown={0} markedShown={0} />);
    expect((screen.getByTestId("health-points-panel") as HTMLElement).style.right).toContain("2 * 19.25rem");
  });
});

describe("panel por comuna con ranking", () => {
  const rows = [cnt("13101", "Santiago", 12, { rank: 1, imputed: 3 }), cnt("13102", "Cerrillos", 3, { rank: 2 }), cnt("05101", "Valparaíso", 0, { rank: 3 })];
  const props = { ...baseProps, rows, breaks: [3, 12], missingPolygons: 0, onPick: vi.fn(), selected: null as { cut: string; name: string } | null, breakdown: undefined as HealthComunaTipoRow[] | undefined, breakdownError: null as string | null };

  it("lista el ranking (más tienen), el total y el cero verdadero en la leyenda", () => {
    render(<HealthChoroplethPanel {...props} />);
    expect(screen.getByTestId("rank-13101").textContent).toContain("12");
    expect(screen.getByTestId("health-choropleth-legend").textContent).toContain("15 establecimientos");
    expect(screen.getByTestId("health-choropleth-legend").textContent).toContain("0 (valor informado por la fuente)");
    expect(screen.getByTestId("health-choropleth-legend").textContent).toContain("Sin dato (no es 0)");
    expect(screen.getByTestId("health-choropleth-panel").textContent).toContain(WARN.zeroTrue);
    expect(screen.getByTestId("health-choropleth-panel").textContent).toContain("3 de 15 establecimientos tienen la clase");
  });

  it("«las que menos tienen» incluye el 0 verdadero y rotula (0 verdadero); el filtro de región recorta", () => {
    render(<HealthChoroplethPanel {...props} />);
    fireEvent.change(screen.getByLabelText("Orden del ranking"), { target: { value: "asc" } });
    expect(screen.getByTestId("rank-05101").textContent).toContain("0 (0 verdadero)");
    fireEvent.change(screen.getByLabelText("Región del ranking"), { target: { value: "13" } });
    expect(screen.queryByTestId("rank-05101")).toBeNull();
    expect(screen.getByTestId("rank-13102")).toBeTruthy();
  });

  it("clic en una comuna del ranking la elige (zoom en el host)", () => {
    const onPick = vi.fn();
    render(<HealthChoroplethPanel {...props} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Santiago" }));
    expect(onPick).toHaveBeenCalledWith("13101");
  });

  it("avisa de las comunas sin polígono y de lo no dibujable; mientras carga no inventa ceros", () => {
    const { rerender } = render(<HealthChoroplethPanel {...props} missingPolygons={1} rows={[cnt("13101", "Santiago", 4, { not_drawable: 2, marked_geo: 1 })]} />);
    const t = screen.getByTestId("health-choropleth-panel").textContent ?? "";
    expect(t).toContain(WARN.noPolygon);
    expect(t).toContain("2 establecimientos no se dibujan");
    expect(t).toContain("1 establecimientos tienen la ubicación marcada");
    rerender(<HealthChoroplethPanel {...props} rows={undefined} loading />);
    expect(screen.getByTestId("health-choropleth-legend").textContent).toContain("Cargando…");
    expect(screen.queryByTestId("rank-13101")).toBeNull();
  });
});

describe("qué se cuenta (anomalía del ranking)", () => {
  const tiposRows: HealthTipoRow[] = [{ tipo_norm: "hospital", tipo_label: "Hospital", clase: "hospitalario", alta_hospital: true, alta_ampliada: true, evidence: "e" },
    { tipo_norm: "clínica dental", tipo_label: "Clínica Dental", clase: "ambulatorio", alta_hospital: false, alta_ampliada: false, evidence: "e" }];
  const props = { ...baseProps, rows: [cnt("04101", "La Serena", 209)], breaks: [], missingPolygons: 0, onPick: vi.fn(), selected: null as { cut: string; name: string } | null,
    breakdown: undefined as HealthComunaTipoRow[] | undefined, breakdownError: null as string | null, tipos: tiposRows };

  it("los dos paneles dicen qué se cuenta: todos los tipos, solo establecimientos (sin unidades ni programas) y solo vigentes", () => {
    render(<HealthChoroplethPanel {...props} />);
    const c = screen.getByTestId("health-counting").textContent ?? "";
    expect(c).toContain("todos los tipos");
    expect(c).toContain("solo establecimientos (sin unidades de atención ni programas)");
    expect(c).toContain("solo vigentes");
    expect(c).toContain("laboratorios, tomas de muestras");
  });

  it("el panel de puntos también", () => {
    render(<HealthPointsPanel {...baseProps} tipos={tiposRows} shown={1} totalMatching={1} imputedShown={0} markedShown={0} />);
    expect(screen.getByTestId("health-counting").textContent).toContain("todos los tipos");
  });

  it("la heterogeneidad entre regiones aparece como advertencia en el panel (no es oferta ni comparable)", () => {
    render(<HealthChoroplethPanel {...props} />);
    expect(screen.getByTestId("health-choropleth-panel").textContent).toContain("cada SEREMI los autoriza y registra");
    expect(screen.getByTestId("health-choropleth-panel").textContent).toContain("NO es oferta");
  });

  it("filtro por tipo (alimentado por la tabla) y casilla de unidades/programas cambian el filtro", () => {
    const onFilters = vi.fn();
    render(<HealthChoroplethPanel {...props} onFilters={onFilters} />);
    const sel = screen.getByLabelText("Tipo de establecimiento") as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["Todos los tipos", "Hospital", "Clínica Dental"]);
    fireEvent.change(sel, { target: { value: "clínica dental" } });
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ tipo: ["clínica dental"] }));
    expect((screen.getByLabelText("Incluir unidades de atención y programas") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Incluir unidades de atención y programas"));
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ ambito: null }));
  });

  it("al elegir una comuna muestra el desglose por tipo y estado (qué hay detrás del número)", () => {
    const breakdown: HealthComunaTipoRow[] = [
      { tipo_glosa: "Centro de Salud Privado", ambito: "Establecimiento de Salud", estado: "vigente", n: 78 },
      { tipo_glosa: "Centro de Salud Privado", ambito: "Establecimiento de Salud", estado: "cerrado", n: 2 },
      { tipo_glosa: "Sala  Externa de Toma de Muestras (SETM)", ambito: "Unidad de Atención", estado: "vigente", n: 24 }];
    render(<HealthChoroplethPanel {...props} selected={{ cut: "04101", name: "La Serena" }} breakdown={breakdown} />);
    const t = screen.getByTestId("health-breakdown").textContent ?? "";
    expect(t).toContain("La Serena");
    expect(t).toContain("Centro de Salud Privado");
    expect(t).toContain("78");
    expect(t).toContain("Sala Externa de Toma de Muestras (SETM) (Unidad de Atención)");
  });

  it("sin comuna elegida no hay desglose; con error de lectura lo dice", () => {
    const { rerender } = render(<HealthChoroplethPanel {...props} />);
    expect(screen.queryByTestId("health-breakdown")).toBeNull();
    rerender(<HealthChoroplethPanel {...props} selected={{ cut: "04101", name: "La Serena" }} breakdownError="boom" />);
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});

describe("ficha", () => {
  const tipos: HealthTipoRow[] = [
    { tipo_norm: "hospital", tipo_label: "Hospital", clase: "hospitalario", alta_hospital: true, alta_ampliada: true, evidence: "Evidencia de prueba." },
    { tipo_norm: "clínica", tipo_label: "Clínica", clase: "mixto", alta_hospital: false, alta_ampliada: true, evidence: "No se imputa." },
  ];
  const summary: HealthSummaryRow[] = [
    { dimension: "total", value: "todos", n: 10 }, { dimension: "estado", value: "vigente", n: 9 }, { dimension: "estado", value: "cerrado", n: 1 },
    { dimension: "alta_hospital_vigentes", value: "si", n: 2 }, { dimension: "alta_ampliada_vigentes", value: "si", n: 3 }, { dimension: "alta_fuera_de_ambas_vigentes", value: "si", n: 1 },
    { dimension: "clase_fuente", value: "oficial", n: 7 }, { dimension: "clase_fuente", value: "tabla", n: 1 }, { dimension: "clase_fuente", value: "sin_clasificar", n: 1 },
    { dimension: "geo_status", value: "0", n: 8 }, { dimension: "geo_status", value: "3", n: 1 },
  ];

  it("muestra definiciones D1/D2, cifras, la tabla de clasificación y lo que la capa NO dice", () => {
    render(<HealthFichaDialog open onClose={() => {}} summary={summary} tipos={tipos} tiposError={null} summaryError={null} />);
    const t = screen.getByTestId("health-ficha").textContent ?? "";
    expect(t).toContain(ALTA_LABEL.hospital);
    expect(t).toContain(ALTA_LABEL.ampliada);
    expect(t).toContain("tipo «Otro» o «SAMU»");
    expect(t).toContain("dependencia administrativa «Privado»");
    expect(screen.getByTestId("health-ficha-summary").textContent).toContain("2 hospitales");
    expect(screen.getByTestId("health-ficha-summary").textContent).toContain("1 imputada por la tabla");
    expect(screen.getByTestId("health-tipos").textContent).toContain("Mixto (no se imputa)");
    expect(t).toContain("Qué NO dice esta capa");
    expect(t).toContain("decisión de diseño");
    expect(screen.getByTestId("health-ficha-heterogeneity").textContent).toContain("NO es oferta");
    expect(t).toContain("Se cuentan TODOS los tipos de establecimiento");
  });

  it("errores de lectura se muestran, no se disfrazan", () => {
    render(<HealthFichaDialog open onClose={() => {}} summary={undefined} tipos={undefined} tiposError="sin permiso" summaryError="boom" />);
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("sin permiso");
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("boom");
  });
});
