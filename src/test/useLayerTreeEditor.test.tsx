import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { LayerNode } from "@/types/layerNodes";
import { LAYER_TREE_QUERY_KEY, type LayerTreeData } from "@/hooks/useLayerTree";
import { useLayerTreeEditor } from "@/hooks/useLayerTreeEditor";
import { childrenOf } from "@/utils/layerTreeEdit";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), promise: vi.fn(), loading: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("sonner", () => ({ toast: h.toast }));

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
const folder = (id: string, parent: string | null, position: string) => node({ id, kind: "folder", name: id, parent_id: parent, position });
const layer = (id: string, parent: string | null, position: string) => node({ id, kind: "layer", name: id, parent_id: parent, position });

/** R1: A B C · R2: Z · R3: (vacía) */
const seed = (): LayerNode[] => [
  folder("R1", null, "a0"), layer("A", "R1", "a0"), layer("B", "R1", "a1"), layer("C", "R1", "a2"),
  folder("R2", null, "a1"), layer("Z", "R2", "a0"), folder("R3", null, "a2"),
];

const DATA_KEY = [...LAYER_TREE_QUERY_KEY, "data"];
const ok = (data: unknown = {}) => Promise.resolve({ data, error: null });
const fail = (message: string, code?: string) => Promise.resolve({ data: null, error: { message, code } });

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const nodes = () => qc.getQueryData<LayerTreeData>(DATA_KEY)!.nodes;
const order = (parent: string | null) => childrenOf(nodes(), parent).map((n) => n.id);
const row = (n: LayerNode) => ({ ...n, style: n.style as Record<string, unknown> });

beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<LayerTreeData>(DATA_KEY, { nodes: seed(), featureCounts: new Map() });
  h.rpc.mockImplementation(() => ok());
});

describe("move", () => {
  it("pinta el resultado antes de que responda la base y llama a move_node con las anclas", async () => {
    let release!: () => void;
    h.rpc.mockImplementationOnce(() => new Promise((res) => { release = () => res({ data: {}, error: null }); }));
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });

    let done!: Promise<boolean>;
    act(() => { done = result.current.move(["C"], "R1", 0); });
    expect(order("R1")).toEqual(["C", "A", "B"]); // ya se ve, sin esperar al servidor
    expect(h.rpc).toHaveBeenCalledWith("move_node", { p_node_id: "C", p_new_parent_id: "R1", p_after_id: undefined, p_before_id: "A" });

    await act(async () => { release(); await done; });
    expect(await done).toBe(true);
    expect(result.current.undoLabel).toBe("mover “C”");
  });

  it("si la base falla, vuelve atrás y explica por qué", async () => {
    h.rpc.mockImplementationOnce(() => fail("duplicate key", "23505"));
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { expect(await result.current.move(["A"], "R2", 0)).toBe(false); });
    expect(order("R1")).toEqual(["A", "B", "C"]);
    expect(order("R2")).toEqual(["Z"]);
    expect(h.toast.error).toHaveBeenCalledWith("No se pudo mover", { description: "Ya existe una capa con ese nombre en ese grupo." });
    expect(result.current.undoLabel).toBeNull();
  });

  it("soltar algo donde ya estaba no hace nada", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { expect(await result.current.move(["B"], "R1", 1)).toBe(false); });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("una capa no se suelta en la raíz: se rechaza sin llamar a la base", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { expect(await result.current.move(["A"], null, 0)).toBe(false); });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalled();
    expect(order("R1")).toEqual(["A", "B", "C"]);
  });

  it("varios nodos se mueven en orden, cada uno anclado al anterior", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { await result.current.move(["C", "A"], "R3", 0); });
    expect(h.rpc.mock.calls.map((c) => [c[1].p_node_id, c[1].p_new_parent_id, c[1].p_after_id])).toEqual([
      ["A", "R3", undefined],
      ["C", "R3", "A"],
    ]);
    expect(order("R3")).toEqual(["A", "C"]);
    expect(result.current.undoLabel).toBe("mover 2 elementos");
  });

  it("deshacer devuelve el nodo a su lugar original", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { await result.current.move(["B"], "R3", 0); });
    h.rpc.mockClear();
    await act(async () => { expect(await result.current.undo()).toBe(true); });
    expect(h.rpc).toHaveBeenCalledWith("move_node", { p_node_id: "B", p_new_parent_id: "R1", p_after_id: "A", p_before_id: "C" });
    expect(result.current.undoLabel).toBeNull();
  });

  it("si los vecinos de antes ya no sirven de ancla, deshacer reintenta con menos anclas", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { await result.current.move(["B"], "R3", 0); });
    h.rpc.mockClear();
    h.rpc.mockImplementationOnce(() => fail("after_id no es un hermano activo"));
    await act(async () => { expect(await result.current.undo()).toBe(true); });
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc.mock.calls[1][1]).toMatchObject({ p_node_id: "B", p_new_parent_id: "R1", p_after_id: "A", p_before_id: undefined });
  });
});

describe("rename", () => {
  it("pinta el nombre nuevo, llama a rename_node y se puede deshacer", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { expect(await result.current.rename("A", "  Nueva  ")).toBe(true); });
    expect(nodes().find((n) => n.id === "A")!.name).toBe("Nueva");
    expect(h.rpc).toHaveBeenCalledWith("rename_node", { p_node_id: "A", p_name: "Nueva" });

    h.rpc.mockClear();
    await act(async () => { await result.current.undo(); });
    expect(h.rpc).toHaveBeenCalledWith("rename_node", { p_node_id: "A", p_name: "A" });
  });

  it("no hace nada si el nombre no cambia o queda vacío", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => {
      expect(await result.current.rename("A", "A")).toBe(false);
      expect(await result.current.rename("A", "   ")).toBe(false);
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("si falla, restaura el nombre", async () => {
    h.rpc.mockImplementationOnce(() => fail("sin permiso", "42501"));
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { expect(await result.current.rename("A", "Otro")).toBe(false); });
    expect(nodes().find((n) => n.id === "A")!.name).toBe("A");
    expect(h.toast.error).toHaveBeenCalledWith("No se pudo renombrar", { description: "No tienes permiso para hacer esto." });
  });
});

