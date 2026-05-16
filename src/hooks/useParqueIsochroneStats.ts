// ============================================================================
// useParqueIsochroneStats.ts
//
// Calcula estadísticas del parque automotor dentro de un polígono de isócrona.
// Cliente-side: usa el GeoJSON pre-procesado en /parque/parque_h3_agregado.geojson
// con ponderación por fracción de área intersectada.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { feature as turfFeature, featureCollection } from "@turf/helpers";
import area from "@turf/area";
import intersect from "@turf/intersect";
import bboxFn from "@turf/bbox";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { useParqueLayer } from "./useParqueLayer";

interface MarcaCount {
  marca: string;
  count: number;
}

interface HexProps {
  count: number;
  edad_med: number;
  edad_p25: number;
  edad_p75: number;
  top_marcas: MarcaCount[];
}

export interface ParqueIsochroneStats {
  vehiculos: number;
  edad_media: number;
  edad_p25: number;
  edad_p75: number;
  ranking_marcas: { marca: string; count: number; pct: number }[];
}

let _cache: FeatureCollection<Polygon, HexProps> | null = null;
let _cachePromise: Promise<FeatureCollection<Polygon, HexProps>> | null = null;

async function loadParqueGeoJson(): Promise<FeatureCollection<Polygon, HexProps>> {
  if (_cache) return _cache;
  if (_cachePromise) return _cachePromise;
  _cachePromise = fetch("/parque/parque_h3_agregado.geojson")
    .then((r) => r.json())
    .then((j) => {
      _cache = j;
      return j;
    });
  return _cachePromise;
}

function bboxOverlap(a: number[], b: number[]): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

export function useParqueIsochroneStats(
  isoFeature: Feature<Polygon | MultiPolygon, unknown> | null,
): { stats: ParqueIsochroneStats | null; loading: boolean; enabled: boolean } {
  const { visible } = useParqueLayer();
  const [stats, setStats] = useState<ParqueIsochroneStats | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const key = useMemo(() => {
    if (!isoFeature) return null;
    try {
      return JSON.stringify(isoFeature.geometry).slice(0, 200);
    } catch {
      return null;
    }
  }, [isoFeature]);

  useEffect(() => {
    if (!visible || !isoFeature) {
      setStats(null);
      return;
    }
    const myReq = ++reqId.current;
    setLoading(true);

    loadParqueGeoJson()
      .then((fc) => {
        if (myReq !== reqId.current) return;
        const isoBbox = bboxFn(isoFeature as any);
        const isoPoly = turfFeature(isoFeature.geometry as any);

        let vehiculos = 0;
        let edadMedSum = 0;
        let edadP25Sum = 0;
        let edadP75Sum = 0;
        const marcaMap = new Map<string, number>();

        for (const hex of fc.features) {
          const hb = bboxFn(hex as any);
          if (!bboxOverlap(hb, isoBbox)) continue;
          let inter: any;
          try {
            inter = intersect(
              featureCollection([isoPoly as any, hex as any]) as any,
            );
          } catch {
            continue;
          }
          if (!inter) continue;
          const hexArea = area(hex as any);
          if (hexArea <= 0) continue;
          const pct = Math.min(1, area(inter) / hexArea);
          if (pct <= 0) continue;
          const cw = hex.properties.count * pct;
          vehiculos += cw;
          edadMedSum += hex.properties.edad_med * cw;
          edadP25Sum += hex.properties.edad_p25 * cw;
          edadP75Sum += hex.properties.edad_p75 * cw;
          for (const m of hex.properties.top_marcas ?? []) {
            marcaMap.set(m.marca, (marcaMap.get(m.marca) ?? 0) + m.count * pct);
          }
        }

        if (vehiculos <= 0) {
          setStats({
            vehiculos: 0,
            edad_media: 0,
            edad_p25: 0,
            edad_p75: 0,
            ranking_marcas: [],
          });
        } else {
          const totMarcas = Array.from(marcaMap.values()).reduce((a, b) => a + b, 0);
          const ranking = Array.from(marcaMap.entries())
            .map(([marca, count]) => ({
              marca,
              count,
              pct: totMarcas > 0 ? (count / totMarcas) * 100 : 0,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
          setStats({
            vehiculos,
            edad_media: edadMedSum / vehiculos,
            edad_p25: edadP25Sum / vehiculos,
            edad_p75: edadP75Sum / vehiculos,
            ranking_marcas: ranking,
          });
        }
      })
      .catch((e) => {
        console.error("[useParqueIsochroneStats]", e);
        if (myReq === reqId.current) setStats(null);
      })
      .finally(() => {
        if (myReq === reqId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);

  return { stats, loading, enabled: visible };
}
