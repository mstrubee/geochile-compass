import { supabase } from "@/integrations/supabase/client";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import type { IsoMode } from "@/types/isochrones";

export interface IsochroneRequest {
  mode: IsoMode;
  lat: number;
  lng: number;
  minutes: number[];
}

export async function fetchIsochrone(
  req: IsochroneRequest,
): Promise<Feature<Polygon | MultiPolygon, { value: number }>[]> {
  const { data, error } = await supabase.functions.invoke<FeatureCollection | string>(
    "isochrone",
    { body: req },
  );
  if (error) throw new Error(error.message);
  let parsed: FeatureCollection | null = null;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data) as FeatureCollection;
    } catch {
      parsed = null;
    }
  } else if (data && typeof data === "object") {
    parsed = data as FeatureCollection;
  }
  if (!parsed || !Array.isArray(parsed.features)) {
    console.error("Isochrone invalid payload:", data);
    throw new Error("Respuesta inválida del servicio de isócronas");
  }
  const feats = parsed.features as Feature<Polygon | MultiPolygon, { value: number }>[];
  return [...feats].sort(
    (a, b) => (b.properties?.value ?? 0) - (a.properties?.value ?? 0),
  );
}
