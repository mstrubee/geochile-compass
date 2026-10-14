import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TerritorialVisibilityProvider } from "@/hooks/useTerritorialVisibility";
import { LayerTreeSection } from "@/components/layerTree/LayerTreeSection";

// ── Base simulada ─────────────────────────────────────────────────────────────
const db = vi.hoisted(() => ({
  nodes: [] as Record<string, unknown>[],
  layers: [] as { id: string; feature_count: number }[],
  features: {} as Record<string, { id: string; name: string | null; lat: number; lng: number }[]>,
  failNodes: false,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let layerId = "";
      let range: [number, number] = [0, 999];
      const q: Record<string, unknown> = {};
      const chain = (method: string) => (...args: unknown[]) => {
        db.calls.push({ table, method, args });
        if (method === "eq" && args[0] === "layer_id") layerId = String(args[1]);
        if (method === "range") range = [Number(args[0]), Number(args[1])];
        return q;
      };
      for (const m of ["select", "is", "eq", "order", "range"]) q[m] = chain(m);
      q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
        let result: { data: unknown; error: { message: string } | null };
        if (table === "layer_nodes") result = db.failNodes ? { data: null, error: { message: "boom" } } : { data: db.nodes, error: null };
        else if (table === "territorial_layers") result = { data: db.layers, error: null };
        else result = { data: (db.features[layerId] ?? []).slice(range[0], range[1] + 1), error: null };
        return Promise.resolve(result).then(ok, bad);
      };
      return q;
    },
  },
}));

// Diálogos pesados que esta prueba no ejerce.
vi.mock("@/components/panels/TerritorialLayerManagerDialog", () => ({ TerritorialLayerManagerDialog: () => null }));
vi.mock("@/components/panels/BrandStyleEditorDialog", () => ({ BrandStyleEditorDialog: () => null }));
// El asistente de importación tiene sus propias pruebas; acá solo importa cómo se abre.
vi.mock("@/components/layerImport/ImportWizard", () => ({
  ImportWizard: (p: { file: File; initialMode: string; initialTargetId: string | null; onClose: () => void }) => (
    <div data-testid="wizard" data-file={p.file.name} data-mode={p.initialMode} data-target={p.initialTargetId ?? ""}>
      <button type="button" onClick={p.onClose}>cerrar asistente</button>
    </div>
  ),
}));

// ── Datos ─────────────────────────────────────────────────────────────────────
const nodeRow = (id: string, kind: "folder" | "layer", name: string, parent_id: string | null, position: string) => ({
  id,
  kind,
  name,
  parent_id,
  position,
  style: {},
  scope: "shared",
  owner_id: null,
  archived_at: null,
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
});

const seed = (counts: Record<string, number> = { L1: 10, L2: 5, L3: 2 }) => {
  db.failNodes = false;
  db.calls = [];
  db.nodes = [
    nodeRow("F1", "folder", "Farmacias", null, "a0"),
    nodeRow("L1", "layer", "Cruz Verde", "F1", "a0"),
    nodeRow("L2", "layer", "Salcobrand", "F1", "a1"),
    nodeRow("F2", "folder", "Retail", null, "a1"),
    nodeRow("L3", "layer", "Falabella", "F2", "a0"),
  ];
  db.layers = Object.entries(counts).map(([id, feature_count]) => ({ id, feature_count }));
  db.features = {};
};

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <TerritorialVisibilityProvider>{children}</TerritorialVisibilityProvider>
    </QueryClientProvider>
  );
};

const mount = async (props: { onFlyToPoint?: (lat: number, lng: number) => void; isAdmin?: boolean } = {}) => {
  const utils = render(<LayerTreeSection {...props} />, { wrapper });
  await screen.findByText("Farmacias");
  return utils;
};

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
    await new Promise((r) => setTimeout(r, 0));
  });
};
const box = (name: string) => screen.getByRole("checkbox", { name: `Mostrar u ocultar ${name}` });

beforeEach(() => {
  localStorage.clear();
  seed();
});

