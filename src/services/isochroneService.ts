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
  const { data, error } = await supabase.functions.invoke<FeatureCollection>(
    "isochrone",
    { body: req },
  );
  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data.features)) {
    throw new Error("Respuesta inválida del servicio de isócronas");
  }
  // ORS devuelve features con properties.value (segundos). Ordenar mayor->menor para dibujar bien.
  const feats = data.features as Feature<Polygon | MultiPolygon, { value: number }>[];
  return [...feats].sort(
    (a, b) => (b.properties?.value ?? 0) - (a.properties?.value ?? 0),
  );
}
