import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { LayerNode } from "@/types/layerNodes";
import { LayerTree, type TreeEditActions } from "@/components/layerTree/LayerTree";
import { analyzeTree, buildLayerTree, type TreeRow } from "@/utils/layerTree";

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

const nodes: LayerNode[] = [
  node({ id: "F1", kind: "folder", name: "Farmacias", position: "a0" }),
  node({ id: "L1", kind: "layer", name: "Cruz Verde", parent_id: "F1", position: "a0" }),
  node({ id: "L2", kind: "layer", name: "Salcobrand", parent_id: "F1", position: "a1" }),
  node({ id: "F2", kind: "folder", name: "Retail", position: "a1" }),
];
const counts = new Map([["L1", 10], ["L2", 5]]);

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const setup = (opts: { editable?: boolean; searchTerm?: string; fly?: boolean; drop?: boolean; hideMenu?: boolean } = {}) => {
  const base = buildLayerTree(nodes, counts).roots;
  const edit = {
    onMove: vi.fn(), onRename: vi.fn(), onDelete: vi.fn<(rows: TreeRow[]) => void>(), onNewFolder: vi.fn<(r: TreeRow) => void>(),
    onDuplicate: vi.fn<(r: TreeRow) => void>(), onProperties: vi.fn<(r: TreeRow) => void>(), onUndo: vi.fn(),
  } satisfies TreeEditActions;
  const props = {
    onToggleCheck: vi.fn(), onOpenPoi: vi.fn(), onLoadMore: vi.fn(), onEditStyle: vi.fn(), onResetStyle: vi.fn(),
    onFlyTo: vi.fn(), onExport: vi.fn(), onDropFile: vi.fn<(file: File, row: TreeRow) => void>(),
  };
  const utils = render(
    <LayerTree
      roots={base}
      analysis={analyzeTree(base, new Set())}
      searchTerm={opts.searchTerm ?? ""}
      initialOpenState={{ F1: true }}
      edit={opts.editable ? edit : undefined}
      {...props}
      onDropFile={opts.drop ? props.onDropFile : undefined}
      hideMenu={opts.hideMenu}
    />,
  );
  return { ...utils, edit, ...props };
};

const rowOf = (name: string) => screen.getByText(name).closest("[role=treeitem]") as HTMLElement;
const menuItems = async (name: string) => {
  await act(async () => { fireEvent.contextMenu(screen.getByText(name)); });
  await flush();
  return screen.queryAllByRole("menuitem").map((el) => el.textContent?.trim());
};

describe("LayerTree — solo lectura", () => {
  it("el menú contextual ofrece volar a y exportar, pero no editar", async () => {
    setup();
    const items = await menuItems("Farmacias");
    expect(items).toEqual(["Volar a", "Exportar como KMZ"]);
  });

  it("una capa suma las opciones de estilo personal", async () => {
    setup();
    const items = await menuItems("Cruz Verde");
    expect(items).toEqual(["Volar a", "Exportar como KMZ", "✏️ Mi estilo en este equipo…", "↩ Restaurar mi estilo"]);
  });

  it("el doble clic no abre el renombrado y los atajos de edición no hacen nada", async () => {
    const { edit } = setup();
    await act(async () => { fireEvent.doubleClick(screen.getByText("Retail")); });
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "z", ctrlKey: true });
    fireEvent.keyDown(tree, { key: "Delete" });
    expect(edit.onUndo).not.toHaveBeenCalled();
    expect(edit.onDelete).not.toHaveBeenCalled();
  });
});

