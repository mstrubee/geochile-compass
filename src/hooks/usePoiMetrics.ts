import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  PoiFolderSchema,
  PoiMetric,
  PoiAttribute,
  PoiAddressAlias,
} from "@/types/poiMetrics";

/* ------------------ Folder schemas ------------------------ */

export const usePoiFolderSchemas = () => {
  const [schemas, setSchemas] = useState<PoiFolderSchema[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("poi_folder_schemas")
      .select("*");
    if (error) {
      console.warn("[usePoiFolderSchemas]", error.message);
      setSchemas([]);
    } else {
      setSchemas((data ?? []) as unknown as PoiFolderSchema[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsertSchema = useCallback(
    async (s: Partial<PoiFolderSchema> & { folder_id: string }) => {
      const { error } = await supabase
        .from("poi_folder_schemas")
        .upsert(s as never, { onConflict: "folder_id" });
      if (error) throw error;
      await refresh();
    },
    [refresh],
  );

  const removeSchema = useCallback(
    async (folder_id: string) => {
      const { error } = await supabase
        .from("poi_folder_schemas")
        .delete()
        .eq("folder_id", folder_id);
      if (error) throw error;
      await refresh();
    },
    [refresh],
  );

  return { schemas, loading, refresh, upsertSchema, removeSchema };
};

/* ------------------ POI metrics --------------------------- */

/**
 * Hook para cargar el histórico de métricas de UN poi (para el detalle).
 * No mantiene el set completo en memoria — sólo el del poi enfocado.
 */
export const usePoiMetrics = (poiId: string | null) => {
  const [metrics, setMetrics] = useState<PoiMetric[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (!poiId) {
      setMetrics([]);
      return;
    }
    setLoading(true);
    supabase
      .from("poi_metrics")
      .select("*")
      .eq("poi_id", poiId)
      .order("period", { ascending: true })
      .then(({ data, error }) => {
        if (cancel) return;
        if (error) {
          console.warn("[usePoiMetrics]", error.message);
          setMetrics([]);
        } else {
          setMetrics((data ?? []) as unknown as PoiMetric[]);
        }
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [poiId]);

  return { metrics, loading };
};

/**
 * Atributos estáticos de un poi (Centro Sap, Gerente Zonal, etc.)
 */
export const usePoiAttributes = (poiId: string | null) => {
  const [attrs, setAttrs] = useState<PoiAttribute[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (!poiId) {
      setAttrs([]);
      return;
    }
    setLoading(true);
    supabase
      .from("poi_attributes")
      .select("*")
      .eq("poi_id", poiId)
      .then(({ data, error }) => {
        if (cancel) return;
        if (error) {
          console.warn("[usePoiAttributes]", error.message);
          setAttrs([]);
        } else {
          setAttrs((data ?? []) as unknown as PoiAttribute[]);
        }
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [poiId]);

  return { attrs, loading };
};

/**
 * Aliases: solo los del scope (e.g. todos los aliases de POIs en una carpeta).
 * Lo cargamos al iniciar el flujo de import.
 */
export const fetchAliasesForPois = async (
  poiIds: string[],
): Promise<PoiAddressAlias[]> => {
  if (poiIds.length === 0) return [];
  const { data, error } = await supabase
    .from("poi_address_aliases")
    .select("*")
    .in("poi_id", poiIds);
  if (error) {
    console.warn("[fetchAliasesForPois]", error.message);
    return [];
  }
  return (data ?? []) as unknown as PoiAddressAlias[];
};
