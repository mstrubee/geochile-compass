import type { Feature, FeatureCollection, Point } from "geojson";

export interface SavedPoi {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  color: string | null;
  icon: string | null;
  lat: number;
  lng: number;
  properties: Record<string, unknown>;
  source_layer: string | null;
  folder_id: string | null;
  created_at: string;
}

export interface PoiInsert {
  name: string;
  description?: string | null;
  category?: string | null;
  color?: string | null;
  icon?: string | null;
  lat: number;
  lng: number;
  properties?: Record<string, unknown>;
  source_layer?: string | null;
  folder_id?: string | null;
}

export interface PoiUpdate {
  name?: string;
  description?: string | null;
  category?: string | null;
  color?: string | null;
  folder_id?: string | null;
}

export interface PoiFolder {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
}

export const featureName = (f: Feature, fallback: string): string => {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  return (
    (typeof p.name === "string" && p.name) ||
    (typeof p.Name === "string" && p.Name) ||
    (typeof p.title === "string" && p.title) ||
    (typeof p.NOMBRE === "string" && p.NOMBRE) ||
    fallback
  );
};

export const extractPointPois = (
  fc: FeatureCollection,
  source_layer: string,
  defaults: { color?: string } = {},
): PoiInsert[] => {
  const items: PoiInsert[] = [];
  fc.features.forEach((f, idx) => {
    if (!f.geometry || f.geometry.type !== "Point") return;
    const [lng, lat] = (f.geometry as Point).coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") return;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    items.push({
      name: featureName(f, `POI ${idx + 1}`),
      description:
        (typeof props.description === "string" && props.description) ||
        (typeof props.Description === "string" && props.Description) ||
        null,
      category:
        (typeof props.category === "string" && props.category) ||
        (typeof props.type === "string" && props.type) ||
        null,
      color:
        (typeof props["marker-color"] === "string" && props["marker-color"]) ||
        defaults.color ||
        null,
      icon:
        (typeof props.icon === "string" && props.icon) ||
        (typeof props["marker-symbol"] === "string" &&
          props["marker-symbol"]) ||
        null,
      lat,
      lng,
      properties: props,
      source_layer,
    });
  });
  return items;
};

export const countPoints = (fc: FeatureCollection): number =>
  fc.features.filter((f) => f.geometry?.type === "Point").length;
