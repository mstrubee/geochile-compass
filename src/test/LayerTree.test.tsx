import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { LayerNode } from "@/types/layerNodes";
import { LayerTree } from "@/components/layerTree/LayerTree";
import { analyzeTree, buildLayerTree, withFeaturePreviews, type FeaturePreview, type TreeRow } from "@/utils/layerTree";

const node = (over: Partial<LayerNode> & Pick<LayerNode, "id" | "kind" | "name">): LayerNode => ({
  parent_id: null,
  position: "a0",
  style: {},
  scope: "shared",
  owner_id: null,
  archived_at: null,
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
  ...over,
});

/**
 *  Farmacias (F1)
 *    Cruz Verde (L1, 10 pts)
 *    Salcobrand (L2, 5 pts)
 *  Retail (F2)
 *    Falabella (L3, 0 pts)
 *  Vacía (F3)
 */
const nodes: LayerNode[] = [
  node({ id: "F1", kind: "folder", name: "Farmacias", position: "a0" }),
  node({ id: "L1", kind: "layer", name: "Cruz Verde", parent_id: "F1", position: "a0" }),
  node({ id: "L2", kind: "layer", name: "Salcobrand", parent_id: "F1", position: "a1" }),
  node({ id: "F2", kind: "folder", name: "Retail", position: "a1" }),
  node({ id: "L3", kind: "layer", name: "Falabella", parent_id: "F2", position: "a0" }),
  node({ id: "F3", kind: "folder", name: "Vacía", position: "a2" }),
];
const counts = new Map([["L1", 10], ["L2", 5], ["L3", 0]]);

const setup = (opts: { visible?: string[]; searchTerm?: string; open?: Record<string, boolean>; previews?: Map<string, FeaturePreview> } = {}) => {
  const base = buildLayerTree(nodes, counts).roots;
  const roots = opts.previews ? withFeaturePreviews(base, opts.previews) : base;
  const handlers = {
    onToggleCheck: vi.fn<(row: TreeRow) => void>(),
    onOpenChange: vi.fn(),
    onOpenPoi: vi.fn<(row: TreeRow) => void>(),
    onLoadMore: vi.fn<(id: string) => void>(),
    onEditStyle: vi.fn(),
    onResetStyle: vi.fn(),
    onMatchCountChange: vi.fn<(n: number) => void>(),
  };
  const utils = render(
    <LayerTree
      roots={roots}
      analysis={analyzeTree(base, new Set(opts.visible ?? []))}
      searchTerm={opts.searchTerm ?? ""}
      initialOpenState={opts.open}
      {...handlers}
    />,
  );
  return { ...utils, ...handlers };
};

/** El árbol agenda enfoque y desplazamiento con setTimeout: se vacía dentro de act para no dejar avisos. */
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
    await new Promise((r) => setTimeout(r, 0));
  });
};

const names = () => screen.queryAllByRole("treeitem").map((el) => el.textContent ?? "");

