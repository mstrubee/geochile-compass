/**
 * Tipos TypeScript para la Red Comercial Nacional (POIs OSM).
 * ComercialCategoria es ahora `string` para soportar categorías dinámicas desde la DB.
 */

export type ComercialCategoria = string;

export interface ComercialPOI {
  id: number;
  osm_id: string;
  nombre: string | null;
  marca: string | null;
  marca_estandar: string | null;
  categoria: string;
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

/** Record dinámico: clave = category.key de la DB */
export type ComercialLayerState = Record<string, boolean>;

/** Metadata estática de las 9 categorías originales — usada como fallback si la DB no carga */
export const COMERCIAL_LAYER_META: Record<string, { label: string; icon: string; color: string; shortLabel: string }> = {
  supermercado:         { label: "Supermercados",           icon: "🛒", color: "#0046AD", shortLabel: "Superm."     },
  conveniencia:         { label: "Tiendas de conveniencia", icon: "🏪", color: "#F59E0B", shortLabel: "Conveniencia"},
  farmacia:             { label: "Farmacias",               icon: "💊", color: "#00A651", shortLabel: "Farmacias"   },
  combustible:          { label: "Estaciones de servicio",  icon: "⛽", color: "#EF4444", shortLabel: "Combustible" },
  mejoramiento_hogar:   { label: "Mejoramiento del hogar",  icon: "🔨", color: "#F5821F", shortLabel: "Hogar"       },
  retail_departamental: { label: "Retail departamental",    icon: "🛍️", color: "#7C3AED", shortLabel: "Retail"      },
  banco:                { label: "Bancos y ATMs",           icon: "🏦", color: "#1D4ED8", shortLabel: "Bancos"      },
  restaurante:          { label: "Restaurantes",            icon: "🍽️", color: "#EA580C", shortLabel: "Restaurantes"},
  centro_comercial:     { label: "Centros comerciales",     icon: "🏬", color: "#BE123C", shortLabel: "Malls"       },
};

/** Resumen por marca dentro de una categoría (para el panel flotante) */
export interface MarcaSummary {
  marca_estandar: string;
  total: number;
  color?: string;
  icon?: string;
  visible: boolean;
}
