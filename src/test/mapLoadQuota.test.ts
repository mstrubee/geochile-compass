import { describe, it, expect, vi, beforeEach } from "vitest";

const consume = vi.fn();
vi.mock("@/services/apiQuotaService", () => ({ consumeApiQuota: (...a: unknown[]) => consume(...a) }));

const okSession = (hours = 24) => ({
  ok: true,
  json: async () => ({ session: "S", expiry: new Date(Date.now() + hours * 3_600_000).toISOString() }),
});

describe("cuota del mapa = cargas de mapa (con caché de sesión)", () => {
  beforeEach(() => {
    vi.resetModules(); // vacía la caché en memoria, como una recarga de página
    consume.mockReset();
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => okSession()));
  });

  it("una sesión nueva descuenta una carga; recargar la página la reutiliza gratis", async () => {
    consume.mockResolvedValue(true);
    const first = await import("@/services/googleMapsService");
    await first.createGoogleTileSession("KEY12345678", "roadmap");
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith("maps_js");

    vi.resetModules(); // "recarga": memoria vacía, localStorage intacto
    const second = await import("@/services/googleMapsService");
    const s = await second.createGoogleTileSession("KEY12345678", "roadmap");
    expect(s?.session).toBe("S");
    expect(consume).toHaveBeenCalledTimes(1); // sin gasto nuevo
    expect(fetch).toHaveBeenCalledTimes(1); // sin llamada nueva a Google
  });

  it("una sesión vencida o de otra API key no se reutiliza", async () => {
    consume.mockResolvedValue(true);
    const m = await import("@/services/googleMapsService");
    await m.createGoogleTileSession("KEY12345678", "roadmap");

    vi.resetModules();
    const otraKey = await import("@/services/googleMapsService");
    await otraKey.createGoogleTileSession("OTRA-KEY-999", "roadmap");
    expect(consume).toHaveBeenCalledTimes(2);

    vi.resetModules();
    localStorage.setItem(
      "geoplanet_google_tile_sessions_v1",
      JSON.stringify({ roadmap: { session: "OLD", expiry: Date.now() - 1000, mapType: "roadmap", key: "OTRA-KEY-999".slice(-8) } }),
    );
    const venc = await import("@/services/googleMapsService");
    const s = await venc.createGoogleTileSession("OTRA-KEY-999", "roadmap");
    expect(s?.session).toBe("S");
    expect(consume).toHaveBeenCalledTimes(3);
  });

  it("si la cuota está agotada no crea sesión", async () => {
    consume.mockResolvedValue(false);
    const m = await import("@/services/googleMapsService");
    expect(await m.createGoogleTileSession("KEY12345678", "roadmap")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("repetir la misma búsqueda de Autocomplete no vuelve a gastar cuota", async () => {
    consume.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        suggestions: [{ placePrediction: {
          placeId: "p1", text: { text: "Providencia 1234" },
          structuredFormat: { mainText: { text: "Providencia 1234" }, secondaryText: { text: "Santiago" } },
        } }],
      }),
    })));
    const m = await import("@/services/googleMapsService");
    const a = await m.placesAutocomplete("Providencia", "K", "tok");
    const b = await m.placesAutocomplete("  providencia ", "K", "tok");
    expect(b).toEqual(a);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
