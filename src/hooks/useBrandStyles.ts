/**
 * useBrandStyles
 * ─────────────
 * Gestión de estilos por marca para la capa de competidores de maquinaria.
 * Persiste en localStorage y sincroniza entre instancias del hook mediante
 * un CustomEvent, sin necesidad de Context ni prop-drilling.
 */

import { useCallback, useEffect, useState } from "react";
import type { AgroplanetCompetitor } from "./useAgroplanetCompetitors";

export interface BrandStyle {
  color: string;
  icon: string | null;   // null = mostrar número, emoji, URL, o base64
  iconSize: number;      // 12–40 px (tamaño del marcador en el mapa)
  visible: boolean;
}

const STORAGE_KEY    = "agro_brand_styles_v1";
const SYNC_EVENT     = "agroBrandStylesChanged";

// ── Colores por defecto ──────────────────────────────────────────────────────

const BRAND_COLOR_MAP: Array<[string, string]> = [
  ["john deere",          "#367C2B"],
  ["new holland",         "#003B7B"],
  ["case ih",             "#C41230"],
  ["case",                "#C41230"],
  ["massey ferguson",     "#CC0000"],
  ["claas",               "#B5CC18"],
  ["kubota",              "#E8701A"],
  ["deutz",               "#009B3A"],
  ["agco",                "#6633CC"],
  ["krone",               "#006B3C"],
  ["fendt",               "#3C7D2D"],
  ["same",                "#E63900"],
  ["tienda agraria",      "#78716C"],
  ["maquinaria agricola", "#92400E"],
  ["taller agricola",     "#0369A1"],
];

export const defaultColorForBrand = (brand: string): string => {
  const lower = brand.toLowerCase();
  for (const [key, color] of BRAND_COLOR_MAP) {
    if (lower.includes(key)) return color;
  }
  // Generar color determinístico a partir del hash del nombre
  let h = 0;
  for (let i = 0; i < brand.length; i++) h = (h * 31 + brand.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue},55%,42%)`;
};

// ── Conversión categoría → nombre de marca ───────────────────────────────────

export const getBrandKey = (c: AgroplanetCompetitor): string => {
  if (c.marca?.trim()) return c.marca.trim();
  // Categorías "tienda_*" son tipos genéricos de comercio (ej. tienda_agraria);
  // en esos casos el nombre real del local es más informativo que la categoría.
  // Así "Agroriego Tattersall" y "Tattersall Agroinsumos" aparecen por su nombre
  // real en lugar de quedar sepultados bajo un genérico "Agraria (50)".
  if (c.categoria.startsWith("tienda_") && c.nombre?.trim()) {
    return c.nombre.trim();
  }
  return c.categoria
    .replace(/^(dealer_|tienda_|taller_|maquinaria_)/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

// ── Utilidades de storage ────────────────────────────────────────────────────

type StylesMap = Record<string, BrandStyle>;

const loadStyles = (): StylesMap => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};

const persistStyles = (s: StylesMap) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  } catch {/* ignore quota errors */}
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBrandStyles() {
  const [styles, setStyles] = useState<StylesMap>(loadStyles);

  // Escuchar cambios hechos desde otra instancia del hook (sidebar ↔ mapa)
  useEffect(() => {
    const handleSync = () => setStyles(loadStyles());
    window.addEventListener(SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  }, []);

  /** Devuelve el estilo actual de una marca (con defaults si no está configurado). */
  const getStyle = useCallback(
    (brand: string): BrandStyle =>
      styles[brand] ?? {
        color:    defaultColorForBrand(brand),
        icon:     null,
        iconSize: 18,
        visible:  true,
      },
    [styles],
  );

  /** Actualiza campos parciales del estilo de una marca. */
  const setBrandStyle = useCallback((brand: string, patch: Partial<BrandStyle>) => {
    setStyles((prev) => {
      const cur: BrandStyle = prev[brand] ?? {
        color:    defaultColorForBrand(brand),
        icon:     null,
        iconSize: 18,
        visible:  true,
      };
      const next = { ...prev, [brand]: { ...cur, ...patch } };
      persistStyles(next);
      return next;
    });
  }, []);

  /** Elimina el estilo personalizado (vuelve a los valores por defecto). */
  const resetBrandStyle = useCallback((brand: string) => {
    setStyles((prev) => {
      const next = { ...prev };
      delete next[brand];
      persistStyles(next);
      return next;
    });
  }, []);

  return { getStyle, setBrandStyle, resetBrandStyle };
}
