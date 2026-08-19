import type { Feature, MultiPolygon, Polygon } from "geojson";
import { supabase } from "@/integrations/supabase/client";

/**
 * Isócronas persistidas por local.
 *
 * Antes cada consumidor pedía la isócrona de un local a ORS al vuelo. Guardarlas
 * hace que la canibalización sea una intersección de geometrías ya calculadas,
 * saca el recálculo de features de la dependencia con ORS, y permite mostrar la
 * isócrona de un local en el mapa a demanda.
 */

const TABLE = "poi_isochrones";

/** Tolerancia para considerar que el local no se movió (~11 m). */
const COORD_EPS = 1e-4;

export interface PoiIsochrone {
  poiId: string;
  mode: string;
  minutes: number;
  geometry: Polygon | MultiPolygon;
  originLat: number;
  originLng: number;
  computedAt: string;
}

const toIso = (r: any): PoiIsochrone => ({
  poiId: r.poi_id,
  mode: r.mode,
  minutes: r.minutes,
  geometry: r.geometry as Polygon | MultiPolygon,
  originLat: Number(r.origin_lat),
  originLng: Number(r.origin_lng),
  computedAt: r.computed_at,
});

/** Isócronas guardadas de varios locales, en una sola consulta. */
export const fetchPoiIsochrones = async (
  poiIds: string[],
  minutes: number,
  mode = "driving-car",
): Promise<Map<string, PoiIsochrone>> => {
  const out = new Map<string, PoiIsochrone>();
  if (poiIds.length === 0) return out;
  // Se pagina por si la red crece: `in` con cientos de uuid arma una URL larga.
  const CHUNK = 200;
  for (let i = 0; i < poiIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from(TABLE as never)
      .select("*")
      .eq("mode", mode)
      .eq("minutes", minutes)
      .in("poi_id", poiIds.slice(i, i + CHUNK));
    if (error) throw error;
    for (const r of (data ?? []) as any[]) out.set(r.poi_id, toIso(r));
  }
  return out;
};

/** Isócrona de un solo local, o null si no está generada. */
export const fetchPoiIsochrone = async (
  poiId: string,
  minutes: number,
  mode = "driving-car",
): Promise<PoiIsochrone | null> => {
  const { data, error } = await supabase
    .from(TABLE as never)
    .select("*")
    .eq("poi_id", poiId)
    .eq("mode", mode)
    .eq("minutes", minutes)
    .maybeSingle();
  if (error) throw error;
  return data ? toIso(data) : null;
};

/**
 * Todas las isócronas guardadas de un local, sin importar minutos.
 * Sirve para el menú contextual: se ofrece lo que ya existe.
 */
export const fetchPoiIsochroneVariants = async (
  poiId: string,
): Promise<PoiIsochrone[]> => {
  const { data, error } = await supabase
    .from(TABLE as never)
    .select("*")
    .eq("poi_id", poiId)
    .order("minutes", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map(toIso);
};

/** true si la isócrona guardada ya no corresponde a la posición del local. */
export const isStale = (
  iso: PoiIsochrone,
  lat: number,
  lng: number,
): boolean =>
  Math.abs(iso.originLat - lat) > COORD_EPS ||
  Math.abs(iso.originLng - lng) > COORD_EPS;

export const savePoiIsochrone = async (params: {
  poiId: string;
  minutes: number;
  mode?: string;
  geometry: Polygon | MultiPolygon;
  lat: number;
  lng: number;
}): Promise<void> => {
  const { error } = await supabase
    .from(TABLE as never)
    .upsert(
      {
        poi_id: params.poiId,
        mode: params.mode ?? "driving-car",
        minutes: params.minutes,
        geometry: params.geometry as never,
        origin_lat: params.lat,
        origin_lng: params.lng,
        computed_at: new Date().toISOString(),
      } as never,
      { onConflict: "poi_id,mode,minutes" },
    );
  if (error) throw error;
};

/** Pide una isócrona a la edge function. */
export const requestIsochrone = async (
  lat: number,
  lng: number,
  minutes: number,
  mode = "driving-car",
): Promise<Polygon | MultiPolygon> => {
  const { data, error } = await supabase.functions.invoke("isochrone", {
    body: { mode, lat, lng, minutes: [minutes] },
  });
  if (error) throw error;
  const fc = data as {
    features?: Array<Feature<Polygon | MultiPolygon, { value: number }>>;
  };
  const geom = fc.features?.[0]?.geometry;
  if (!geom) throw new Error("La respuesta de isócrona no trae geometría");
  return geom;
};

export interface GenerateProgress {
  done: number;
  total: number;
  skipped: number;
  failed: number;
  currentName?: string;
}

/**
 * Genera y guarda las isócronas que faltan.
 *
 * Salta las que ya están y siguen correspondiendo a la posición del local: el
 * objetivo es que una segunda corrida no vuelva a gastar llamadas a ORS. Con
 * `force` se regeneran todas.
 *
 * La concurrencia es baja a propósito: ORS tiene rate limit y el error que
 * devuelve al excederlo es un 429 que arruinaría el lote completo.
 */
export const generateMissingPoiIsochrones = async (
  pois: Array<{ id: string; name?: string | null; lat: number; lng: number; minutes: number }>,
  opts: { mode?: string; force?: boolean; concurrency?: number; onProgress?: (p: GenerateProgress) => void } = {},
): Promise<GenerateProgress> => {
  const mode = opts.mode ?? "driving-car";
  const concurrency = opts.concurrency ?? 2;

  // Se agrupa por `minutes` para consultar lo existente de una sola vez por grupo.
  const existing = new Map<string, PoiIsochrone>();
  for (const m of new Set(pois.map((p) => p.minutes))) {
    const got = await fetchPoiIsochrones(
      pois.filter((p) => p.minutes === m).map((p) => p.id), m, mode,
    );
    for (const [k, v] of got) existing.set(`${k}|${m}`, v);
  }

  const pending = pois.filter((p) => {
    if (opts.force) return true;
    const cur = existing.get(`${p.id}|${p.minutes}`);
    return !cur || isStale(cur, p.lat, p.lng);
  });

  const progress: GenerateProgress = {
    done: 0,
    total: pending.length,
    skipped: pois.length - pending.length,
    failed: 0,
  };
  opts.onProgress?.({ ...progress });

  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= pending.length) return;
      const p = pending[i];
      try {
        const geom = await requestIsochrone(p.lat, p.lng, p.minutes, mode);
        await savePoiIsochrone({
          poiId: p.id, minutes: p.minutes, mode, geometry: geom, lat: p.lat, lng: p.lng,
        });
      } catch (e) {
        // Un local que falla no debe abortar el lote: se cuenta y se sigue.
        progress.failed += 1;
        console.warn(`[poiIsochrones] falló ${p.name ?? p.id}`, e);
      }
      progress.done += 1;
      opts.onProgress?.({ ...progress, currentName: p.name ?? undefined });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()),
  );
  return progress;
};
