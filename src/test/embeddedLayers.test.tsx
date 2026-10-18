/** CASEN ya no tiene nodo propio en el árbol: vive dentro del panel Isapre. Su fila temática (client_ready, dataset) sigue en la base. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const db = vi.hoisted(() => ({ nodes: [] as unknown[], counts: [] as unknown[], thematic: [] as unknown[], thematicError: null as null | { message: string } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "is", "order", "range", "eq"]) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
        const r = table === "layer_nodes" ? { data: db.nodes, error: null }
          : table === "territorial_layers" ? { data: db.counts, error: null }
          : table === "thematic_layers" ? { data: db.thematicError ? null : db.thematic, error: db.thematicError }
          : { data: [], error: null };
        return Promise.resolve(r).then(ok, bad);
      };
      return q;
    },
  },
}));

import { useLayerTreeData } from "@/hooks/useLayerTree";
import { EMBEDDED_RENDERERS, withoutEmbedded } from "@/utils/embeddedLayers";

const node = (id: string, name: string, kind: "folder" | "layer", parent: string | null, position: string) => ({
  id, kind, name, parent_id: parent, position, style: {}, scope: "shared", owner_id: null, archived_at: null, created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z",
});
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => {
  db.thematicError = null;
  db.nodes = [node("SALUD", "Salud", "folder", null, "a0"), node("ISA", "Isapre: beneficiarios por comuna", "layer", "SALUD", "a0"), node("CAS", "Previsión regional (CASEN, estimada)", "layer", "SALUD", "a1"), node("EST", "Establecimientos por comuna", "layer", "SALUD", "a2")];
  db.counts = [];
  db.thematic = [{ layer_id: "ISA", renderer: "choropleth_isapre" }, { layer_id: "CAS", renderer: "panel_casen_region" }, { layer_id: "EST", renderer: "choropleth_health" }];
});

describe("nodo CASEN independiente", () => {
  it("el árbol de capas NO trae el nodo «Previsión regional (CASEN…)»: Isapre y Establecimientos sí", async () => {
    const { result } = renderHook(() => useLayerTreeData(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const names = result.current.data!.nodes.map((n) => n.name);
    expect(names).toEqual(["Salud", "Isapre: beneficiarios por comuna", "Establecimientos por comuna"]);
    expect(names.some((n) => /CASEN/i.test(n))).toBe(false);
  });

  it("sin la fila temática (tabla ausente o sin permiso) no se oculta nada: el árbol sigue como estaba", async () => {
    db.thematicError = { message: "relation thematic_layers does not exist" };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useLayerTreeData(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.nodes).toHaveLength(4);
  });

  it("solo se ocultan los renderers incrustados: choropleth_isapre y choropleth_health siguen con su nodo", () => {
    expect([...EMBEDDED_RENDERERS]).toEqual(["panel_casen_region"]);
    const items = [{ id: "A" }, { id: "B" }, { id: "C" }];
    expect(withoutEmbedded(items, new Set(["B"])).map((i) => i.id)).toEqual(["A", "C"]);
    expect(withoutEmbedded(items, new Set())).toEqual(items);
  });
});