describe("LayerTree — administrador", () => {
  it("el menú contextual de una carpeta trae todas las acciones", async () => {
    setup({ editable: true });
    expect(await menuItems("Farmacias")).toEqual([
      "Nueva carpeta aquí", "Renombrar", "Propiedades…", "Duplicar", "Volar a", "Exportar como KMZ", "Eliminar",
    ]);
  });

  it("el menú de una capa no ofrece crear carpetas dentro", async () => {
    setup({ editable: true });
    const items = await menuItems("Cruz Verde");
    expect(items).not.toContain("Nueva carpeta aquí");
    expect(items).toEqual(expect.arrayContaining(["Renombrar", "Propiedades…", "Duplicar", "Eliminar"]));
  });

  it("cada acción del menú llama a su manejador con la fila correcta", async () => {
    const { edit, onFlyTo, onExport } = setup({ editable: true });
    const click = async (label: string, target = "Farmacias") => {
      await menuItems(target);
      await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) })); });
      await flush();
    };
    await click("Nueva carpeta aquí");
    expect(edit.onNewFolder.mock.calls[0][0].id).toBe("F1");
    await click("Propiedades");
    expect(edit.onProperties.mock.calls[0][0].id).toBe("F1");
    await click("Duplicar", "Cruz Verde");
    expect(edit.onDuplicate.mock.calls[0][0].id).toBe("L1");
    await click("Volar a");
    expect(onFlyTo.mock.calls[0][0].id).toBe("F1");
    await click("Exportar como KMZ");
    expect(onExport.mock.calls[0][0].id).toBe("F1");
    await click("Eliminar", "Retail");
    expect(edit.onDelete.mock.calls[0][0].map((r) => r.id)).toEqual(["F2"]);
  });

  it("doble clic abre el renombrado; Enter lo guarda", async () => {
    const { edit } = setup({ editable: true });
    await act(async () => { fireEvent.doubleClick(screen.getByText("Retail")); });
    const input = await screen.findByLabelText("Nombre");
    expect(input).toHaveValue("Retail");
    fireEvent.change(input, { target: { value: "Retail 2" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await flush();
    expect(edit.onRename).toHaveBeenCalledWith("F2", "Retail 2");
  });

  it("Escape cancela el renombrado y un nombre sin cambios tampoco guarda", async () => {
    const { edit } = setup({ editable: true });
    await act(async () => { fireEvent.doubleClick(screen.getByText("Retail")); });
    let input = await screen.findByLabelText("Nombre");
    fireEvent.change(input, { target: { value: "Otro" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Escape" }); });
    await flush();
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(screen.getByText("Retail")).toBeInTheDocument();

    await act(async () => { fireEvent.doubleClick(screen.getByText("Retail")); });
    input = await screen.findByLabelText("Nombre");
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await flush();
    expect(edit.onRename).not.toHaveBeenCalled();
  });

  it("Ctrl+Z (y Cmd+Z) deshace", () => {
    const { edit } = setup({ editable: true });
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "z", ctrlKey: true });
    fireEvent.keyDown(tree, { key: "z", metaKey: true });
    expect(edit.onUndo).toHaveBeenCalledTimes(2);
  });

  it("Ctrl+Z dentro del campo de nombre deshace el texto, no el árbol", async () => {
    const { edit } = setup({ editable: true });
    await act(async () => { fireEvent.doubleClick(screen.getByText("Retail")); });
    const input = await screen.findByLabelText("Nombre");
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    expect(edit.onUndo).not.toHaveBeenCalled();
  });

  it("Suprimir elimina la selección (varias filas con Ctrl)", async () => {
    const { edit } = setup({ editable: true });
    await act(async () => { fireEvent.click(rowOf("Cruz Verde"), { ctrlKey: true }); });
    await act(async () => { fireEvent.click(rowOf("Salcobrand"), { ctrlKey: true }); });
    await act(async () => { fireEvent.keyDown(screen.getByRole("tree"), { key: "Delete" }); });
    expect(edit.onDelete).toHaveBeenCalledTimes(1);
    expect(edit.onDelete.mock.calls[0][0].map((r) => r.id).sort()).toEqual(["L1", "L2"]);
  });

  it("Ctrl+clic selecciona sin encender la capa; el clic normal sí la enciende", async () => {
    const { onToggleCheck } = setup({ editable: true });
    await act(async () => { fireEvent.click(screen.getByText("Cruz Verde"), { ctrlKey: true }); });
    expect(onToggleCheck).not.toHaveBeenCalled();
    expect(rowOf("Cruz Verde")).toHaveAttribute("aria-selected", "true");
    await act(async () => { fireEvent.click(screen.getByText("Cruz Verde")); });
    expect(onToggleCheck).toHaveBeenCalledTimes(1);
  });

  it("con una búsqueda activa se desactiva la edición (la lista filtrada no sirve para ordenar)", async () => {
    const { edit } = setup({ editable: true, searchTerm: "cruz" });
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "z", ctrlKey: true });
    fireEvent.keyDown(tree, { key: "Delete" });
    await act(async () => { fireEvent.doubleClick(screen.getByText("Cruz Verde")); });
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(edit.onUndo).not.toHaveBeenCalled();
    expect(edit.onDelete).not.toHaveBeenCalled();
    expect(await menuItems("Cruz Verde")).not.toContain("Eliminar");
  });
});

describe("LayerTree — archivos soltados y menú oculto", () => {
  const file = new File(["x"], "capa.kml", { type: "application/vnd.google-earth.kml+xml" });
  const dropOn = (name: string, types: string[]) =>
    act(async () => { fireEvent.drop(screen.getByText(name), { dataTransfer: { types, files: types.includes("Files") ? [file] : [], dropEffect: "" } }); });

  it("soltar un archivo sobre una carpeta o una capa avisa cuál fila fue", async () => {
    const { onDropFile } = setup({ editable: true, drop: true, searchTerm: "" });
    await dropOn("Farmacias", ["Files"]);
    expect(onDropFile).toHaveBeenCalledTimes(1);
    expect(onDropFile.mock.calls[0][0]).toBe(file);
    expect(onDropFile.mock.calls[0][1]).toMatchObject({ id: "F1", kind: "folder" });
    // "Farmacias" parte abierta (initialOpenState): su capa ya está en pantalla
    await dropOn("Cruz Verde", ["Files"]);
    expect(onDropFile.mock.calls[1][1]).toMatchObject({ id: "L1", kind: "layer" });
  });

  it("arrastrar algo que no es un archivo (una fila del propio árbol) no cuenta", async () => {
    const { onDropFile } = setup({ editable: true, drop: true });
    await dropOn("Farmacias", ["text/plain"]);
    expect(onDropFile).not.toHaveBeenCalled();
  });

  it("sin onDropFile no hace nada", async () => {
    const { onDropFile } = setup({ editable: true });
    await dropOn("Farmacias", ["Files"]);
    expect(onDropFile).not.toHaveBeenCalled();
  });

  it("al arrastrar un archivo encima, la fila se resalta y al salir se apaga", async () => {
    setup({ editable: true, drop: true });
    const row = screen.getByText("Retail");
    await act(async () => { fireEvent.dragOver(row, { dataTransfer: { types: ["Files"], dropEffect: "" } }); });
    expect(row.closest("div")!.className).toMatch(/ring-primary/);
    await act(async () => { fireEvent.dragLeave(row); });
    expect(row.closest("div")!.className).not.toMatch(/ring-primary/);
  });

  it("con hideMenu el clic derecho no abre ningún menú", async () => {
    setup({ editable: true, hideMenu: true });
    await act(async () => { fireEvent.contextMenu(screen.getByText("Farmacias")); });
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });
});