describe("archive (papelera)", () => {
  it("quita el nodo y todo lo que contiene, avisa y ofrece deshacer", async () => {
    const onArchived = vi.fn();
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { expect(await result.current.archive(["R1"], onArchived)).toBe(true); });
    expect(nodes().map((n) => n.id).sort()).toEqual(["R2", "R3", "Z"]);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("archive_node", { p_node_id: "R1" });
    expect(onArchived.mock.calls[0][0].map((n: LayerNode) => n.id).sort()).toEqual(["A", "B", "C", "R1"]);
    const [message, options] = h.toast.mock.calls[0];
    expect(message).toContain("R1");
    expect(options.action.label).toBe("Deshacer");
  });

  it("si se eliminan una carpeta y algo de su interior, solo se archiva la carpeta", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { await result.current.archive(["R1", "A"]); });
    expect(h.rpc.mock.calls.map((c) => c[1].p_node_id)).toEqual(["R1"]);
  });

  it("deshacer restaura lo eliminado", async () => {
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { await result.current.archive(["A", "Z"]); });
    h.rpc.mockClear();
    await act(async () => { await result.current.undo(); });
    expect(h.rpc.mock.calls.map((c) => [c[0], c[1].p_node_id])).toEqual([["restore_node", "A"], ["restore_node", "Z"]]);
  });

  it("si falla, el nodo vuelve a verse", async () => {
    h.rpc.mockImplementationOnce(() => fail("boom"));
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { expect(await result.current.archive(["A"])).toBe(false); });
    expect(order("R1")).toEqual(["A", "B", "C"]);
    expect(h.toast.error).toHaveBeenCalled();
  });
});

describe("createFolder / updateStyle / duplicate", () => {
  it("crea la carpeta con un nombre que no repite el de sus hermanos", async () => {
    h.rpc.mockImplementationOnce((_fn: string, args: { p_name: string }) =>
      ok({ id: "N", kind: "folder", name: args.p_name, parent_id: "R3", position: "a0", style: {}, scope: "shared", owner_id: null, archived_at: null, created_at: "", updated_at: "" }));
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    let created: LayerNode | null = null;
    await act(async () => { created = await result.current.createFolder("R3"); });
    expect(h.rpc).toHaveBeenCalledWith("create_folder", { p_parent_id: "R3", p_name: "Nueva carpeta" });
    expect(created).toMatchObject({ id: "N", name: "Nueva carpeta" });
    expect(order("R3")).toEqual(["N"]);
    expect(result.current.undoLabel).toBe("crear “Nueva carpeta”");
  });

  it("la segunda carpeta nueva se numera", async () => {
    qc.setQueryData<LayerTreeData>(DATA_KEY, { nodes: [...seed(), folder("N1", "R3", "a0")].map((n) => (n.id === "N1" ? { ...n, name: "Nueva carpeta" } : n)), featureCounts: new Map() });
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { await result.current.createFolder("R3"); });
    expect(h.rpc.mock.calls[0][1].p_name).toBe("Nueva carpeta 2");
  });

  it("un error al crear avisa y devuelve null", async () => {
    h.rpc.mockImplementationOnce(() => fail("sin permiso", "42501"));
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    let created: LayerNode | null = row(seed()[0]) as LayerNode;
    await act(async () => { created = await result.current.createFolder(null); });
    expect(created).toBeNull();
    expect(h.toast.error).toHaveBeenCalledWith("No se pudo crear la carpeta", { description: "No tienes permiso para hacer esto." });
  });

  it("propiedades: pinta el cambio, solo envía lo que cambió y respeta null (borrar)", async () => {
    qc.setQueryData<LayerTreeData>(DATA_KEY, { nodes: seed().map((n) => (n.id === "A" ? { ...n, style: { color: "#111111", icon: "x" } } : n)), featureCounts: new Map() });
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    await act(async () => { await result.current.updateStyle("A", { color: "#222222", icon: null, opacity: 0.5 }); });
    expect(nodes().find((n) => n.id === "A")!.style).toEqual({ color: "#222222", opacity: 0.5 });
    expect(h.rpc).toHaveBeenCalledWith("update_node_style", { p_node_id: "A", p_style: { color: "#222222", icon: null, opacity: 0.5 } });
  });

  it("duplicar usa un aviso de progreso y devuelve null si falla", async () => {
    h.rpc.mockImplementationOnce(() => fail("duplicate_node: contiene 25045 puntos y el máximo para duplicar es 10000", "23514"));
    const { result } = renderHook(() => useLayerTreeEditor(), { wrapper });
    let dup: LayerNode | null = row(seed()[0]) as LayerNode;
    await act(async () => { dup = await result.current.duplicate("A"); });
    expect(dup).toBeNull();
    expect(h.toast.promise).toHaveBeenCalledTimes(1);
    const { error } = h.toast.promise.mock.calls[0][1];
    expect(error({ message: "duplicate_node: contiene 25045 puntos y el máximo para duplicar es 10000" })).toBe("Tiene 25045 puntos; el máximo para duplicar es 10000.");
  });
});
