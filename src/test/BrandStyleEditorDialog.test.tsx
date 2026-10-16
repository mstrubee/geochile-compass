import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const lib = vi.hoisted(() => ({
  icons: [] as { path: string; label: string; url: string }[],
  uploaded: [] as string[][],
  isAdmin: false,
}));

vi.mock("@/services/layerIconLibrary", () => ({
  MAX_ICON_BYTES: 512 * 1024,
  listLibraryIcons: async () => lib.icons,
  uploadLibraryIcons: async (files: File[]) => {
    lib.uploaded.push(files.map((f) => f.name));
    return { uploaded: files.map((f) => ({ path: f.name, label: f.name, url: `https://cdn.test/${f.name}` })), rejected: [] };
  },
  deleteLibraryIcon: async () => undefined,
}));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ isAdmin: lib.isAdmin, loading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BrandStyleEditorDialog } from "@/components/panels/BrandStyleEditorDialog";

// El Slider de Radix mide con ResizeObserver, que jsdom no trae.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const style = { color: "#10B981", icon: null, iconSize: 22, visible: true };

const renderDialog = (onSave = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<BrandStyleEditorDialog brand="Farmacias" currentStyle={style} onSave={onSave} onReset={vi.fn()} onClose={vi.fn()} />, { wrapper: wrap });
  return onSave;
};

beforeEach(() => {
  lib.icons = [{ path: "banco-abc123.png", label: "banco", url: "https://cdn.test/banco-abc123.png" }];
  lib.uploaded = [];
  lib.isAdmin = false;
});

describe("BrandStyleEditorDialog — tamaño", () => {
  it("es el doble de ancho que antes (max-w-3xl = 768 px en vez de max-w-sm = 384 px)", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-w-3xl");
    expect(dialog.className).not.toContain("max-w-sm");
  });
});

describe("BrandStyleEditorDialog — biblioteca de íconos PNG", () => {
  it("muestra los íconos de la biblioteca compartida y al elegir uno lo guarda como ícono de la carpeta", async () => {
    const onSave = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Usar ícono banco" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onSave).toHaveBeenCalledWith("Farmacias", expect.objectContaining({ icon: "https://cdn.test/banco-abc123.png" }));
  });

  it("el botón SUBIR acepta varios PNG o ZIP, y lo subido aparece como ícono elegido", async () => {
    const onSave = renderDialog();
    expect(screen.getByRole("button", { name: /SUBIR/ })).toBeTruthy();
    const input = screen.getByLabelText("Subir íconos PNG") as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain("image/png");

    const files = [new File(["x"], "uno.png", { type: "image/png" }), new File(["y"], "dos.png", { type: "image/png" })];
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(lib.uploaded).toEqual([["uno.png", "dos.png"]]));
  });

  it("subir un solo ícono lo deja seleccionado", async () => {
    const onSave = renderDialog();
    const input = screen.getByLabelText("Subir íconos PNG") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "solo.png", { type: "image/png" })] } });
    await waitFor(() => expect(lib.uploaded).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onSave).toHaveBeenCalledWith("Farmacias", expect.objectContaining({ icon: "https://cdn.test/solo.png" }));
  });

  it("solo los administradores ven el botón para eliminar un ícono de la biblioteca", async () => {
    renderDialog();
    await screen.findByRole("button", { name: "Usar ícono banco" });
    expect(screen.queryByRole("button", { name: "Eliminar ícono banco" })).toBeNull();
  });

  it("los administradores sí pueden eliminar", async () => {
    lib.isAdmin = true;
    renderDialog();
    expect(await screen.findByRole("button", { name: "Eliminar ícono banco" })).toBeTruthy();
  });

  it("sin íconos muestra cómo agregar el primero", async () => {
    lib.icons = [];
    renderDialog();
    expect(await screen.findByText(/Aún no hay íconos/)).toBeTruthy();
  });
});
