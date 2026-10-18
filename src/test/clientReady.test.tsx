/**
 * client_ready (regla 6) en las capturas de mapa para informes.
 *
 * - Helper puro (`src/utils/clientReady.ts`).
 * - El proveedor REAL de visibilidad del árbol: apagar y volver a encender las capas deja el MISMO conjunto.
 * - Estructura de `captureAtractoresOnly` y `captureIsochroneMapImages` en `Index.tsx`: ambas apagan las capas del árbol que no
 *   son client_ready ANTES de fotografiar y las restauran en `finally` (también si la captura falla). `Index` es demasiado
 *   grande para montarlo en jsdom, así que se verifica leyendo el código; el comportamiento del proveedor se prueba aparte.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { filterClientReady, isClientReady, visibleIdsToHideForCapture } from "@/utils/clientReady";
import { TerritorialVisibilityProvider, useTerritorialVisibility } from "@/hooks/useTerritorialVisibility";

const L = (id: string, client_ready?: boolean | null) => ({ id, client_ready });

describe("isClientReady / filterClientReady", () => {
  it("sin bandera (undefined o null) cuenta como lista: no cambia el comportamiento actual", () => {
    expect(isClientReady(L("a"))).toBe(true);
    expect(isClientReady(L("a", null))).toBe(true);
    expect(isClientReady(L("a", true))).toBe(true);
  });
  it("solo `false` deja una capa fuera", () => {
    expect(isClientReady(L("a", false))).toBe(false);
    expect(filterClientReady([L("a"), L("b", false), L("c", true), L("d", null)]).map((l) => l.id)).toEqual(["a", "c", "d"]);
  });
});

describe("visibleIdsToHideForCapture", () => {
  const layers = [L("ok"), L("salud", false), L("lista", true), L("oculta-no-lista", false)];

  it("apaga solo las visibles que NO son client_ready", () => {
    expect(visibleIdsToHideForCapture(new Set(["ok", "salud", "lista"]), layers)).toEqual(["salud"]);
  });
  it("no toca las que están apagadas (aunque no sean client_ready) ni las que el analista dejó visibles y sí lo son", () => {
    expect(visibleIdsToHideForCapture(new Set(["ok", "lista"]), layers)).toEqual([]);
    expect(visibleIdsToHideForCapture(new Set(), layers)).toEqual([]);
  });
  it("hoy, sin ninguna bandera, no apaga nada: el comportamiento actual de las fotos no cambia", () => {
    expect(visibleIdsToHideForCapture(new Set(["a", "b"]), [L("a"), L("b")])).toEqual([]);
  });
  it("ids visibles sin capa cargada no se pintan: no hay nada que apagar", () => {
    expect(visibleIdsToHideForCapture(new Set(["fantasma"]), layers)).toEqual([]);
  });
});

describe("proveedor de visibilidad del árbol: apagar y restaurar", () => {
  beforeEach(() => localStorage.clear());
  const wrapper = ({ children }: { children: ReactNode }) => <TerritorialVisibilityProvider>{children}</TerritorialVisibilityProvider>;

  it("deja exactamente el mismo conjunto visible tras apagar y volver a encender", () => {
    const { result } = renderHook(() => useTerritorialVisibility(), { wrapper });
    act(() => result.current.setLayers(["a", "b", "salud"], true));
    const before = [...result.current.visibleLayerIds].sort();

    const hidden = visibleIdsToHideForCapture(result.current.visibleLayerIds, [L("a"), L("b"), L("salud", false)]);
    act(() => result.current.setLayers(hidden, false));
    expect(result.current.isVisible("salud")).toBe(false);
    expect(result.current.isVisible("a") && result.current.isVisible("b")).toBe(true);

    act(() => result.current.setLayers(hidden, true));
    expect([...result.current.visibleLayerIds].sort()).toEqual(before);
  });

  it("si no hay nada que apagar, apagar y restaurar con una lista vacía no cambia nada", () => {
    const { result } = renderHook(() => useTerritorialVisibility(), { wrapper });
    act(() => result.current.setLayers(["a"], true));
    const before = [...result.current.visibleLayerIds];
    act(() => result.current.setLayers([], false));
    act(() => result.current.setLayers([], true));
    expect([...result.current.visibleLayerIds]).toEqual(before);
  });
});

describe("estructura de las capturas de mapa en Index.tsx", () => {
  const src = readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf-8");
  const fnBody = (name: string, next: string) => {
    const i = src.indexOf(`const ${name} = useCallback(`);
    const j = src.indexOf(next, i + 1);
    expect(i, `no se encontró ${name}`).toBeGreaterThan(-1);
    expect(j, `no se encontró el límite ${next}`).toBeGreaterThan(i);
    return src.slice(i, j);
  };
  const atractores = fnBody("captureAtractoresOnly", "const captureIsochroneMapImages = useCallback(");
  const completa = fnBody("captureIsochroneMapImages", "// Isócronas\n  const [isoMode");

  for (const [nombre, body] of [["captureAtractoresOnly", atractores], ["captureIsochroneMapImages", completa]] as const) {
    it(`${nombre}: calcula qué apagar, lo apaga antes de la primera foto y lo restaura en finally`, () => {
      expect(body).toContain("visibleIdsToHideForCapture(treeVisibleIds, treeLayers)");
      const hide = body.indexOf("setTreeLayersVisible(treeHidden, false)");
      const firstShot = body.indexOf("captureAfterSettle(");
      const fin = body.indexOf("} finally {");
      const restore = body.indexOf("setTreeLayersVisible(treeHidden, true)");
      expect(hide).toBeGreaterThan(-1);
      expect(hide).toBeLessThan(firstShot);
      expect(fin).toBeGreaterThan(firstShot);
      expect(restore).toBeGreaterThan(fin);                       // la restauración está dentro del finally
    });
    it(`${nombre}: las dependencias del useCallback incluyen la visibilidad y las capas del árbol`, () => {
      expect(body).toMatch(/\[[^\]]*treeVisibleIds[^\]]*treeLayers[^\]]*setTreeLayersVisible[^\]]*\]/);
    });
  }
});
