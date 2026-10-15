import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const db = vi.hoisted(() => ({
  tables: [] as string[],
  filters: [] as { table: string; method: string; args: unknown[] }[],
  nodes: [] as Record<string, unknown>[],
  layers: [] as Record<string, unknown>[],
  failLayersView: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      db.tables.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order"]) {
        q[m] = (...args: unknown[]) => {
          db.filters.push({ table, method: m, args });
          return q;
        };
      }
      q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
        let result: { data: unknown; error: { message: string } | null };
        if (table === "layer_nodes") result = { data: db.nodes, error: null };
        else if (table === "territorial_layers_active" && db.failLayersView) result = { data: null, error: { message: "no existe la vista" } };
        else result = { data: db.layers, error: null };
        return Promise.resolve(result).then(ok, bad);
      };
      return q;
    },
  },
}));

import { useTerritorialLayers } from "@/hooks/useTerritorialLayers";

const root = (id: string, name: string, position: string, style: Record<string, unknown> = {}) => ({
  id, kind: "folder", name, parent_id: null, position, style, scope: "shared", owner_id: null, archived_at: null,
  created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z",
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("useTerritorialLayers — los grupos salen del árbol", () => {
  beforeEach(() => {
    db.tables = [];
    db.filters = [];
    db.failLayersView = false;
    db.nodes = [root("F2", "Retail / Tiendas", "a1", { slug: "retail", color: "#EC4899" }), root("F1", "Farmacias", "a0", { slug: "farmacias" })];
    db.layers = [{ id: "L1", group_id: "F1", name: "Cruz Verde", order_index: 0 }];
  });

  it("lee las carpetas raíz y las capas activas, y ya no toca territorial_layer_groups", async () => {
    const { result } = renderHook(() => useTerritorialLayers(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(db.tables.sort()).toEqual(["layer_nodes", "territorial_layers_active"]);
    expect(db.tables.some((t) => t.startsWith("territorial_layer_groups"))).toBe(false);
    expect(result.current.groups.map((g) => [g.id, g.slug, g.order_index])).toEqual([["F1", "farmacias", 0], ["F2", "retail", 1]]);
    expect(result.current.layers).toHaveLength(1);
  });

  it("pide solo raíces, compartidas y no archivadas", async () => {
    const { result } = renderHook(() => useTerritorialLayers(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const f = db.filters.filter((x) => x.table === "layer_nodes");
    expect(f).toEqual(
      expect.arrayContaining([
        { table: "layer_nodes", method: "eq", args: ["kind", "folder"] },
        { table: "layer_nodes", method: "is", args: ["parent_id", null] },
        { table: "layer_nodes", method: "is", args: ["archived_at", null] },
        { table: "layer_nodes", method: "eq", args: ["scope", "shared"] },
      ]),
    );
  });

  it("si la vista de capas activas no existe aún, cae a la tabla (el código puede llegar antes que la migración)", async () => {
    db.failLayersView = true;
    const { result } = renderHook(() => useTerritorialLayers(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(db.tables).toContain("territorial_layers");
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.groups).toHaveLength(2);
  });
});
