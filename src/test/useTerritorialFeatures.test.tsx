import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Una "base" de puntos por capa que los tests pueden cambiar entre lecturas.
const db = vi.hoisted(() => ({
  features: {} as Record<string, { id: string; layer_id: string; name: string; lat: number; lng: number }[]>,
  reads: 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let layerId = "";
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, v: string) => {
        if (col === "layer_id") layerId = v;
        return q;
      };
      q.maybeSingle = () => Promise.resolve({ data: { feature_count: (db.features[layerId] ?? []).length }, error: null });
      q.range = (from: number, to: number) => {
        if (table === "territorial_features") db.reads++;
        return Promise.resolve({ data: (db.features[layerId] ?? []).slice(from, to + 1), error: null });
      };
      return q;
    },
  },
}));

import { clearTerritorialFeaturesCache, useTerritorialFeatures } from "@/hooks/useTerritorialLayers";

const pt = (layer: string, id: string, name: string) => ({ id, layer_id: layer, name, lat: -33.4, lng: -70.6 });
const names = (fs: { name: string | null }[]) => fs.map((f) => f.name).sort();

describe("useTerritorialFeatures — caché de puntos por capa", () => {
  beforeEach(() => {
    clearTerritorialFeaturesCache();
    db.reads = 0;
    db.features = { L1: [pt("L1", "a", "Antes 1"), pt("L1", "b", "Antes 2")] };
  });

  it("una segunda lectura sale del caché (no vuelve a la base)", async () => {
    const first = renderHook(() => useTerritorialFeatures(["L1"]));
    await waitFor(() => expect(first.result.current).toHaveLength(2));
    const reads = db.reads;
    const second = renderHook(() => useTerritorialFeatures(["L1"]));
    await waitFor(() => expect(second.result.current).toHaveLength(2));
    expect(db.reads).toBe(reads);
  });

  it("al invalidar el caché, el mapa ya montado vuelve a pedir los puntos y muestra los nuevos", async () => {
    const { result } = renderHook(() => useTerritorialFeatures(["L1"]));
    await waitFor(() => expect(names(result.current)).toEqual(["Antes 1", "Antes 2"]));

    // Se reemplazó el contenido de la capa (lo que hace el asistente de importación).
    db.features.L1 = [pt("L1", "c", "Después 1"), pt("L1", "d", "Después 2"), pt("L1", "e", "Después 3")];
    // Sin invalidar, sigue mostrando lo viejo.
    expect(names(result.current)).toEqual(["Antes 1", "Antes 2"]);

    act(() => clearTerritorialFeaturesCache());
    await waitFor(() => expect(names(result.current)).toEqual(["Después 1", "Después 2", "Después 3"]));
  });

  it("invalidar una sola capa olvida solo esa", async () => {
    db.features.L2 = [pt("L2", "z", "Otra")];
    const { result } = renderHook(() => useTerritorialFeatures(["L1", "L2"]));
    await waitFor(() => expect(result.current).toHaveLength(3));
    const reads = db.reads;
    db.features.L1 = [pt("L1", "n", "Nueva")];
    act(() => clearTerritorialFeaturesCache("L1"));
    await waitFor(() => expect(names(result.current)).toEqual(["Nueva", "Otra"]));
    // L2 no se volvió a leer: 1 lectura más (solo L1).
    expect(db.reads).toBe(reads + 1);
  });
});
