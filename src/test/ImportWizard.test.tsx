import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  parse: vi.fn(),
  svc: {
    commitImport: vi.fn(),
    createImport: vi.fn(),
    discardImport: vi.fn(),
    fetchImportLimits: vi.fn(),
    previewImport: vi.fn(),
    revertImport: vi.fn(),
    uploadStaging: vi.fn(),
  },
}));
vi.mock("@/services/layerImport", () => h.svc);
vi.mock("@/utils/importParser", async (orig) => ({ ...(await orig<typeof import("@/utils/importParser")>()), parseImportFile: h.parse }));
// El mapa de Leaflet no se puede medir en jsdom; lo que importa acá es lo que se le entrega.
vi.mock("@/components/layerImport/ImportPreviewMap", () => ({
  ImportPreviewMap: ({ items }: { items: unknown[] }) => <div data-testid="map" data-items={items.length} />,
}));

import { ImportWizard } from "@/components/layerImport/ImportWizard";
import { parseImportContent } from "@/utils/importParser";
import type { LayerNode } from "@/types/layerNodes";

const doc = parseImportContent.kml(readFileSync(join(process.cwd(), "src/test/fixtures/import/locales.kml"), "utf-8"), "locales.kml");
const file = new File(["x"], "locales.kml");
const node = (id: string, kind: "folder" | "layer", name: string, parent: string | null, position: string): LayerNode => ({
  id, kind, name, parent_id: parent, position, style: {}, scope: "shared", owner_id: null, archived_at: null, created_at: "", updated_at: "",
});
const nodes = [
  node("F1", "folder", "Farmacias", null, "a0"), node("L1", "layer", "Cruz Verde", "F1", "a0"), node("L2", "layer", "Salcobrand", "F1", "a1"),
  node("F2", "folder", "Retail", null, "a1"),
];
const preview = (over: Record<string, unknown> = {}) => ({
  mode: "replace", max_rows: 5600, fits: true, included: { layers: 6, features: 10 },
  target: { id: "L1", name: "Cruz Verde", feature_count: 12 },
  diff: { added: 3, removed: 2, modified: 1, unchanged: 4, kept: 0, matched_by_external_id: 5, matched_by_coords: 0, rows_to_write: 6,
    samples: { added: ["Nuevo 1"], removed: ["Viejo 1"], modified: [{ name: "Cambiado", changed: ["name", "location"] }] } },
  ...over,
});

const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await vi.advanceTimersByTimeAsync(0); }); };

const props = () => ({ onClose: vi.fn(), onImported: vi.fn() });
const open = async (extra: Partial<React.ComponentProps<typeof ImportWizard>> = {}) => {
  const p = props();
  const utils = render(<ImportWizard file={file} nodes={nodes} {...p} {...extra} />);
  await settle(40);
  return { ...utils, ...p };
};
const button = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.parse.mockResolvedValue(doc);
  h.svc.fetchImportLimits.mockResolvedValue({ max_rows: 5600, statement_timeout: "8s" });
  h.svc.createImport.mockResolvedValue("batch-1");
  h.svc.uploadStaging.mockResolvedValue(undefined);
  h.svc.previewImport.mockResolvedValue(preview());
  h.svc.commitImport.mockResolvedValue({ mode: "new", folders: 3, layers: 6, features: 10, root_node_ids: ["r1"] });
  h.svc.discardImport.mockResolvedValue(undefined);
  h.svc.revertImport.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("ImportWizard — leer el archivo", () => {
  it("muestra el nombre, los totales y el árbol de carpetas del archivo", async () => {
    await open();
    expect(screen.getByText(/Importar “locales.kml”/)).toBeInTheDocument();
    expect(screen.getByText("3 carpetas · 6 capas · 10 puntos")).toBeInTheDocument();
    for (const name of ["Red de locales", "Norte", "Sur", "Zonas", "Con problemas"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Mostrar u ocultar Norte" })).toHaveAttribute("aria-checked", "true");
  });

  it("lista los avisos: lo inválido primero, con el motivo y la carpeta", async () => {
    await open();
    const issues = screen.getByTestId("import-issues");
    expect(within(issues).getByText(/Geometrías inválidas \(no se importan\) · 3/)).toBeInTheDocument();
    expect(within(issues).getByText(/latitud fuera de rango \(95\)/)).toBeInTheDocument();
    expect(within(issues).getByText(/Contenido no soportado \(se ignora\) · 2/)).toBeInTheDocument();
  });

  it("un archivo ilegible explica la causa y cómo corregirlo, y solo deja cerrar", async () => {
    h.parse.mockRejectedValueOnce(new Error("KML inválido (no es un XML bien formado)"));
    const { onClose } = await open();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("No se pudo leer el archivo")).toBeInTheDocument();
    expect(within(alert).getByText(/no es un XML bien formado: quizá está cortado/)).toBeInTheDocument();
    expect(within(alert).getByText(/Ábrelo en Google Earth y vuelve a guardarlo como KMZ/)).toBeInTheDocument();
    await click(screen.getAllByRole("button", { name: "Cerrar" })[0]);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Importar/ })).toBeNull();
  });

  it("el mapa recibe lo incluido", async () => {
    await open();
    expect(screen.getByTestId("map")).toHaveAttribute("data-items", "10");
  });
});

