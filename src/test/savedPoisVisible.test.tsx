import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSavedPoisVisible } from "@/hooks/useSavedPoisVisible";

describe("«Mostrar en mapa» de los POIs", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("arranca APAGADO al cargar la app", () => {
    const { result } = renderHook(() => useSavedPoisVisible());
    expect(result.current.visible).toBe(false);
  });

  it("una preferencia guardada en el navegador no los enciende", () => {
    for (const key of ["savedPoisVisible", "saved_pois_visible", "poi_visible", "show_pois"]) {
      localStorage.setItem(key, "true");
      sessionStorage.setItem(key, "true");
    }
    const { result } = renderHook(() => useSavedPoisVisible());
    expect(result.current.visible).toBe(false);
  });

  it("el usuario los enciende y apaga en la sesión; no escribe nada en el navegador", () => {
    const { result } = renderHook(() => useSavedPoisVisible());
    act(() => result.current.toggle());
    expect(result.current.visible).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.visible).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("enable() (activar una carpeta) los enciende y es idempotente", () => {
    const { result } = renderHook(() => useSavedPoisVisible());
    act(() => result.current.enable());
    act(() => result.current.enable());
    expect(result.current.visible).toBe(true);
  });

  it("una nueva carga (montaje nuevo) vuelve a apagado aunque antes estuviera encendido", () => {
    const first = renderHook(() => useSavedPoisVisible());
    act(() => first.result.current.enable());
    first.unmount();
    const second = renderHook(() => useSavedPoisVisible());
    expect(second.result.current.visible).toBe(false);
  });
});
