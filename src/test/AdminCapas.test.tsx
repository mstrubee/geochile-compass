import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AdminCapas from "@/pages/AdminCapas";

const toastError = vi.hoisted(() => vi.fn());
const files = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit"]) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: files.rows, error: null }).then(ok, bad);
      return q;
    },
    storage: { from: () => ({ remove: vi.fn() }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ isAdmin: true, loading: false }) }));
vi.mock("@/hooks/useLayerTree", () => ({
  LAYER_TREE_QUERY_KEY: ["layer-tree"],
  useLayerTreeData: () => ({ data: { nodes: [{ id: "F1", kind: "folder", name: "Farmacias" }], featureCounts: new Map() } }),
}));
// Secciones que esta prueba no ejerce.
vi.mock("@/components/admin/UsersAdminSection", () => ({ UsersAdminSection: () => null }));
vi.mock("@/components/admin/GeminiKeysAdminSection", () => ({ GeminiKeysAdminSection: () => null }));
vi.mock("@/components/admin/SecretsAdminSection", () => ({ SecretsAdminSection: () => null }));
vi.mock("@/components/admin/StorageAdminSection", () => ({ StorageAdminSection: () => null }));
vi.mock("@/components/admin/MaturationCurveAdminSection", () => ({ MaturationCurveAdminSection: () => null }));
vi.mock("@/components/admin/ExpressAdjustAdminSection", () => ({ ExpressAdjustAdminSection: () => null }));
vi.mock("@/components/admin/DriveSpeedsAdminSection", () => ({ DriveSpeedsAdminSection: () => null }));
vi.mock("@/components/admin/GeocodeAddressesDialog", () => ({ GeocodeAddressesDialog: () => null }));
vi.mock("@/scripts/inject-parque-features", () => ({ injectParqueFeatures: vi.fn() }));
vi.mock("@/components/layerImport/ImportWizard", () => ({
  ImportWizard: (p: { file: File; nodes: { id: string }[]; onClose: () => void }) => (
    <div data-testid="wizard" data-file={p.file.name} data-nodes={p.nodes.length}>
      <button type="button" onClick={p.onClose}>cerrar asistente</button>
    </div>
  ),
}));

const mount = async () => {
  const qc = new QueryClient();
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AdminCapas />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return qc;
};

const openCapas = async () => {
  const header = screen.getByRole("button", { name: /Capas territoriales/ });
  if (!screen.queryByLabelText("Archivo a importar")) await act(async () => { fireEvent.click(header); });
};

describe("AdminCapas — carga de capas con el asistente", () => {
  beforeEach(() => {
    toastError.mockClear();
    files.rows = [];
    localStorage.clear();
  });

  it("elegir un archivo abre el asistente con los nodos del árbol para escoger destino", async () => {
    await mount();
    await openCapas();
    const input = screen.getByLabelText("Archivo a importar") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", ".kmz,.kml,.geojson,.json,.csv,.html,.htm");
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "tiendas.kmz")] } }); });
    const w = await screen.findByTestId("wizard");
    expect(w).toHaveAttribute("data-file", "tiendas.kmz");
    expect(w).toHaveAttribute("data-nodes", "1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "cerrar asistente" })); });
    expect(screen.queryByTestId("wizard")).toBeNull();
  });

  it("un formato no soportado no abre el asistente y lo dice", async () => {
    await mount();
    await openCapas();
    const input = screen.getByLabelText("Archivo a importar") as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "mapa.shp")] } }); });
    expect(screen.queryByTestId("wizard")).toBeNull();
    expect(toastError).toHaveBeenCalledWith("Formato no soportado", expect.objectContaining({ description: expect.stringContaining("HTML") }));
  });

  it("ya no ofrece la administración antigua de grupos ni el reprocesado", async () => {
    files.rows = [
      { id: "f1", original_filename: "direcciones.csv", file_type: "csv", status: "done", uploaded_at: "2026-08-01T00:00:00Z", storage_path: "x", group_id: null, error: null, gdrive_file_id: null },
    ];
    await mount();
    await openCapas();
    expect(screen.queryByPlaceholderText(/Nombre del grupo/)).toBeNull();
    expect(screen.queryByTitle(/Reprocesar archivo/)).toBeNull();
    expect(screen.queryByTitle(/Convertir a GeoJSON/)).toBeNull();
    expect(await screen.findByText("direcciones.csv")).toBeInTheDocument();
    expect(screen.getByTitle("Georreferenciar direcciones de este CSV")).toBeInTheDocument();
    expect(screen.getByTitle("Eliminar del historial")).toBeInTheDocument();
  });
});
