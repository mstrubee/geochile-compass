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
    if (!g.error) setGroups((g.data ?? []) as TerritorialGroup[]);
    if (!l.error) setLayers((l.data ?? []) as TerritorialLayer[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { groups, layers, loading, refresh };
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
    (async () => {
      // Page in chunks of 1000 — RLS read.
      const all: TerritorialFeature[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("territorial_features")
          .select("id,layer_id,name,lat,lng,geometry,properties")
          .in("layer_id", layerIds)
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        all.push(...(data as unknown as TerritorialFeature[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (!cancel) setFeatures(all);
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return features;
};
