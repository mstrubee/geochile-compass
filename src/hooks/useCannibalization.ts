import { useEffect, useRef, useState } from "react";
import bboxFn from "@turf/bbox";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { supabase } from "@/integrations/supabase/client";
import { gseService } from "@/services/gseService";
import {
  computeCannibalization,
  type CannibalizationResult,
} from "@/services/cannibalizationService";

/**
 * Canibalización de una ubicación nueva contra los locales propios.
 *
 * Vive en un hook aparte y no dentro de `computeSalesProjection` porque necesita
 * datos que la proyección no tiene —las manzanas GSE del área y el GeoJSON del
 * parque— y porque el informe la necesita incluso cuando nadie corrió la
 * proyección.
 *
 * El resultado se guarda JUNTO A LA CLAVE del área a la que corresponde: si se
 * limpiara en un efecto, alcanzaría a pintarse un render con las cifras de la
 * isócrona anterior, y un informe exportado en esa ventana saldría con datos del
 * área equivocada.
 */
export const useCannibalization = ({
  folderId,
  isoFeature,
  isoMinutes,
  totalPop,
  totalVehiculos,
  enabled = true,
}: {
  folderId: string | null;
  isoFeature: Feature<Polygon | MultiPolygon> | null | undefined;
  isoMinutes: number | null | undefined;
  totalPop: number;
  totalVehiculos: number;
  enabled?: boolean;
}) => {
  const [state, setState] = useState<{
    key: string | null;
    data: CannibalizationResult | null;
  }>({ key: null, data: null });
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const key =
    enabled && folderId && isoFeature && isoMinutes
      ? `${folderId}|${isoMinutes}|${JSON.stringify(bboxFn(isoFeature as never))}|${totalPop}|${totalVehiculos}`
      : null;

  useEffect(() => {
    if (!key || !folderId || !isoFeature || !isoMinutes) {
      setState({ key: null, data: null });
      return;
    }
    const my = ++reqId.current;
    setLoading(true);
    (async () => {
      try {
        const { data: pois } = await supabase
          .from("pois")
          .select("id, name, lat, lng")
          .eq("folder_id", folderId)
          .is("deleted_at", null);

        const peers = (pois ?? [])
          .filter((p) => p.lat != null && p.lng != null)
          .map((p) => ({
            id: p.id as string,
            name: (p.name as string) ?? "Local",
            lat: Number(p.lat),
            lng: Number(p.lng),
          }));

        // Manzanas del área para medir la población del solape. Se piden por
        // bbox de la isócrona con tope alto: es la misma fuente que usa el
        // informe, así que las cifras coinciden.
        const [w, s, e, n] = bboxFn(isoFeature as never) as [number, number, number, number];
        const gse = await gseService
          .fetchGse({ west: w, south: s, east: e, north: n, variable: "gse", zoom: 13, maxFeatures: 200_000 })
          .catch(() => null);

        const res = await computeCannibalization({
          folderId, isoFeature, isoMinutes, peers, gse, totalPop, totalVehiculos,
        });
        if (my !== reqId.current) return;
        setState({ key, data: res });
      } catch (err) {
        if (my !== reqId.current) return;
        console.warn("[useCannibalization] error", err);
        setState({ key, data: null });
      } finally {
        if (my === reqId.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { cannibalization: state.key === key ? state.data : null, loading };
};