describe("ImportWizard — excluir partes", () => {
  it("desmarcar una carpeta excluye sus capas del resumen y del mapa", async () => {
    await open();
    expect(screen.getByText(/Se crearán/).textContent).toMatch(/3 carpetas, 6 capas y 10 puntos/);
    await click(screen.getByRole("checkbox", { name: "Mostrar u ocultar Norte" }));
    expect(screen.getByText(/Se crearán/).textContent).toMatch(/2 carpetas, 4 capas y 6 puntos/);
    expect(screen.getByTestId("map")).toHaveAttribute("data-items", "6");
    expect(screen.getByRole("checkbox", { name: "Mostrar u ocultar Norte" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Mostrar u ocultar Red de locales" })).toHaveAttribute("aria-checked", "mixed");
  });

  it("sin nada incluido no se puede importar", async () => {
    await open();
    await click(screen.getByRole("checkbox", { name: "Mostrar u ocultar Red de locales" }));
    expect(screen.getByText(/No hay nada incluido/)).toBeInTheDocument();
    expect(button(/^Importar$/)).toBeDisabled();
  });
});

describe("ImportWizard — importación nueva", () => {
  it("importa en la carpeta elegida, muestra el resultado y avisa para refrescar el árbol", async () => {
    const { onImported } = await open();
    await click(screen.getByRole("checkbox", { name: "Mostrar u ocultar Zonas" }));
    await click(screen.getByRole("option", { name: "Retail" }));
    await click(button(/^Importar$/));
    await settle(10);
    expect(h.svc.commitImport).toHaveBeenCalledWith("batch-1", "new", "F2", new Set(["0.2"]));
    const done = screen.getByTestId("import-done");
    expect(within(done).getByText(/se crearon 6 capas en 3 carpetas/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ layers: 6 }));
  });

  it("sin destino elegido importa en la raíz", async () => {
    await open();
    await click(button(/^Importar$/));
    await settle(10);
    expect(h.svc.commitImport).toHaveBeenCalledWith("batch-1", "new", null, new Set());
  });

  it("si no cabe en el límite de la base, lo explica y no deja confirmar", async () => {
    h.svc.fetchImportLimits.mockResolvedValueOnce({ max_rows: 5, statement_timeout: "100ms" });
    await open();
    expect(screen.getByText(/Son 10 puntos y el máximo por confirmación es 5/)).toBeInTheDocument();
    expect(button(/^Importar$/)).toBeDisabled();
    // excluyendo partes vuelve a caber
    await click(screen.getByRole("checkbox", { name: "Mostrar u ocultar Norte" }));
    await click(screen.getByRole("checkbox", { name: "Mostrar u ocultar Zonas" }));
    expect(button(/^Importar$/)).toBeEnabled();
  });

  it("si la base rechaza la importación muestra el motivo y se puede reintentar", async () => {
    h.svc.commitImport.mockRejectedValueOnce({ message: "importador: sin permiso para escribir en esa carpeta", code: "42501" });
    await open();
    await click(button(/^Importar$/));
    await settle(10);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("No se pudo confirmar la importación")).toBeInTheDocument();
    expect(within(alert).getByText(/Tu usuario no tiene permiso de administrador/)).toBeInTheDocument();
    expect(button(/^Importar$/)).toBeEnabled();
  });
});

describe("ImportWizard — reemplazar y agregar", () => {
  it("pide elegir la capa; luego muestra el diff (agregadas, eliminadas, modificadas) y avisa de lo que se borra", async () => {
    await open();
    await click(screen.getByRole("radio", { name: /Reemplazar una capa/ }));
    expect(screen.getByText(/Elige la capa que quieres reemplazar/)).toBeInTheDocument();
    expect(button(/Reemplazar capa/)).toBeDisabled();
    expect(h.svc.createImport).not.toHaveBeenCalled();

    await click(screen.getByRole("option", { name: "Cruz Verde" }));
    await settle(400);
    expect(h.svc.createImport).toHaveBeenCalledTimes(1);
    expect(h.svc.previewImport).toHaveBeenCalledWith("batch-1", "replace", "L1", new Set());
    for (const label of ["Agregadas", "Eliminadas", "Modificadas", "Sin cambio"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/Se eliminarán 2 puntos que ya no vienen en el archivo/)).toBeInTheDocument();
    expect(screen.getByText(/Solo se escribe lo que cambia/).textContent).toMatch(/6/);
    expect(button(/Reemplazar capa/)).toBeEnabled();
  });

  it("muestra de qué cambió cada punto modificado", async () => {
    await open({ initialMode: "replace", initialTargetId: "L1" });
    await settle(400);
    const details = screen.getByText(/Modificadas \(primeras 1\)/).closest("details")!;
    expect(within(details).getByText(/Cambiado — cambió nombre, ubicación/)).toBeInTheDocument();
  });

  it("al agregar habla de lo que se conserva y no avisa de eliminaciones", async () => {
    h.svc.previewImport.mockResolvedValue(preview({ mode: "append", diff: { ...preview().diff, removed: 3, kept: 3 } }));
    await open({ initialMode: "append", initialTargetId: "L1" });
    await settle(400);
    expect(screen.getByText("Se conservan")).toBeInTheDocument();
    expect(screen.queryByText(/Se eliminarán/)).toBeNull();
  });

  it("confirma con el modo y la capa elegidos y cuenta lo que pasó", async () => {
    h.svc.commitImport.mockResolvedValue({ mode: "replace", features: 12, added: 3, removed: 2, modified: 1, unchanged: 4 });
    await open({ initialMode: "replace", initialTargetId: "L1" });
    await settle(400);
    await click(button(/Reemplazar capa/));
    await settle(10);
    expect(h.svc.commitImport).toHaveBeenCalledWith("batch-1", "replace", "L1", new Set());
    expect(screen.getByTestId("import-done").textContent).toMatch(/“Cruz Verde” quedó con 12 puntos/);
    expect(screen.getByTestId("import-done").textContent).toMatch(/3 agregados · 1 modificados · 2 eliminados · 4 sin cambio/);
  });

  it("un cambio que no cabe se explica y no deja confirmar", async () => {
    h.svc.previewImport.mockResolvedValue(preview({ fits: false, max_rows: 100, diff: { ...preview().diff, rows_to_write: 9000 } }));
    await open({ initialMode: "replace", initialTargetId: "L1" });
    await settle(400);
    expect(screen.getByText(/Son 9\.000 puntos y el máximo por confirmación es 100/)).toBeInTheDocument();
    expect(button(/Reemplazar capa/)).toBeDisabled();
  });

  it("al cambiar de modo el destino de una carpeta no se arrastra a una capa", async () => {
    await open({ initialMode: "new", initialTargetId: "F2" });
    expect(screen.getByRole("option", { name: "Retail", selected: true })).toBeInTheDocument();
    await click(screen.getByRole("radio", { name: /Agregar a una capa/ }));
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    expect(screen.getByText(/Elige la capa que quieres actualizar/)).toBeInTheDocument();
  });
});

describe("ImportWizard — deshacer", () => {
  it("pide confirmación y revierte el lote", async () => {
    await open();
    await click(button(/^Importar$/));
    await settle(10);
    await click(button(/Deshacer importación/));
    expect(h.svc.revertImport).not.toHaveBeenCalled();
    await click(button(/Sí, deshacer la importación/));
    expect(h.svc.revertImport).toHaveBeenCalledWith("batch-1");
    expect(screen.getByText("La importación se deshizo.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deshacer importación/ })).toBeNull();
  });

  it("si no se puede deshacer, lo explica", async () => {
    await open();
    await click(button(/^Importar$/));
    await settle(10);
    h.svc.revertImport.mockRejectedValueOnce({ message: "importador: esa capa tiene una importación posterior; revierte primero la más reciente", code: "23514" });
    await click(button(/Deshacer importación/));
    await click(button(/Sí, deshacer la importación/));
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("No se pudo deshacer la importación")).toBeInTheDocument();
    expect(within(alert).getByText(/Deshaz primero la importación más reciente/)).toBeInTheDocument();
  });
});

describe("ImportWizard — cerrar", () => {
  it("cancelar cierra y descarta lo subido", async () => {
    const { onClose, unmount } = await open({ initialMode: "replace", initialTargetId: "L1" });
    await settle(400);
    await click(button(/^Cancelar$/));
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(h.svc.discardImport).toHaveBeenCalledWith("batch-1");
  });
});

describe("ImportWizard — mensaje copiable ante un fallo", () => {
  const failCommit = () => h.svc.commitImport.mockRejectedValueOnce({ message: "importador: son 9.000 puntos y el máximo por confirmación es 5.600 (el rol authenticated corta a los 8s).", code: "23514" });
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("el botón copia un mensaje con el paso, el archivo, lo que intentaba, el error, la causa y la solución", async () => {
    failCommit();
    await open({ initialTargetId: "F2" });
    await click(button(/^Importar$/));
    await settle(10);
    await click(button(/Copiar mensaje para el chat/));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("Paso que falló: Confirmar la importación");
    expect(text).toContain("Archivo: locales.kml (KML) · 3 carpetas, 6 capas, 10 puntos (3 inválidos)");
    expect(text).toContain("Lo que intentaba: crear capas y carpetas nuevas · destino: «Retail» · 10 puntos incluidos");
    expect(text).toContain("Mensaje de error: importador: son 9.000 puntos y el máximo por confirmación es 5.600");
    expect(text).toContain("(código 23514)");
    expect(text).toContain("Causa probable: Esta importación escribe 9.000 puntos y el máximo que la base admite de una vez es 5.600");
    expect(text).toContain("Cómo corregirlo: Desmarca partes del archivo");
    expect(screen.getByText("Copiado: pégalo en el chat")).toBeInTheDocument();
  });

  it("muestra el detalle técnico sin ocultar el mensaje original", async () => {
    failCommit();
    await open();
    await click(button(/^Importar$/));
    await settle(10);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Detalle técnico")).toBeInTheDocument();
    expect(alert.textContent).toContain("(código 23514)");
  });

  it("si el navegador no deja copiar, muestra el texto para copiarlo a mano", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const exec = vi.fn(() => false);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    failCommit();
    await open();
    await click(button(/^Importar$/));
    await settle(10);
    await click(button(/Copiar mensaje para el chat/));
    expect(screen.getByText(/El navegador no dejó copiar automáticamente/)).toBeInTheDocument();
    expect((screen.getByLabelText("Mensaje para copiar") as HTMLTextAreaElement).value).toContain("[Importador de capas]");
  });

  it("también se pueden copiar los avisos del archivo", async () => {
    await open();
    await click(screen.getByRole("button", { name: /Copiar avisos/ }));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("Avisos al leer «locales.kml»");
    expect(text).toContain("«Latitud mala» — latitud fuera de rango (95)");
    expect(screen.getByText("Copiado")).toBeInTheDocument();
  });

  it("si no se pudo leer el límite de la base, lo dice en pantalla", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.svc.fetchImportLimits.mockRejectedValueOnce(new Error("x"));
    await open();
    expect(screen.getByText(/No se pudo leer el límite de tamaño de la base/)).toBeInTheDocument();
    warn.mockRestore();
  });
});
