import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import bbox from "@turf/bbox";
import type { Isochrone } from "@/types/isochrones";
import type { ManzanaFeatureCollection } from "@/types/manzanas";
import type { GseFeatureCollection } from "@/types/gse";
import type { ParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";
import {
  useTerritorialLayers,
  useTerritorialFeatures,
} from "@/hooks/useTerritorialLayers";
import { useComunasGeoIndex } from "@/hooks/useComunasGeoIndex";
import { normalizeCommuneName } from "@/services/communeDataService";
import { gseService } from "@/services/gseService";
import { pickBandFeature } from "@/utils/isochroneAnalysis";
import {
  fetchCommerceCategories,
  type CommerceCategory,
  type CommerceItem,
} from "@/services/commerceService";
import {
  buildIsochroneReport,
  type IsochroneReport,
} from "@/utils/reportData";
import type { IneCommuneStats } from "@/utils/ineScales";

interface Params {
  isochrone: Isochrone | null;
  isoName?: string | null;
  manzanas?: ManzanaFeatureCollection | null;
  gse?: GseFeatureCollection | null;
  parqueStats?: ParqueIsochroneStats | null;
}

/**
 * Hook que centraliza el armado del informe completo de una isócrona.
 *  - carga features territoriales (vía hooks existentes)
 *  - mantiene un estado de comercios fetcheados desde Overpass
 *  - re-construye el `IsochroneReport` cuando cualquiera cambia
 */
export const useIsochroneReport = ({
  isochrone,
  isoName = null,
  manzanas = null,
  gse = null,
  parqueStats = null,
}: Params) => {
  const { groups, layers } = useTerritorialLayers();
  const layerIds = useMemo(() => layers.map((l) => l.id), [layers]);
  const features = useTerritorialFeatures(layerIds);
  const comunas = useComunasGeoIndex(true);

  const [commerceByCategory, setCommerceByCategory] = useState<
    Record<string, CommerceItem[]>
  >({});
  const [categoriesQueried, setCategoriesQueried] = useState<CommerceCategory[]>([]);
  const [commerceErrors, setCommerceErrors] = useState<Record<string, string>>({});
  const [commerceLoading, setCommerceLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset de comercios cuando cambia la isócrona objetivo.
  useEffect(() => {
    setCommerceByCategory({});
    setCategoriesQueried([]);
    setCommerceErrors({});
    abortRef.current?.abort();
    abortRef.current = null;
  }, [isochrone?.id]);

  const ineByName = useMemo(() => {
    const out = new Map<string, IneCommuneStats>();
    const names = comunas.nombresPorCodigo;
    for (const codigo of Object.keys(names)) {
      const nombre = names[codigo];
      const stats = comunas.getIneStats(codigo, nombre);
      if (stats) out.set(normalizeCommuneName(nombre), stats);
    }
    return out;
  }, [comunas]);

  /** Bbox del polígono mayor con padding del 5%, para queries Overpass. */
  const outerBboxPadded = useMemo(() => {
    if (!isochrone) return null;
    const largest = pickBandFeature(isochrone.features);
    if (!largest) return null;
    const [w, s, e, n] = bbox(largest as never) as [number, number, number, number];
    const dx = (e - w) * 0.05;
    const dy = (n - s) * 0.05;
    return { south: s - dy, west: w - dx, north: n + dy, east: e + dx };
  }, [isochrone]);

  /**
   * Manzanas GSE del área de la isócrona.
   *
   * Se cargan aquí, por bbox de la isócrona, en vez de reutilizar las del mapa:
   * aquellas solo existen si el usuario tiene encendida la capa "GSE por
   * manzana" y están acotadas al viewport, así que el informe quedaba sin datos
   * y caía al promedio comunal (que asigna una sola clase por comuna y borra
   * la heterogeneidad real del área).
   */
  const [gseForIso, setGseForIso] = useState<GseFeatureCollection | null>(null);
  useEffect(() => {
    if (!outerBboxPadded) {
      setGseForIso(null);
      return;
    }
    let cancelled = false;
    gseService
      // maxFeatures alto: acá no se renderiza, y truncar subestimaría la
      // población y la distribución GSE de isócronas grandes.
      .fetchGse({ ...outerBboxPadded, variable: "gse", zoom: 13, maxFeatures: 200_000 })
      .then((res) => { if (!cancelled) setGseForIso(res); })
      .catch(() => { if (!cancelled) setGseForIso(null); });
    return () => { cancelled = true; };
  }, [outerBboxPadded]);

  const fetchCommerce = useCallback(
    async (categories: CommerceCategory[]) => {
      if (!isochrone || !outerBboxPadded || categories.length === 0) return;
      // Cancelar petición previa si existiera.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setCommerceLoading(true);
      try {
        const { byCategory, errors } = await fetchCommerceCategories(
          categories,
          outerBboxPadded,
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        setCommerceByCategory((prev) => ({ ...prev, ...byCategory }));
        setCategoriesQueried((prev) => {
          const map = new Map<string, CommerceCategory>();
          for (const c of prev) map.set(c.id, c);
          for (const c of categories) map.set(c.id, c);
          return Array.from(map.values());
        });
        setCommerceErrors((prev) => ({ ...prev, ...errors }));
      } finally {
        if (!ctrl.signal.aborted) setCommerceLoading(false);
      }
    },
    [isochrone, outerBboxPadded],
  );

  const clearCommerce = useCallback(() => {
    abortRef.current?.abort();
    setCommerceByCategory({});
    setCategoriesQueried([]);
    setCommerceErrors({});
  }, []);

  const report: IsochroneReport | null = useMemo(() => {
    if (!isochrone) return null;
    return buildIsochroneReport({
      iso: isochrone,
      isoName,
      territorialFeatures: features,
      territorialLayers: layers,
      territorialGroups: groups,
      comunasFC: comunas.fc,
      ineByName,
      nombresPorCodigo: comunas.nombresPorCodigo,
      manzanas,
      // Las del área de la isócrona tienen prioridad; las del mapa solo sirven
      // como respaldo mientras la carga por bbox está en vuelo.
      gse: gseForIso ?? gse,
      parqueStats,
      commerceByCategory,
      categoriesQueried,
      commerceErrors,
    });
  }, [
    isochrone,
    isoName,
    features,
    layers,
    groups,
    comunas,
    ineByName,
    manzanas,
    gse,
    gseForIso,
    parqueStats,
    commerceByCategory,
    categoriesQueried,
    commerceErrors,
  ]);

  return {
    report,
    commerceLoading,
    fetchCommerce,
    clearCommerce,
    categoriesQueried,
    commerceErrors,
  };
};
