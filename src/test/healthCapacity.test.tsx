/**
 * Capacidad de los hospitales (camas de dotación y ocupación, DEIS): popup con dato, sin dato, privado sin dato, período visible, errores y ausencia de pabellones.
 * Los datos son FIXTURES sintéticas (nombres «FIXTURE», códigos 9xxxxx): las cifras reales (Tisné, Buin) se verifican con los archivos reales en el informe del PR y en el runbook.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { HealthCapacity as Cap, HealthEstablishmentRow } from "@/types/health";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock, from: vi.fn() } }));

import { HealthCapacityBody } from "@/components/map/HealthCapacity";
import { HealthPopup } from "@/components/map/HealthPopup";
import { fetchHealthCapacity } from "@/services/healthService";
import { CAP_TEXT, fmtPct, indexText, monthLabel, yearLabel } from "@/utils/healthCapacity";

beforeEach(() => rpcMock.mockReset());

const wrap = (ui: ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

const SRC_REM = { name: "FIXTURE REM 20", origin_url: "https://example.test/indicadores_rem20_20991231.csv", sha256: "ab".repeat(32), declared_date: "2026-09-25", declared_date_note: "last_modified del recurso en CKAN",
  captured_at: "2026-10-20T12:00:00Z", period_start: "2014-01-01", period_end: "2026-08-31", license_label: "Creative Commons CCZero (CC0)", verification_status: "comprobado" };
const SRC_DOT = { name: "FIXTURE dotación", origin_url: "https://example.test/dotacion-2010-2025.xlsx", sha256: "cd".repeat(32), declared_date: "2025-10-20", declared_date_note: "cabecera HTTP Last-Modified del archivo",
  captured_at: "2026-10-20T12:05:00Z", period_start: "2010-01-01", period_end: "2025-12-31", license_label: "[NO COMPROBADO] el archivo no declara licencia ni condiciones de uso", verification_status: "comprobado" };
const NOT_READY = { dotacion: { client_ready: false, note: "Licencia del archivo de dotación [NO COMPROBADO]." }, ocupacion: { client_ready: false, note: "Campo nuevo sin evaluar." } };

const withData = (over: Partial<Cap> = {}): Cap => ({
  code: "900001", snss: true, dependencia_norm: "servicio_salud",
  dotacion: { year: 2025, total: 280, snapshot_id: "d", areas: [{ area: 330, nombre: "Área Pensionado", camas: 80 }, { area: 402, nombre: "Área Médica Adulto Cuidados Medios", camas: 200 }] },
  ocupacion_anual: { year: 2025, months: 12, expected_months: 12, snapshot_id: "r", ocupados: 1320, disponibles: 1920, indice: 68.75,
    areas: [{ area: 330, nombre: "Área Pensionado", ocupados: 120, disponibles: 480, indice: 25 }, { area: 402, nombre: "Área Médica Adulto Cuidados Medios", ocupados: 1200, disponibles: 1440, indice: 83.33 }] },
  ocupacion_mes: { period: "2026-08", snapshot_id: "r", ocupados: 95, disponibles: 100, indice: 95,
    areas: [{ area: 330, nombre: "Área Pensionado", ocupados: 5, disponibles: 0, indice: null }, { area: 402, nombre: "Área Médica Adulto Cuidados Medios", ocupados: 90, disponibles: 100, indice: 90 }] },
  fuentes: { dotacion: SRC_DOT, rem20: SRC_REM }, client_ready: NOT_READY, ...over,
});
const noData = (over: Partial<Cap> = {}): Cap => ({ code: "900002", snss: true, dependencia_norm: "servicio_salud", dotacion: null, ocupacion_anual: null, ocupacion_mes: null, fuentes: { dotacion: SRC_DOT, rem20: SRC_REM }, client_ready: NOT_READY, ...over });

const text = () => screen.getByTestId("health-capacity").textContent ?? "";

describe("utilidades de formato", () => {
  it("fmtPct: una decimal con coma; sin dato jamás es 0 %", () => {
    expect(fmtPct(84.83)).toBe("84,8 %");
    expect(fmtPct(100)).toBe("100,0 %");
    expect(fmtPct(0)).toBe("0,0 %");                       // un 0 real publicado sí es 0
    expect(fmtPct(null)).toBe("sin dato");
    expect(fmtPct(undefined)).toBe("sin dato");
  });
  it("monthLabel y yearLabel: el período siempre legible; un año incompleto lo dice", () => {
    expect(monthLabel("2026-08")).toBe("agosto 2026");
    expect(monthLabel("2025-12")).toBe("diciembre 2025");
    expect(monthLabel("xx")).toBe("xx");
    expect(yearLabel({ year: 2025, months: 12, expected_months: 12 } as never)).toBe("2025 (ene–dic)");
    expect(yearLabel({ year: 2025, months: 6, expected_months: 12 } as never)).toBe("2025 (6 de 12 meses informados)");
  });
  it("indexText: sin índice por denominador 0 lo explica y nunca muestra 0 %", () => {
    expect(indexText({ indice: null, disponibles: 0 })).toBe("sin dato (sin días-cama disponibles)");
    expect(indexText({ indice: null, disponibles: 10 })).toBe("sin dato");
    expect(indexText({ indice: 95, disponibles: 100 })).toBe("95,0 %");
  });
});

describe("HealthCapacityBody", () => {
  it("con dato: dotación con su año, ocupación del año con su período, último mes con su mes, y la nota «promedio del período, no en tiempo real»", () => {
    render(<HealthCapacityBody cap={withData()} />);
    expect(screen.getByTestId("cap-dotacion").textContent).toContain("Camas de dotación: 280 (2025)");
    const anual = screen.getByTestId("cap-ocupacion-anual").textContent ?? "";
    expect(anual).toContain("Ocupación 2025 (ene–dic): 68,8 %");
    expect(anual).toContain("1.320 días-cama ocupados de 1.920 disponibles");
    expect(anual).toContain(CAP_TEXT.avgNote);
    const mes = screen.getByTestId("cap-ocupacion-mes").textContent ?? "";
    expect(mes).toContain("Último mes publicado (agosto 2026): 95,0 %");
    expect(mes).toContain("95 días-cama ocupados de 100 disponibles");
    expect(mes).toContain(CAP_TEXT.avgNote);
    expect(screen.queryByTestId("cap-no-snss-note")).toBeNull();
  });

  it("desglose por área con la nota de que incluye Pensionado, psiquiatría y sociosanitario; el área sin días-cama disponibles dice «sin dato», no 0 %", () => {
    render(<HealthCapacityBody cap={withData()} />);
    const areas = screen.getByTestId("cap-areas");
    expect(areas.textContent).toContain("incluye Pensionado, psiquiatría y sociosanitario");
    expect(areas.textContent).toContain("Área Pensionado: 80");
    expect(areas.textContent).toContain("Área Médica Adulto Cuidados Medios: 200");
    expect(areas.textContent).toContain("Área Médica Adulto Cuidados Medios: 83,3 % (1.200 / 1.440)");
    expect(areas.textContent).toContain(CAP_TEXT.totalNote);
    expect(areas.textContent).not.toContain("0,0 %");
  });

  it("las fuentes se rotulan con licencia, fecha del archivo, descarga, período, hash y URL; la licencia de la dotación aparece como [NO COMPROBADO]", () => {
    render(<HealthCapacityBody cap={withData()} />);
    const dot = screen.getByTestId("cap-source-dotacion").textContent ?? "";
    expect(dot).toContain("[NO COMPROBADO]");
    expect(dot).toContain("Archivo del 2025-10-20");
    expect(dot).toContain("https://example.test/dotacion-2010-2025.xlsx");
    const rem = screen.getByTestId("cap-source-rem20").textContent ?? "";
    expect(rem).toContain("CC0");
    expect(rem).toContain("período 2014-01-01 a 2026-08-31");
    expect(rem).toContain("abababababab…");
    expect(screen.getByTestId("cap-sources").textContent).toContain(CAP_TEXT.dotacionDef);
    expect(screen.getByTestId("cap-sources").textContent).toContain("fórmula oficial del DEIS");
  });

  it("client_ready = false por campo: el popup lo dice y cita la nota de cada uno", () => {
    render(<HealthCapacityBody cap={withData()} />);
    const t = screen.getByTestId("cap-client-ready").textContent ?? "";
    expect(t).toContain("client_ready = false");
    expect(t).toContain("Camas de dotación — Licencia del archivo de dotación [NO COMPROBADO].");
    expect(t).toContain("Ocupación (REM 20) — Campo nuevo sin evaluar.");
  });

  it("año incompleto: el período dice cuántos meses hay y no se completa", () => {
    render(<HealthCapacityBody cap={withData({ ocupacion_anual: { ...withData().ocupacion_anual!, months: 6 } })} />);
    expect(screen.getByTestId("cap-ocupacion-anual").textContent).toContain("Ocupación 2025 (6 de 12 meses informados)");
  });

  it("un índice mayor a 100 % se muestra TAL CUAL (sin recortar) con el aviso de que la fuente lo permite", () => {
    render(<HealthCapacityBody cap={withData({ ocupacion_mes: { period: "2026-08", snapshot_id: "r", ocupados: 54, disponibles: 2, indice: 2700, areas: [] } })} />);
    const mes = screen.getByTestId("cap-ocupacion-mes").textContent ?? "";
    expect(mes).toContain("2.700,0 %");
    expect(mes).toContain(CAP_TEXT.over100);
    expect(screen.getByTestId("cap-ocupacion-anual").textContent).not.toContain(CAP_TEXT.over100);
  });

  it("sin dato (hospital público sin filas en el período): todo «sin dato», sin nota de red pública ni inventar ceros", () => {
    render(<HealthCapacityBody cap={noData()} />);
    expect(screen.getByTestId("cap-dotacion").textContent).toBe("Camas de dotación: sin dato");
    expect(screen.getByTestId("cap-ocupacion-anual").textContent).toBe("Ocupación del último año completo: sin dato");
    expect(screen.getByTestId("cap-ocupacion-mes").textContent).toBe("Último mes publicado: sin dato");
    expect(screen.queryByTestId("cap-no-snss-note")).toBeNull();
    expect(screen.queryByTestId("cap-areas")).toBeNull();
    expect(text()).not.toMatch(/\b0 camas\b|\b0,0 %/);
  });

  it("privado SIN dato: «sin dato» en todo y la nota explicativa de que se reporta por la red pública", () => {
    render(<HealthCapacityBody cap={noData({ snss: false, dependencia_norm: "privado" })} />);
    expect(screen.getByTestId("cap-dotacion").textContent).toBe("Camas de dotación: sin dato");
    expect(screen.getByTestId("cap-ocupacion-anual").textContent).toContain("sin dato");
    expect(screen.getByTestId("cap-no-snss-note").textContent).toBe(CAP_TEXT.publicOnly);
  });

  it("FF.AA. y otras dependencias no SNSS: la misma nota; un no SNSS CON dato no la muestra (solo se explica la ausencia)", () => {
    const { rerender } = render(<HealthCapacityBody cap={noData({ snss: false, dependencia_norm: "armada" })} />);
    expect(screen.getByTestId("cap-no-snss-note")).toBeTruthy();
    rerender(<HealthCapacityBody cap={withData({ snss: false, dependencia_norm: "armada" })} />);
    expect(screen.queryByTestId("cap-no-snss-note")).toBeNull();
  });

  it("dotación sin la fila «Total» del último año: «sin dato» y se explica; las áreas publicadas se muestran sin sumarlas", () => {
    render(<HealthCapacityBody cap={withData({ dotacion: { year: 2025, total: null, snapshot_id: "d", areas: [{ area: 403, nombre: "Área Médico-Quirúrgico Cuidados Básicos", camas: 5 }] } })} />);
    const d = screen.getByTestId("cap-dotacion").textContent ?? "";
    expect(d).toContain("Camas de dotación: sin dato");
    expect(d).toContain("no trae la fila «Total» de 2025");
    expect(screen.getByTestId("cap-areas").textContent).toContain("Área Médico-Quirúrgico Cuidados Básicos: 5");
  });

  it("NO hay pabellones: ni el campo ni «sin dato de pabellones» (llegan con otra fuente, en otro PR)", () => {
    const { container, rerender } = render(<HealthCapacityBody cap={withData()} />);
    expect(container.textContent).not.toMatch(/pabell|quir[óo]fano|A21/i);
    rerender(<HealthCapacityBody cap={noData({ snss: false })} />);
    expect(container.textContent).not.toMatch(/pabell|quir[óo]fano|A21/i);
  });
});

describe("HealthPopup de un hospital", () => {
  const est = (over: Partial<HealthEstablishmentRow> = {}): HealthEstablishmentRow => ({
    code: "900001", name: "FIXTURE Hospital", tipo_glosa: "Hospital", comuna_cut: "13101", comuna_name: "Santiago", dependencia_norm: "servicio_salud", complejidad: "alta",
    tipo_atencion: "hospitalaria", clase_servicio: "hospitalario", clase_fuente: "oficial", estado: "vigente", alta_hospital: true, alta_ampliada: true, tiene_urgencia: true,
    address: null, lon: -70.65, lat: -33.45, geo_status: 0, geo_distance_m: null, total_matching: 1, snapshot_id: "s", captured_at: "2026-10-17T12:00:00Z", ...over,
  });

  it("pide la capacidad con el código del hospital y la muestra dentro del popup", async () => {
    rpcMock.mockResolvedValue({ data: withData(), error: null });
    render(wrap(<HealthPopup row={est()} />));
    expect(screen.getByTestId("cap-loading")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("health-capacity")).toBeTruthy());
    expect(rpcMock).toHaveBeenCalledWith("get_health_capacity", { p_code: "900001" });
    const popup = screen.getByTestId("health-popup");
    expect(within(popup).getByTestId("cap-dotacion").textContent).toContain("280 (2025)");
    expect(popup.textContent).toContain("Ocupación 2025 (ene–dic): 68,8 %");
  });

  it("un hospital privado sin dato muestra «sin dato» y la nota dentro del popup", async () => {
    rpcMock.mockResolvedValue({ data: noData({ snss: false, dependencia_norm: "privado" }), error: null });
    render(wrap(<HealthPopup row={est({ dependencia_norm: "privado" })} />));
    await waitFor(() => expect(screen.getByTestId("cap-no-snss-note")).toBeTruthy());
    expect(screen.getByTestId("cap-dotacion").textContent).toContain("sin dato");
    expect(screen.getByTestId("health-popup").textContent).toContain(CAP_TEXT.publicOnly);
  });

  it("si la RPC falla se MUESTRA el error: no se disfraza de «sin dato»", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    render(wrap(<HealthPopup row={est()} />));
    await waitFor(() => expect(screen.getByTestId("cap-error")).toBeTruthy(), { timeout: 5000 });          // el hook reintenta una vez (retry: 1) antes de mostrar el error
    expect(screen.getByTestId("cap-error").textContent).toContain("permission denied");
    expect(screen.queryByTestId("cap-dotacion")).toBeNull();
  });

  it("un establecimiento ambulatorio NO pide ni muestra capacidad", () => {
    render(wrap(<HealthPopup row={est({ clase_servicio: "ambulatorio", tipo_glosa: "Consultorio" })} />));
    expect(screen.queryByTestId("health-capacity")).toBeNull();
    expect(screen.queryByTestId("cap-loading")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("el popup aclara que el registro por sí solo no mide capacidad (la capacidad viene de fuentes aparte)", async () => {
    rpcMock.mockResolvedValue({ data: withData(), error: null });
    render(wrap(<HealthPopup row={est()} />));
    await waitFor(() => expect(screen.getByTestId("health-capacity")).toBeTruthy());
    expect(screen.getByTestId("health-popup").textContent).toContain("por sí solo NO mide capacidad");
  });
});

describe("fetchHealthCapacity", () => {
  it("llama a get_health_capacity con p_code, devuelve el objeto y propaga el error", async () => {
    rpcMock.mockResolvedValueOnce({ data: withData(), error: null });
    expect((await fetchHealthCapacity("900001"))?.dotacion?.total).toBe(280);
    expect(rpcMock).toHaveBeenCalledWith("get_health_capacity", { p_code: "900001" });
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchHealthCapacity("900001")).toBeNull();
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(fetchHealthCapacity("900001")).rejects.toThrow("boom");
  });
});
