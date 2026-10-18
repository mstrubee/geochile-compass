import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toLayerNode, type LayerNode } from "@/types/layerNodes";
import { POI_PAGE_SIZE, type FeaturePreview, type FeaturePreviewItem } from "@/utils/layerTree";
import { buildTrashItems, type TrashItem } from "@/utils/layerTreeEdit";
import { fetchEmbeddedLayerIds, withoutEmbedded } from "@/utils/embeddedLayers";

export const LAYER_TREE_QUERY_KEY = ["layer-tree"] as const;

const DB_PAGE = 1000; // tope de filas por request de PostgREST

/** Trae todas las filas de una consulta paginando de a 1.000 (el tope de la API). */
const fetchAll = async <T,>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> => {
  const out: T[] = [];
  for (let from = 0; ; from += DB_PAGE) {
    const { data, error } = await page(from, from + DB_PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < DB_PAGE) break;
  }
  return out;
};

export interface LayerTreeData {
  nodes: LayerNode[];
  /** `territorial_layers.feature_count` por capa. */
  featureCounts: Map<string, number>;
}

const fetchLayerTreeData = async (): Promise<LayerTreeData> => {
  const [nodes, counts, embedded] = await Promise.all([
    // Los administradores también ven lo archivado (política de lectura): acá solo lo activo.
    fetchAll((from, to) =>
      supabase.from("layer_nodes").select("*").is("archived_at", null).order("id").range(from, to),
    ),
    fetchAll((from, to) => supabase.from("territorial_layers").select("id,feature_count").order("id").range(from, to)),
    fetchEmbeddedLayerIds(),
  ]);
  return {
    // las capas incrustadas en el panel de otra (CASEN dentro de Isapre) no tienen nodo visible
    nodes: withoutEmbedded(nodes.map(toLayerNode), embedded),
    featureCounts: new Map(counts.map((c) => [c.id, c.feature_count ?? 0])),
  };
};

/**
 * El árbol completo (carpetas y capas activas). Lo comparten el panel lateral y
 * el mapa, así que se pide una sola vez.
 */
export const useLayerTreeData = () =>
  useQuery({
    queryKey: [...LAYER_TREE_QUERY_KEY, "data"],
    queryFn: fetchLayerTreeData,
    staleTime: 60_000,
  });

const fetchFeaturePage = async (layerId: string, page: number): Promise<FeaturePreviewItem[]> => {
  const from = page * POI_PAGE_SIZE;
  // Columnas explícitas: así no viaja `geometry`/`geom`, que no hace falta para listar.
  const { data, error } = await supabase
    .from("territorial_features")
    .select("id,name,lat,lng")
    .eq("layer_id", layerId)
    .order("name", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + POI_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as FeaturePreviewItem[];
};

/**
 * Puntos de las capas que el usuario expandió, de a `POI_PAGE_SIZE`.
 * `requested`: capa → cuántas páginas pedir. Una capa que nadie expandió no
 * consulta nada.
 */
export const useLayerFeaturePreviews = (
  requested: Readonly<Record<string, number>>,
  featureCounts?: ReadonlyMap<string, number>,
): Map<string, FeaturePreview> => {
  const specs = useMemo(
    () => Object.entries(requested).flatMap(([layerId, pages]) => Array.from({ length: pages }, (_, page) => ({ layerId, page }))),
    [requested],
  );

  const results = useQueries({
    queries: specs.map(({ layerId, page }) => ({
      queryKey: [...LAYER_TREE_QUERY_KEY, "features", layerId, page],
      queryFn: () => fetchFeaturePage(layerId, page),
      staleTime: 5 * 60_000,
    })),
  });

  // `results` es un arreglo nuevo en cada render; la firma evita rearmar el mapa si nada cambió.
  const signature = results.map((r) => `${r.status}:${r.fetchStatus}:${r.dataUpdatedAt}`).join("|");
  return useMemo(() => {
    const byLayer = new Map<string, { pages: (typeof results)[number][] }>();
    specs.forEach((s, i) => {
      const entry = byLayer.get(s.layerId) ?? { pages: [] };
      entry.pages[s.page] = results[i];
      byLayer.set(s.layerId, entry);
    });

    const out = new Map<string, FeaturePreview>();
    for (const [layerId, { pages }] of byLayer) {
      const items = pages.flatMap((p) => p.data ?? []);
      const last = pages[pages.length - 1];
      const total = featureCounts?.get(layerId);
      out.set(layerId, {
        items,
        loading: pages.some((p) => p.isPending || (p.isFetching && !p.data)),
        error: pages.some((p) => p.isError),
        hasMore:
          last.isSuccess && (last.data?.length ?? 0) === POI_PAGE_SIZE && (total === undefined || items.length < total),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specs, signature, featureCounts]);
};

/**
 * Lo que hay en la papelera (solo lo ven los administradores: la política de
 * lectura oculta lo archivado a los demás). Se consulta recién al abrirla.
 */
export const useTrash = (enabled: boolean) =>
  useQuery({
    queryKey: [...LAYER_TREE_QUERY_KEY, "trash"],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<TrashItem[]> => {
      const rows = await fetchAll((from, to) =>
        supabase.from("layer_nodes").select("*").not("archived_at", "is", null).order("id").range(from, to),
      );
      const archived = rows.map(toLayerNode);
      // Nombre de la carpeta de origen (puede seguir activa).
      const parents = [...new Set(archived.map((n) => n.parent_id).filter((id): id is string => !!id))];
      const names = new Map<string, string>();
      for (let i = 0; i < parents.length; i += 200) {
        const { data } = await supabase.from("layer_nodes").select("id,name").in("id", parents.slice(i, i + 200)).is("archived_at", null);
        for (const r of data ?? []) names.set(r.id, r.name);
      }
      return buildTrashItems(archived, names);
    },
  });
