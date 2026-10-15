import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

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

import { useImportWizard } from "@/hooks/useImportWizard";
import { parseImportContent, type ImportDocument } from "@/utils/importParser";
import { describeError } from "@/utils/importErrorReport";

const doc: ImportDocument = parseImportContent.kml(readFileSync(join(process.cwd(), "src/test/fixtures/import/locales.kml"), "utf-8"), "locales.kml");
const file = new File(["x"], "locales.kml");
const preview = (over: Record<string, unknown> = {}) => ({
  mode: "replace", max_rows: 5600, fits: true, included: { layers: 6, features: 10 },
  target: { id: "capa", name: "Capa", feature_count: 12 },
  diff: { added: 3, removed: 2, modified: 1, unchanged: 4, kept: 0, matched_by_external_id: 5, matched_by_coords: 0, rows_to_write: 6, samples: { added: [], removed: [], modified: [] } },
  ...over,
});

const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const open = async (args: Partial<Parameters<typeof useImportWizard>[0]> = {}) => {
  const hook = renderHook((p: Parameters<typeof useImportWizard>[0]) => useImportWizard(p), { initialProps: { file, ...args } });
  await settle(40);
  return hook;
};

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

describe("abrir un archivo", () => {
  it("lo lee, lo deja listo y trae el límite de la base", async () => {
    const { result } = await open();
    expect(result.current.phase).toBe("ready");
    expect(result.current.doc).toBe(doc);
    expect(result.current.localSummary).toEqual({ folders: 3, layers: 6, features: 10 });
    expect(result.current.maxRows).toBe(5600);
  });

  it("un archivo que no se puede leer deja el mensaje", async () => {
    h.parse.mockRejectedValueOnce(new Error("KML inválido (no es un XML bien formado)"));
    const { result } = await open();
    expect(result.current.phase).toBe("error");
    expect(result.current.failure).toMatchObject({ stage: "read" });
    expect(describeError(result.current.failure!.error).raw).toMatch(/KML inválido/);
  });

  it("si no se puede leer el límite igual funciona, pero lo avisa (no falla en silencio)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.svc.fetchImportLimits.mockRejectedValueOnce(new Error("x"));
    const { result } = await open();
    expect(result.current.phase).toBe("ready");
    expect(result.current.maxRows).toBeNull();
    expect(result.current.fits).toBe(true);
    expect(result.current.limitsWarning).toMatch(/No se pudo leer el límite/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("importación nueva", () => {
  it("no sube nada hasta confirmar, y al confirmar sube una vez y manda las exclusiones", async () => {
    const onCommitted = vi.fn();
    const { result } = await open({ initialTargetId: "carpeta", onCommitted });
    act(() => result.current.toggleLayers(["0.0.0"], false));
    await settle(1000);
    expect(h.svc.createImport).not.toHaveBeenCalled();
    expect(result.current.localSummary).toEqual({ folders: 3, layers: 5, features: 7 });

    await act(async () => { await result.current.confirm(); });
    expect(h.svc.createImport).toHaveBeenCalledTimes(1);
    expect(h.svc.uploadStaging).toHaveBeenCalledTimes(1);
    expect(h.svc.commitImport).toHaveBeenCalledWith("batch-1", "new", "carpeta", new Set(["0.0.0"]));
    expect(result.current.phase).toBe("done");
    expect(result.current.result).toMatchObject({ layers: 6 });
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("no deja confirmar si no cabe en el límite o si se excluyó todo", async () => {
    h.svc.fetchImportLimits.mockResolvedValueOnce({ max_rows: 5, statement_timeout: "100ms" });
    const { result } = await open();
    expect(result.current.fits).toBe(false);
    expect(result.current.canConfirm).toBe(false);
    act(() => result.current.toggleLayers(["0.0.0", "0.0.1", "0.1.0", "0.1.1", "0.2", "0.3"], false));
    await settle();
    expect(result.current.localSummary!.layers).toBe(0);
    expect(result.current.canConfirm).toBe(false);
  });

  it("si la base rechaza la confirmación vuelve a 'ready' con el motivo y se puede reintentar", async () => {
    h.svc.commitImport.mockRejectedValueOnce({ message: "importador: sin permiso", code: "42501" });
    const { result } = await open();
    await act(async () => { await result.current.confirm(); });
    expect(result.current.phase).toBe("ready");
    expect(result.current.failure).toMatchObject({ stage: "commit", error: { code: "42501" } });
    await act(async () => { await result.current.confirm(); });
    expect(result.current.phase).toBe("done");
    expect(h.svc.createImport).toHaveBeenCalledTimes(1); // el lote subido se reutiliza
  });

  it("si falla la subida lo explica y no queda un lote a medias", async () => {
    h.svc.uploadStaging.mockRejectedValueOnce({ message: "red", code: "x" });
    const { result } = await open();
    await act(async () => { await result.current.confirm(); });
    expect(result.current.phase).toBe("ready");
    expect(result.current.failure).toMatchObject({ stage: "upload", error: { message: "red" } });
    expect(h.svc.discardImport).toHaveBeenCalledWith("batch-1");
    expect(h.svc.commitImport).not.toHaveBeenCalled();
  });
});

describe("reemplazar y agregar (con diff)", () => {
  it("sube los puntos una sola vez, calcula el diff con debounce y recalcula al cambiar exclusiones sin volver a subir", async () => {
    const { result } = await open({ initialMode: "replace", initialTargetId: "capa" });
    expect(h.svc.createImport).not.toHaveBeenCalled();
    await settle(400);
    expect(h.svc.createImport).toHaveBeenCalledTimes(1);
    expect(h.svc.previewImport).toHaveBeenCalledWith("batch-1", "replace", "capa", new Set());
    expect(result.current.preview?.diff?.added).toBe(3);
    expect(result.current.rowsToWrite).toBe(6);
    expect(result.current.canConfirm).toBe(true);

    act(() => result.current.toggleLayers(["0.2"], false));
    act(() => result.current.toggleLayers(["0.3"], false));   // varios cambios seguidos → un solo cálculo
    await settle(400);
    expect(h.svc.previewImport).toHaveBeenCalledTimes(2);
    expect(h.svc.previewImport).toHaveBeenLastCalledWith("batch-1", "replace", "capa", new Set(["0.2", "0.3"]));
    expect(h.svc.createImport).toHaveBeenCalledTimes(1);
  });

  it("sin capa elegida no calcula ni sube nada", async () => {
    const { result } = await open({ initialMode: "replace" });
    await settle(1000);
    expect(h.svc.createImport).not.toHaveBeenCalled();
    expect(result.current.canConfirm).toBe(false);
  });

  it("si el cambio no cabe, no se puede confirmar", async () => {
    h.svc.previewImport.mockResolvedValue(preview({ fits: false, max_rows: 100, diff: { ...preview().diff, rows_to_write: 9000 } }));
    const { result } = await open({ initialMode: "append", initialTargetId: "capa" });
    await settle(400);
    expect(result.current.fits).toBe(false);
    expect(result.current.canConfirm).toBe(false);
  });

  it("confirma usando el lote ya subido", async () => {
    h.svc.commitImport.mockResolvedValue({ mode: "replace", features: 12, added: 3, removed: 2, modified: 1, unchanged: 4 });
    const { result } = await open({ initialMode: "replace", initialTargetId: "capa" });
    await settle(400);
    await act(async () => { await result.current.confirm(); });
    expect(h.svc.createImport).toHaveBeenCalledTimes(1);
    expect(h.svc.commitImport).toHaveBeenCalledWith("batch-1", "replace", "capa", new Set());
    expect(result.current.result).toMatchObject({ added: 3, removed: 2 });
  });

  it("un error del diff se muestra y no se puede confirmar", async () => {
    h.svc.previewImport.mockRejectedValueOnce({ message: "importador: el destino debe ser una capa existente", code: "23514" });
    const { result } = await open({ initialMode: "replace", initialTargetId: "carpeta" });
    await settle(400);
    expect(result.current.failure).toMatchObject({ stage: "preview" });
    expect(describeError(result.current.failure!.error).raw).toMatch(/el destino debe ser una capa existente/);
    expect(result.current.canConfirm).toBe(false);
  });
});

describe("cambiar de modo", () => {
  it("el destino de una carga nueva (carpeta) no sirve para actualizar (capa) y se recupera al volver", async () => {
    const { result } = await open({ initialMode: "new", initialTargetId: "carpeta" });
    act(() => result.current.setMode("replace"));
    expect(result.current.target).toBeNull();
    act(() => result.current.setTarget("capa"));
    act(() => result.current.setMode("append"));
    expect(result.current.target).toBe("capa"); // reemplazar → agregar: sigue siendo una capa
    act(() => result.current.setMode("new"));
    expect(result.current.target).toBe("carpeta");
  });

  it("si se suelta sobre una capa, parte en reemplazar con esa capa", async () => {
    const { result } = await open({ initialMode: "replace", initialTargetId: "capa" });
    expect(result.current.mode).toBe("replace");
    expect(result.current.target).toBe("capa");
    act(() => result.current.setMode("new"));
    expect(result.current.target).toBeNull();
  });
});

describe("descartar y deshacer", () => {
  it("cerrar sin confirmar descarta lo subido", async () => {
    const { unmount } = await open({ initialMode: "replace", initialTargetId: "capa" });
    await settle(400);
    unmount();
    expect(h.svc.discardImport).toHaveBeenCalledWith("batch-1");
  });

  it("cerrar después de confirmar NO descarta (queda el registro para deshacer)", async () => {
    const { result, unmount } = await open();
    await act(async () => { await result.current.confirm(); });
    unmount();
    expect(h.svc.discardImport).not.toHaveBeenCalled();
  });

  it("abrir otro archivo descarta el lote del anterior", async () => {
    const { rerender } = await open({ initialMode: "replace", initialTargetId: "capa" });
    await settle(400);
    rerender({ file: new File(["y"], "otro.kml"), initialMode: "replace", initialTargetId: "capa" });
    await settle(40);
    expect(h.svc.discardImport).toHaveBeenCalledWith("batch-1");
  });

  it("deshacer revierte el lote confirmado", async () => {
    const { result } = await open();
    await act(async () => { await result.current.confirm(); });
    await act(async () => { expect(await result.current.undo()).toBe(true); });
    expect(h.svc.revertImport).toHaveBeenCalledWith("batch-1");
    expect(result.current.reverted).toBe(true);
  });

  it("si deshacer falla, explica por qué", async () => {
    const { result } = await open();
    await act(async () => { await result.current.confirm(); });
    h.svc.revertImport.mockRejectedValueOnce({ message: "importador: esa capa tiene una importación posterior", code: "23514" });
    await act(async () => { expect(await result.current.undo()).toBe(false); });
    expect(result.current.reverted).toBe(false);
    expect(result.current.failure).toMatchObject({ stage: "undo" });
    expect(describeError(result.current.failure!.error).raw).toMatch(/importación posterior/);
  });
});

describe("nada falla en silencio", () => {
  it("si falla la subida en la vista previa, el fallo dice que fue al SUBIR (no al calcular)", async () => {
    h.svc.createImport.mockRejectedValueOnce({ message: "Failed to fetch" });
    const { result } = await open({ initialMode: "replace", initialTargetId: "capa" });
    await settle(400);
    expect(result.current.failure).toMatchObject({ stage: "upload" });
    expect(result.current.canConfirm).toBe(false);
  });

  it("si el descarte del lote falla al cerrar, queda registrado en la consola", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.svc.discardImport.mockRejectedValueOnce(new Error("sin red"));
    const { unmount } = await open({ initialMode: "replace", initialTargetId: "capa" });
    await settle(400);
    unmount();
    await settle(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no se pudo descartar el lote"), "batch-1", expect.any(Error));
    warn.mockRestore();
  });

  it("cambiar de modo limpia el fallo anterior (ya no corresponde)", async () => {
    h.svc.previewImport.mockRejectedValueOnce({ message: "importador: el destino debe ser una capa existente", code: "23514" });
    const { result } = await open({ initialMode: "replace", initialTargetId: "capa" });
    await settle(400);
    expect(result.current.failure).not.toBeNull();
    act(() => result.current.setMode("append"));
    expect(result.current.failure).toBeNull();
  });
});
