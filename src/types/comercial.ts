/**
 * Tipos TypeScript para la Red Comercial Nacional (POIs OSM).
 */

export type ComercialCategoria =
  | "supermercado"
  | "farmacia"
  | "combustible"
  | "ferreteria"
  | "retail_departamental"
  | "banco"
  | "restaurante"
  | "automotriz"
  | "bodega";

export interface ComercialPOI {
  id: number;
  osm_id: string;
  nombre: string | null;
  marca: string | null;
  marca_estandar: string | null;
  categoria: ComercialCategoria;
  subcategoria: string | null;
  cadena: string | null;
  direccion: string | null;
  comuna: string | null;
  region: string | null;
  latitud: number;
  longitud: number;
  fuente: string;
  fecha_actualizacion: string;
}

export interface ComercialLayerState {
  supermercado:         boolean;
  farmacia:             boolean;
  combustible:          boolean;
  ferreteria:           boolean;
  retail_departamental: boolean;
  banco:                boolean;
  restaurante:          boolean;
  automotriz:           boolean;
  bodega:               boolean;
}

export const COMERCIAL_LAYER_META: Record<
  ComercialCategoria,
  { label: string; icon: string; color: string; shortLabel: string }
> = {
  supermercado:         { label: "Supermercados",            icon: "🛒", color: "#0046AD", shortLabel: "Superm." },
  farmacia:             { label: "Farmacias",                icon: "💊", color: "#00A651", shortLabel: "Farmacias" },
  combustible:          { label: "Estaciones de servicio",   icon: "⛽", color: "#EF4444", shortLabel: "Combustible" },
  ferreteria:           { label: "Ferreterías",              icon: "🔨", color: "#F5821F", shortLabel: "Ferreterías" },
  retail_departamental: { label: "Retail departamental",     icon: "🛍️", color: "#7C3AED", shortLabel: "Retail" },
  banco:                { label: "Bancos y ATMs",            icon: "🏦", color: "#1D4ED8", shortLabel: "Bancos" },
  restaurante:          { label: "Restaurantes",             icon: "🍽️", color: "#EA580C", shortLabel: "Restaurantes" },
  automotriz:           { label: "Automotriz",               icon: "🚗", color: "#374151", shortLabel: "Automotriz" },
  bodega:               { label: "Bodegas",                  icon: "📦", color: "#92400E", shortLabel: "Bodegas" },
};

/** Resumen por marca dentro de una categoría (para el panel flotante) */
export interface MarcaSummary {
  marca_estandar: string;
  total: number;
  color?: string;
  icon?: string;
  visible: boolean;
}