describe("LayerTreeSection", () => {
  it("carga el árbol y pide solo lo activo", async () => {
    await mount();
    expect(screen.getByText("Retail")).toBeInTheDocument();
    expect(db.calls).toContainEqual({ table: "layer_nodes", method: "is", args: ["archived_at", null] });
    // Ningún punto se pide hasta que alguien expande una capa.
    expect(db.calls.some((c) => c.table === "territorial_features")).toBe(false);
  });

  it("marcar una carpeta enciende todas sus capas y la desmarca las apaga", async () => {
    await mount();
    expect(screen.getByText("0/2")).toBeInTheDocument();
    await click(box("Farmacias"));
    await waitFor(() => expect(box("Farmacias")).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(box("Retail")).toHaveAttribute("aria-checked", "false");
    await click(box("Farmacias"));
    await waitFor(() => expect(box("Farmacias")).toHaveAttribute("aria-checked", "false"));
  });

  it("encender una sola capa deja la carpeta en estado intermedio", async () => {
    await mount();
    await click(screen.getByText("Farmacias")); // abre
    await click(box("Cruz Verde"));
    await waitFor(() => expect(box("Farmacias")).toHaveAttribute("aria-checked", "mixed"));
    expect(screen.getByText("1/2")).toBeInTheDocument();
    // Una carpeta intermedia, al marcarla, enciende todo.
    await click(box("Farmacias"));
    await waitFor(() => expect(box("Farmacias")).toHaveAttribute("aria-checked", "true"));
  });

  it("la visibilidad queda guardada en la clave que ya lee el mapa", async () => {
    await mount();
    await click(box("Retail"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("territorial_visible_v2") ?? "[]")).toEqual(["L3"]));
  });

  describe("carga masiva", () => {
    beforeEach(() => seed({ L1: 30_000, L2: 30_000, L3: 2 }));

    it("pide confirmación antes de encender más de 50.000 puntos y no cambia nada si se cancela", async () => {
      await mount();
      await click(box("Farmacias"));
      expect(await screen.findByText(/Suman 60\.000 puntos/)).toBeInTheDocument();
      await click(screen.getByRole("button", { name: "Cancelar" }));
      expect(box("Farmacias")).toHaveAttribute("aria-checked", "false");
    });

    it("la enciende si se confirma", async () => {
      await mount();
      await click(box("Farmacias"));
      await click(await screen.findByRole("button", { name: "Mostrar" }));
      await waitFor(() => expect(box("Farmacias")).toHaveAttribute("aria-checked", "true"));
    });

    it("apagar nunca pide confirmación", async () => {
      localStorage.setItem("territorial_visible_v2", JSON.stringify(["L1", "L2"]));
      await mount();
      await click(box("Farmacias"));
      await waitFor(() => expect(box("Farmacias")).toHaveAttribute("aria-checked", "false"));
      expect(screen.queryByText(/Suman/)).toBeNull();
    });
  });

  describe("puntos de una capa", () => {
    const points = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Local ${String(i).padStart(3, "0")}`, lat: -33 - i / 1000, lng: -70 }));

    it("se piden al expandir la capa y se puede ir a uno", async () => {
      db.features.L1 = points(3);
      const onFlyToPoint = vi.fn();
      await mount({ onFlyToPoint });
      await click(screen.getByText("Farmacias"));
      expect(db.calls.some((c) => c.table === "territorial_features")).toBe(false);

      const row = screen.getByText("Cruz Verde").closest("[role=treeitem]") as HTMLElement;
      await click(row.querySelector("button[aria-label=Expandir]")!);
      await screen.findByText("Local 000");
      expect(db.calls).toContainEqual({ table: "territorial_features", method: "eq", args: ["layer_id", "L1"] });

      await click(screen.getByText("Local 001"));
      expect(onFlyToPoint).toHaveBeenCalledWith(-33.001, -70);
    });

    it("pagina de a 100 con 'Ver más…' y deja de ofrecerlo al terminar", async () => {
      seed({ L1: 130, L2: 5, L3: 2 });
      db.features.L1 = points(130);
      await mount();
      await click(screen.getByText("Farmacias"));
      const row = screen.getByText("Cruz Verde").closest("[role=treeitem]") as HTMLElement;
      await click(row.querySelector("button[aria-label=Expandir]")!);
      await screen.findByText("Local 000");
      expect(screen.queryByText("Local 100")).toBeNull();

      // La lista está virtualizada: "Ver más…" (fila ~105) no existe hasta desplazarse hasta el final.
      expect(screen.queryByText(/^Ver más…/)).toBeNull();
      const scroller = screen.getByRole("tree").firstElementChild as HTMLElement;
      // jsdom no calcula layout y react-window recorta el desplazamiento a esas medidas.
      Object.defineProperty(scroller, "clientHeight", { value: 380, configurable: true });
      Object.defineProperty(scroller, "scrollHeight", { value: 105 * 28, configurable: true });
      await act(async () => {
        scroller.scrollTop = 105 * 28;
        fireEvent.scroll(scroller);
      });
      await click(await screen.findByText(/^Ver más…/));
      await waitFor(() => expect(db.calls.filter((c) => c.table === "territorial_features" && c.method === "range")).toHaveLength(2));
      expect(db.calls.filter((c) => c.table === "territorial_features" && c.method === "range").map((c) => c.args)).toEqual([[0, 99], [100, 199]]);
      await waitFor(() => expect(screen.queryByText(/^Ver más…/)).toBeNull());
    });
  });

  it("el buscador filtra y limpiarlo devuelve el árbol como estaba", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Buscar capas"), { target: { value: "salco" } });
    await screen.findByText("Salcobrand");
    expect(screen.queryByText("Retail")).toBeNull();
    expect(screen.queryByText("Cruz Verde")).toBeNull();

    fireEvent.change(screen.getByLabelText("Buscar capas"), { target: { value: "zzz" } });
    expect(await screen.findByText(/Ninguna capa coincide/)).toBeInTheDocument();

    await click(screen.getByLabelText("Limpiar búsqueda"));
    await waitFor(() => expect(screen.getByText("Retail")).toBeInTheDocument());
    expect(screen.getByText("Farmacias")).toBeInTheDocument();
    expect(screen.queryByText("Salcobrand")).toBeNull(); // la carpeta sigue cerrada
  });

  it("oculta 'Parque Automotriz' y respeta el orden del árbol", async () => {
    db.nodes = [
      nodeRow("P", "folder", "Parque Automotriz", null, "a0"),
      nodeRow("A", "folder", "Farmacias", null, "a1"),
      nodeRow("S", "folder", "SERV. AUTOMOTRICES", null, "a2"),
    ];
    await mount();
    expect(screen.queryByText("Parque Automotriz")).toBeNull();
    const order = screen.getAllByRole("treeitem").map((el) => el.textContent);
    expect(order[0]).toContain("Farmacias");
    expect(order[1]).toContain("SERV. AUTOMOTRICES");
  });

  it("si el árbol no carga, avisa y deja reintentar", async () => {
    db.failNodes = true;
    render(<LayerTreeSection />, { wrapper });
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    expect(screen.getByText(/No se pudieron cargar las capas/)).toBeInTheDocument();
    db.failNodes = false;
    await click(retry);
    await screen.findByText("Farmacias");
  });
});

describe("importar archivos", () => {
  const kml = () => new File(["<kml/>"], "locales.kml");
  const filesDrag = (file: File) => ({ dataTransfer: { types: ["Files"], files: [file], dropEffect: "" } });

  it("solo los administradores ven el botón de importar", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: /Importar archivo/ })).toBeNull();
  });

  it("elegir un archivo con el botón abre el asistente", async () => {
    await mount({ isAdmin: true });
    expect(screen.getByRole("button", { name: /Importar archivo/ })).toBeInTheDocument();
    const input = screen.getByLabelText("Archivo a importar") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", ".kmz,.kml,.geojson,.json,.csv");
    await act(async () => { fireEvent.change(input, { target: { files: [kml()] } }); });
    const w = await screen.findByTestId("wizard");
    expect(w).toHaveAttribute("data-file", "locales.kml");
    expect(w).toHaveAttribute("data-mode", "new");
    expect(w).toHaveAttribute("data-target", "");
    await click(screen.getByRole("button", { name: "cerrar asistente" }));
    expect(screen.queryByTestId("wizard")).toBeNull();
  });

  it("soltar un archivo sobre el panel abre el asistente (con el aviso mientras se arrastra)", async () => {
    const { container } = await mount({ isAdmin: true });
    const panel = container.firstElementChild as HTMLElement;
    await act(async () => { fireEvent.dragOver(panel, filesDrag(kml())); });
    expect(screen.getByText("Suelta el archivo para importarlo")).toBeInTheDocument();
    await act(async () => { fireEvent.drop(panel, filesDrag(kml())); });
    expect(screen.queryByText("Suelta el archivo para importarlo")).toBeNull();
    expect(await screen.findByTestId("wizard")).toHaveAttribute("data-file", "locales.kml");
  });

  it("soltar sobre una carpeta importa dentro de ella", async () => {
    await mount({ isAdmin: true });
    await act(async () => { fireEvent.drop(screen.getByText("Farmacias"), filesDrag(kml())); });
    const w = await screen.findByTestId("wizard");
    expect(w).toHaveAttribute("data-mode", "new");
    expect(w).toHaveAttribute("data-target", "F1");
  });

  it("soltar sobre una capa abre el asistente para reemplazarla", async () => {
    await mount({ isAdmin: true });
    await click(screen.getByText("Farmacias"));
    await act(async () => { fireEvent.drop(screen.getByText("Cruz Verde"), filesDrag(kml())); });
    const w = await screen.findByTestId("wizard");
    expect(w).toHaveAttribute("data-mode", "replace");
    expect(w).toHaveAttribute("data-target", "L1");
  });

  it("un formato no soportado no abre el asistente", async () => {
    await mount({ isAdmin: true });
    const panel = screen.getByLabelText("Buscar capas").closest("div.relative")!.parentElement!.parentElement as HTMLElement;
    await act(async () => { fireEvent.drop(panel, filesDrag(new File(["x"], "mapa.shp"))); });
    expect(screen.queryByTestId("wizard")).toBeNull();
  });

  it("quien no es administrador no puede soltar archivos", async () => {
    const { container } = await mount();
    await act(async () => { fireEvent.drop(container.firstElementChild as HTMLElement, filesDrag(kml())); });
    await act(async () => { fireEvent.drop(screen.getByText("Farmacias"), filesDrag(kml())); });
    expect(screen.queryByTestId("wizard")).toBeNull();
  });
});
