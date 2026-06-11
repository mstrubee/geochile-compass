/**
 * Tipos TypeScript para la Red Comercial Nacional (POIs OSM).
 */

export type ComercialCategoria =
  | "supermercado"
  | "conveniencia"
  | "farmacia"
  | "combustible"
  | "mejoramiento_hogar"
  | "retail_departamental"
  | "banco"
  | "restaurante"
  | "centro_comercial";

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
  conveniencia:         boolean;
  farmacia:             boolean;
  combustible:          boolean;
  mejoramiento_hogar:   boolean;
  retail_departamental: boolean;
  banco:                boolean;
  restaurante:          boolean;
  centro_comercial:     boolean;
}

export const COMERCIAL_LAYER_META: Record<
  ComercialCategoria,
  { label: string; icon: string; color: string; shortLabel: string }
> = {
  supermercado:         { label: "Supermercados",            icon: "🛒", color: "#0046AD", shortLabel: "Superm." },
  conveniencia:         { label: "Tiendas de conveniencia",  icon: "🏪", color: "#F59E0B", shortLabel: "Conveniencia" },
  farmacia:             { label: "Farmacias",                icon: "💊", color: "#00A651", shortLabel: "Farmacias" },
  combustible:          { label: "Estaciones de servicio",   icon: "⛽", color: "#EF4444", shortLabel: "Combustible" },
  mejoramiento_hogar:   { label: "Mejoramiento del hogar",   icon: "🔨", color: "#F5821F", shortLabel: "Hogar" },
  retail_departamental: { label: "Retail departamental",     icon: "🛍️", color: "#7C3AED", shortLabel: "Retail" },
  banco:                { label: "Bancos y ATMs",            icon: "🏦", color: "#1D4ED8", shortLabel: "Bancos" },
  restaurante:          { label: "Restaurantes",             icon: "🍽️", color: "#EA580C", shortLabel: "Restaurantes" },
  centro_comercial:     { label: "Centros comerciales",      icon: "🏬", color: "#BE123C", shortLabel: "Malls" },
};

/** Resumen por marca dentro de una categoría (para el panel flotante) */
export interface MarcaSummary {
  marca_estandar: string;
  total: number;
  color?: string;
  icon?: string;
  visible: boolean;
}
