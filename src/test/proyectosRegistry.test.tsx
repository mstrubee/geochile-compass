import { describe, expect, it, vi } from "vitest";
vi.mock("@/services/seiaService", () => ({
  fetchSeiaProjects: vi.fn(), fetchSeiaFacets: vi.fn(), fetchSeiaProject: vi.fn(), fetchSeiaProvenance: vi.fn(),
}));   // el registro importa el dataset del SEIA, que llegaría al cliente real de Supabase (exige variables de entorno)

import { buildRegistry, REGISTRY } from "@/components/map/proyectos/registry";

const Dummy = () => null;

describe("registro de datasets de puntos", () => {
  it("descubre solo el dataset del SEIA en proyectos/datasets", () => {
    expect([...REGISTRY.datasets.keys()]).toEqual(["seia_projects"]);
    expect(REGISTRY.duplicates).toEqual([]);
    expect(typeof REGISTRY.datasets.get("seia_projects")?.Layer).toBe("function");
  });
  it("un archivo nuevo en datasets/ agrega su dataset sin tocar a los demás", () => {
    const seia = { dataset: "seia_projects", Layer: Dummy };
    const ine = { dataset: "ine_permits", Layer: Dummy };
    const r = buildRegistry({ "./datasets/seia.tsx": { default: seia }, "./datasets/ine.tsx": { default: ine } });
    expect([...r.datasets.keys()].sort()).toEqual(["ine_permits", "seia_projects"]);
    expect(r.datasets.get("seia_projects")).toBe(seia);
  });
  it("módulos inválidos se ignoran con un error en consola, sin romper", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = buildRegistry({
      "./datasets/a.tsx": {}, "./datasets/b.tsx": { default: { dataset: "", Layer: Dummy } },
      "./datasets/c.tsx": { default: { dataset: "x" } as never }, "./datasets/ok.tsx": { default: { dataset: "ok", Layer: Dummy } },
    });
    expect([...r.datasets.keys()]).toEqual(["ok"]);
    expect(err).toHaveBeenCalledTimes(3);
    err.mockRestore();
  });
  it("un dataset declarado dos veces conserva el PRIMERO (orden de ruta) y lo registra", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = { dataset: "dup", Layer: Dummy }, b = { dataset: "dup", Layer: Dummy };
    const r = buildRegistry({ "./datasets/z.tsx": { default: b }, "./datasets/a.tsx": { default: a } });
    expect(r.datasets.get("dup")).toBe(a);
    expect(r.duplicates).toEqual(["dup"]);
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});
