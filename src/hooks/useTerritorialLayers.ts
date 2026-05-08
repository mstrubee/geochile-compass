import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TerritorialGroup, TerritorialLayer, TerritorialFeature } from "@/types/territorial";

export const useTerritorialLayers = () => {
  const [groups, setGroups] = useState<TerritorialGroup[]>([]);
  const [layers, setLayers] = useState<TerritorialLayer[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, l] = await Promise.all([
      supabase.from("territorial_layer_groups").select("*").order("order_index", { ascending: true }),
      supabase.from("territorial_layers").select("*").order("order_index", { ascending: true }),
    ]);
    if (!g.error) setGroups((g.data ?? []) as unknown as TerritorialGroup[]);
    if (!l.error) setLayers((l.data ?? []) as unknown as TerritorialLayer[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { groups, layers, loading, refresh };
};

// Caché de features por layer_id, sobrevive a remounts dentro de la sesión.
const featuresCache = new Map<string, TerritorialFeature[]>();
const inflightCache = new Map<string, Promise<TerritorialFeature[]>>();

export const clearTerritorialFeaturesCache = (layerId?: string) => {
  if (layerId) {
    featuresCache.delete(layerId);
    inflightCache.delete(layerId);
  } else {
    featuresCache.clear();
    inflightCache.clear();
  }
};

const PAGE = 1000;
// Para capas grandes, omitir geometry/properties (no se usan en el render
// actual cuando las features son puntos).
const HEAVY_GEOM_THRESHOLD = 1500;

const fetchLayerFeatures = async (layerId: string): Promise<TerritorialFeature[]> => {
  // Obtener feature_count para saber cuántas páginas pedir en paralelo.
  const { data: meta } = await supabase
    .from("territorial_layers")
    .select("feature_count")
    .eq("id", layerId)
    .maybeSingle();
  const total = meta?.feature_count ?? 0;

  const heavy = total > HEAVY_GEOM_THRESHOLD;
  const cols = heavy
    ? "id,layer_id,name,lat,lng"
    : "id,layer_id,name,lat,lng,geometry,properties";

  // Si no sabemos el total, hacer una primera página y seguir si hay más.
  if (!total) {
    const { data, error } = await supabase
      .from("territorial_features")
      .select(cols)
      .eq("layer_id", layerId)
      .range(0, PAGE - 1);
    if (error || !data) return [];
    const all = [...(data as unknown as TerritorialFeature[])];
    let from = PAGE;
    while (all.length === from) {
      const { data: more } = await supabase
        .from("territorial_features")
        .select(cols)
        .eq("layer_id", layerId)
        .range(from, from + PAGE - 1);
      if (!more || !more.length) break;
      all.push(...(more as unknown as TerritorialFeature[]));
      from += PAGE;
    }
    return all.map((f) => ({
      ...f,
      geometry: f.geometry ?? ({ type: "Point", coordinates: [f.lng ?? 0, f.lat ?? 0] } as GeoJSON.Geometry),
      properties: f.properties ?? {},
    }));
  }

  // Paginación en paralelo.
  const pageCount = Math.ceil(total / PAGE);
  const results = await Promise.all(
    Array.from({ length: pageCount }, (_, i) =>
      supabase
        .from("territorial_features")
        .select(cols)
        .eq("layer_id", layerId)
        .range(i * PAGE, i * PAGE + PAGE - 1)
        .then((r) => (r.data ?? []) as unknown as TerritorialFeature[]),
    ),
  );
  const flat = results.flat();
  // Si vinimos en modo "heavy" sin geometry, sintetizar Point para los renders que la requieran.
  return flat.map((f) => ({
    ...f,
    geometry: f.geometry ?? ({ type: "Point", coordinates: [f.lng ?? 0, f.lat ?? 0] } as GeoJSON.Geometry),
    properties: f.properties ?? {},
  }));
};

const getLayerFeatures = (layerId: string): Promise<TerritorialFeature[]> => {
  const cached = featuresCache.get(layerId);
  if (cached) return Promise.resolve(cached);
  const inflight = inflightCache.get(layerId);
  if (inflight) return inflight;
  const p = fetchLayerFeatures(layerId)
    .then((feats) => {
      featuresCache.set(layerId, feats);
      inflightCache.delete(layerId);
      return feats;
    })
    .catch((e) => {
      inflightCache.delete(layerId);
      throw e;
    });
  inflightCache.set(layerId, p);
  return p;
};

export const useTerritorialFeatures = (layerIds: string[]) => {
  const [features, setFeatures] = useState<TerritorialFeature[]>([]);
  const key = layerIds.slice().sort().join(",");

  useEffect(() => {
    let cancel = false;
    if (!layerIds.length) {
      setFeatures([]);
      return;
    }

    // Mostrar inmediatamente lo cacheado mientras se cargan las capas faltantes.
    const cachedNow: TerritorialFeature[] = [];
    layerIds.forEach((id) => {
      const c = featuresCache.get(id);
      if (c) cachedNow.push(...c);
    });
    if (cachedNow.length) setFeatures(cachedNow);

    (async () => {
      try {
        const lists = await Promise.all(layerIds.map((id) => getLayerFeatures(id)));
        if (cancel) return;
        setFeatures(lists.flat());
      } catch (e) {
        if (!cancel) console.warn("[useTerritorialFeatures] error", e);
      }
    })();

    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return features;
};
