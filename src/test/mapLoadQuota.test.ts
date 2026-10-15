import { describe, it, expect, vi, beforeEach } from "vitest";

const consume = vi.fn();
vi.mock("@/services/apiQuotaService", () => ({ consumeApiQuota: (...a: unknown[]) => consume(...a) }));

describe("cuota del mapa = cargas de mapa", () => {
  beforeEach(() => {
    vi.resetModules();
    consume.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ session: "S", expiry: new Date(Date.now() + 86_400_000).toISOString() }),
    })));
  });

  it("cambiar de mapa base no descuenta otra carga", async () => {
    consume.mockResolvedValue(true);
    const { createGoogleTileSession } = await import("@/services/googleMapsService");
    await createGoogleTileSession("K", "roadmap");
    await createGoogleTileSession("K", "satellite");
    await createGoogleTileSession("K", "hybrid");
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith("maps_js");
  });

  it("si la cuota está agotada no crea sesión y reintenta la verificación", async () => {
    consume.mockResolvedValue(false);
    const { createGoogleTileSession } = await import("@/services/googleMapsService");
    expect(await createGoogleTileSession("K", "roadmap")).toBeNull();
    expect(await createGoogleTileSession("K", "satellite")).toBeNull();
    expect(consume).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
