import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const rpcMock = vi.fn();
// Implementación "cruda" para simular caídas de red: un espía que devuelve una promesa
// rechazada la deja sin manejar y vitest lo cuenta como error del test.
let rawRpc: ((...a: unknown[]) => unknown) | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => (rawRpc ? rawRpc(...a) : rpcMock(...a)) },
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useGoogleMapsKey", () => ({ useGoogleMapsKey: () => "KEY" }));

import { consumeApiQuota } from "@/services/apiQuotaService";
import { ApiQuotaAdminSection } from "@/components/admin/ApiQuotaAdminSection";

const status = {
  period: "2026-10-01",
  period_end: "2026-11-01",
  apis: [
    { api: "maps_js", label: "Google Maps JavaScript API (cargas de mapa)", free_limit: 10000, extra_authorized: 0, limit: 10000, used: 250 },
    { api: "places", label: "Places API (detalle y búsqueda de lugares)", free_limit: 5000, extra_authorized: 1000, limit: 6000, used: 6000 },
    { api: "autocomplete", label: "Autocomplete (sugerencias del buscador)", free_limit: 10000, extra_authorized: 0, limit: 10000, used: 9500 },
    { api: "geocoding", label: "Geocoding API (dirección → coordenadas)", free_limit: 10000, extra_authorized: 0, limit: 10000, used: 0 },
  ],
};

describe("consumeApiQuota (falla cerrado)", () => {
  beforeEach(() => { rawRpc = null; rpcMock.mockReset(); });

  it("permite solo cuando el servidor lo permite", async () => {
    rpcMock.mockResolvedValue({ data: { allowed: true, used: 1, limit: 10 }, error: null });
    expect(await consumeApiQuota("geocoding")).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("consume_api_quota", { p_api: "geocoding", p_n: 1 });
  });

  it("niega cuando el límite se agotó", async () => {
    rpcMock.mockResolvedValue({ data: { allowed: false, used: 10, limit: 10 }, error: null });
    expect(await consumeApiQuota("autocomplete")).toBe(false);
  });

  it("niega si el RPC devuelve error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await consumeApiQuota("places")).toBe(false);
  });

  it("niega si la red falla", async () => {
    rawRpc = () => Promise.reject(new Error("offline"));
    expect(await consumeApiQuota("maps_js")).toBe(false);
  });
});

describe("ApiQuotaAdminSection", () => {
  beforeEach(() => {
    rawRpc = null;
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "get_api_quota_status") return { data: status, error: null };
      if (fn === "has_api_quota_password") return { data: true, error: null };
      if (fn === "list_api_quota_extensions") return { data: [], error: null };
      if (fn === "extend_api_quota") return { data: { ok: false, error: "bad_password", message: "Contraseña incorrecta." }, error: null };
      return { data: null, error: null };
    });
  });

  it("muestra un módulo por API con su conteo y marca la agotada como bloqueada", async () => {
    render(<ApiQuotaAdminSection />);
    expect(await screen.findByText("Google Maps JavaScript API (cargas de mapa)")).toBeTruthy();
    expect(screen.getByText("Autocomplete (sugerencias del buscador)")).toBeTruthy();
    expect(screen.getByText("Geocoding API (dirección → coordenadas)")).toBeTruthy();
    expect(screen.getByText(/250 \/ 10\.000 llamadas/)).toBeTruthy();
    expect(screen.getAllByText(/Bloqueada/)).toHaveLength(1); // solo Places (6.000/6.000)
    expect(screen.getAllByRole("button", { name: /Autorizar \+1\.000/ })).toHaveLength(4);
  });

  it("ampliar pide contraseña y muestra el error del servidor si es incorrecta", async () => {
    render(<ApiQuotaAdminSection />);
    const buttons = await screen.findAllByRole("button", { name: /Autorizar \+1\.000/ });
    fireEvent.click(buttons[1]);
    const input = await screen.findByLabelText("Contraseña de ampliaciones");
    fireEvent.change(input, { target: { value: "mala-clave" } });
    fireEvent.click(screen.getByRole("button", { name: "Autorizar" }));
    await waitFor(() => expect(screen.getByText("Contraseña incorrecta.")).toBeTruthy());
    expect(rpcMock).toHaveBeenCalledWith("extend_api_quota", { p_api: "places", p_password: "mala-clave" });
  });

  it("sin contraseña definida las ampliaciones quedan deshabilitadas", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "get_api_quota_status") return { data: status, error: null };
      if (fn === "has_api_quota_password") return { data: false, error: null };
      return { data: [], error: null };
    });
    render(<ApiQuotaAdminSection />);
    const buttons = await screen.findAllByRole("button", { name: /Autorizar \+1\.000/ });
    buttons.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText("Sin definir")).toBeTruthy();
  });
});
