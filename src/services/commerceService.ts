import type { Feature, Point } from "geojson";
import {
  OVERPASS_PRESETS,
  fetchOverpassPreset,
  fetchOverpassFreeText,
  type OverpassBbox,
  type OverpassPreset,
} from "./overpassService";

/**
 * Categorías de comercios disponibles en el informe de isócrona.
 * Las primeras vienen de los presets globales; el usuario puede agregar
 * categorías libres por texto (e.g. "banco", "colegio") con id="free:<text>".
 */

export interface CommerceCategory {
  id: string; // preset id o `free:<query>`
  label: string;
  isFreeText: boolean;
}

/** Categorías por defecto que se ofrecen como checkboxes en el informe. */
export const DEFAULT_COMMERCE_CATEGORIES: CommerceCategory[] = [
  { id: "supermarket", label: "Supermercados", isFreeText: false },
  { id: "pharmacy", label: "Farmacias", isFreeText: false },
  { id: "fuel", label: "Estaciones de servicio", isFreeText: false },
  { id: "restaurant", label: "Restaurantes", isFreeText: false },
  { id: "car_repair", label: "Talleres automotrices", isFreeText: false },
];

export const buildFreeTextCategory = (text: string): CommerceCategory => ({
  id: `free:${text.trim().toLowerCase()}`,
  label: text.trim(),
  isFreeText: true,
});

const presetById = (id: string): OverpassPreset | undefined =>
  OVERPASS_PRESETS.find((p) => p.id === id);

export interface CommerceItem {
  osmId: string; // `${type}/${id}` para evitar colisiones entre node/way/relation
  name: string;
  brand: string | null;
  lat: number;
  lng: number;
  categoryId: string;
  categoryLabel: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  tags: Record<string, string>;
}

const featureToItem = (
  f: Feature<Point>,
  category: CommerceCategory,
): CommerceItem | null => {
  const coords = f.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const props = (f.properties ?? {}) as Record<string, string>;
  const osmType = (props.osm_type as string) ?? "node";
  const osmRawId = (props.osm_id as string | number | undefined) ?? "";
  const addrParts = [
    props["addr:street"],
    props["addr:housenumber"],
    props["addr:city"],
  ].filter(Boolean);
  return {
    osmId: `${osmType}/${osmRawId}`,
    name: (props.name as string) || (props.brand as string) || category.label,
    brand: (props.brand as string) || null,
    lat,
    lng,
    categoryId: category.id,
    categoryLabel: category.label,
    address: addrParts.length ? addrParts.join(" ") : null,
    phone:
      (props.phone as string) ||
      (props["contact:phone"] as string) ||
      null,
    website:
      (props.website as string) ||
      (props["contact:website"] as string) ||
      null,
    openingHours: (props.opening_hours as string) || null,
    tags: props,
  };
};

/**
 * Ejecuta una sola categoría contra Overpass y devuelve items normalizados.
 * Para presets usa la query Overpass del preset; para free-text usa el
 * buscador genérico.
 */
export const fetchCommerceCategory = async (
  category: CommerceCategory,
  bbox: OverpassBbox,
  signal?: AbortSignal,
): Promise<CommerceItem[]> => {
  let fc;
  if (category.isFreeText) {
    const txt = category.id.startsWith("free:")
      ? category.id.slice("free:".length)
      : category.label;
    fc = await fetchOverpassFreeText(txt, bbox, signal);
  } else {
    const preset = presetById(category.id);
    if (!preset) throw new Error(`Categoría desconocida: ${category.id}`);
    fc = await fetchOverpassPreset(preset.id, bbox, signal);
  }
  const out: CommerceItem[] = [];
  for (const f of fc.features as Feature<Point>[]) {
    const item = featureToItem(f, category);
    if (item) out.push(item);
  }
  // Dedupe defensivo por osmId.
  const seen = new Set<string>();
  return out.filter((it) => {
    if (seen.has(it.osmId)) return false;
    seen.add(it.osmId);
    return true;
  });
};

/**
 * Ejecuta varias categorías en paralelo. Devuelve un mapa categoryId -> items.
 * Errores por categoría no abortan el resto; se reportan en el campo `errors`.
 */
export const fetchCommerceCategories = async (
  categories: CommerceCategory[],
  bbox: OverpassBbox,
  signal?: AbortSignal,
): Promise<{
  byCategory: Record<string, CommerceItem[]>;
  errors: Record<string, string>;
}> => {
  const byCategory: Record<string, CommerceItem[]> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    categories.map(async (cat) => {
      try {
        byCategory[cat.id] = await fetchCommerceCategory(cat, bbox, signal);
      } catch (e) {
        errors[cat.id] = e instanceof Error ? e.message : "Error desconocido";
        byCategory[cat.id] = [];
      }
    }),
  );
  return { byCategory, errors };
};