describe("LayerTree", () => {
  it("parte con las carpetas cerradas", () => {
    setup();
    expect(names().map((n) => n.replace(/[\d/]+$/, ""))).toEqual(["Farmacias", "Retail", "Vacía"]);
  });

  it("recuerda las carpetas que estaban abiertas", () => {
    setup({ open: { F1: true } });
    expect(names().map((n) => n.replace(/\d+$/, ""))).toEqual(
      expect.arrayContaining(["Cruz Verde", "Salcobrand"]),
    );
    expect(screen.queryByText("Falabella")).toBeNull();
  });

  it("muestra la casilla intermedia cuando solo algunas capas están encendidas", () => {
    setup({ visible: ["L1"] });
    expect(screen.getByRole("checkbox", { name: "Mostrar u ocultar Farmacias" })).toHaveAttribute("aria-checked", "mixed");
    expect(screen.getByRole("checkbox", { name: "Mostrar u ocultar Retail" })).toHaveAttribute("aria-checked", "false");
  });

  it("marca la carpeta cuando todas sus capas están encendidas", () => {
    setup({ visible: ["L1", "L2"] });
    expect(screen.getByRole("checkbox", { name: "Mostrar u ocultar Farmacias" })).toHaveAttribute("aria-checked", "true");
  });

  it("una carpeta sin capas tiene la casilla deshabilitada", () => {
    setup();
    expect(screen.getByRole("checkbox", { name: "Mostrar u ocultar Vacía" })).toBeDisabled();
  });

  it("la casilla de una carpeta avisa a la carpeta y no la abre", async () => {
    const { onToggleCheck } = setup();
    await click(screen.getByRole("checkbox", { name: "Mostrar u ocultar Farmacias" }));
    expect(onToggleCheck).toHaveBeenCalledTimes(1);
    expect(onToggleCheck.mock.calls[0][0].id).toBe("F1");
    expect(screen.queryByText("Cruz Verde")).toBeNull();
  });

  it("el clic en una carpeta la abre y avisa el cambio", async () => {
    const { onOpenChange } = setup();
    await click(screen.getByText("Farmacias"));
    expect(screen.getByText("Cruz Verde")).toBeInTheDocument();
    expect(screen.getByText("Salcobrand")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith("F1", true, expect.objectContaining({ F1: true }));
  });

  it("el clic en una capa la enciende o apaga una sola vez", async () => {
    const { onToggleCheck } = setup({ open: { F1: true } });
    await click(screen.getByText("Cruz Verde"));
    expect(onToggleCheck).toHaveBeenCalledTimes(1);
    expect(onToggleCheck.mock.calls[0][0].id).toBe("L1");
  });

  it("la casilla de una capa no dispara además el clic de la fila", async () => {
    const { onToggleCheck } = setup({ open: { F1: true } });
    await click(screen.getByRole("checkbox", { name: "Mostrar u ocultar Cruz Verde" }));
    expect(onToggleCheck).toHaveBeenCalledTimes(1);
  });

  it("las capas con puntos se pueden expandir y las vacías son hoja", () => {
    setup({ open: { F1: true, F2: true } });
    const cruz = screen.getByText("Cruz Verde").closest("[role=treeitem]") as HTMLElement;
    const falabella = screen.getByText("Falabella").closest("[role=treeitem]") as HTMLElement;
    expect(within(cruz).getByRole("button", { name: "Expandir" })).toBeInTheDocument();
    expect(within(falabella).queryByRole("button", { name: /Expandir|Colapsar/ })).toBeNull();
  });

  it("muestra los puntos de una capa expandida y permite ir a uno", async () => {
    const previews = new Map<string, FeaturePreview>([
      ["L1", { items: [{ id: "p1", name: "Local Providencia", lat: -33.4, lng: -70.6 }], loading: false, error: false, hasMore: true }],
    ]);
    const { onOpenPoi, onLoadMore } = setup({ open: { F1: true, L1: true }, previews });
    await click(screen.getByText("Local Providencia"));
    expect(onOpenPoi).toHaveBeenCalledTimes(1);
    expect(onOpenPoi.mock.calls[0][0]).toMatchObject({ kind: "poi", lat: -33.4, lng: -70.6 });
    await click(screen.getByText(/^Ver más…/));
    expect(onLoadMore).toHaveBeenCalledWith("L1");
  });

  describe("búsqueda", () => {
    it("deja solo las coincidencias y sus carpetas, ya abiertas", () => {
      const { onMatchCountChange } = setup({ searchTerm: "cruz" });
      expect(screen.getByText("Farmacias")).toBeInTheDocument();
      expect(screen.getByText("Cruz Verde")).toBeInTheDocument();
      expect(screen.queryByText("Salcobrand")).toBeNull();
      expect(screen.queryByText("Retail")).toBeNull();
      expect(screen.queryByText("Vacía")).toBeNull();
      expect(onMatchCountChange).toHaveBeenLastCalledWith(1);
    });

    it("encontrar una carpeta muestra todo lo que contiene", () => {
      setup({ searchTerm: "farmacias" });
      expect(screen.getByText("Cruz Verde")).toBeInTheDocument();
      expect(screen.getByText("Salcobrand")).toBeInTheDocument();
      expect(screen.queryByText("Falabella")).toBeNull();
    });

    it("no distingue tildes ni mayúsculas", () => {
      setup({ searchTerm: "VACIA" });
      expect(screen.getByText("Vacía")).toBeInTheDocument();
    });

    it("sin coincidencias no deja filas y avisa 0", () => {
      const { onMatchCountChange } = setup({ searchTerm: "zzz" });
      expect(names()).toEqual([]);
      expect(onMatchCountChange).toHaveBeenLastCalledWith(0);
    });
  });
});
