import { supabase } from "@/integrations/supabase/client";
import type { KmzFeature, KmzNode } from "@/utils/kmzExport";
import type { TreeRow } from "@/utils/layerTree";

const PAGE = 1000;

/** Todos los puntos de una capa (con geometría y atributos), de a 1.000. */
export const fetchLayerFeaturesForExport = async (layerId: string): Promise<KmzFeature[]> => {
  const out: KmzFeature[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("territorial_features")
      .select("id,name,lat,lng,geometry,properties")
      .eq("layer_id", layerId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const f of data ?? []) {
      out.push({
        name: f.name,
        geometry: (f.geometry as unknown as GeoJSON.Geometry | null) ?? (f.lng != null && f.lat != null ? { type: "Point", coordinates: [f.lng, f.lat] } : null),
        properties: (f.properties ?? {}) as Record<string, unknown>,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
};

/** Árbol del panel → estructura exportable, trayendo los puntos de cada capa (una a la vez). */
export const buildKmzTree = async (
  row: TreeRow,
  onLayer?: (done: number) => void,
  fetchFeatures: (layerId: string) => Promise<KmzFeature[]> = fetchLayerFeaturesForExport,
): Promise<KmzNode> => {
  let done = 0;
  const walk = async (r: TreeRow): Promise<KmzNode> => {
    const color = r.node?.style.color ?? null;
    if (r.kind === "layer") {
      const features = await fetchFeatures(r.id);
      onLayer?.(++done);
      return { name: r.name, color, features };
    }
    const children: KmzNode[] = [];
    for (const c of r.children ?? []) {
      if (c.kind === "folder" || c.kind === "layer") children.push(await walk(c));
    }
    return { name: r.name, color, children };
  };
  return walk(row);
};

export interface NodeBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Rectángulo que contiene todos los puntos de un nodo (calculado en la base con PostGIS). */
export const fetchNodeBounds = async (nodeId: string): Promise<NodeBounds | null> => {
  const { data, error } = await supabase.rpc("get_node_bounds", { p_node_id: nodeId });
  if (error) throw new Error(error.message);
  const b = data as unknown as Partial<NodeBounds> | null;
  if (!b || [b.west, b.south, b.east, b.north].some((v) => typeof v !== "number")) return null;
  return b as NodeBounds;
};
