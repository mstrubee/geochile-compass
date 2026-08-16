import { useEffect, useMemo, useState } from "react";
import type { Isochrone } from "@/types/isochrones";
import type { ManzanaFeatureCollection } from "@/types/manzanas";
import type { GseFeatureCollection } from "@/types/gse";
import { useTerritorialLayers, useTerritorialFeatures } from "@/hooks/useTerritorialLayers";
import { useComunasGeoIndex } from "@/hooks/useComunasGeoIndex";
import { gseService } from "@/services/gseService";
import {
  computeIsochroneAnalysis,
  pickBandFeature,
  type IsochroneAnalysis,
} from "@/utils/isochroneAnalysis";
import type { IneCommuneStats } from "@/utils/ineScales";
import { normalizeCommuneName } from "@/services/communeDataService";

interface Params {
  isochrone: Isochrone | null;
  bandSeconds?: number;
  manzanas?: ManzanaFeatureCollection | null;
}

const buildIneByName = (
  comunas: ReturnType<typeof useComunasGeoIndex>,
): Map<string, IneCommuneStats> => {
  const out = new Map<string, IneCommuneStats>();
  const names = comunas.nombresPorCodigo;
  for (const codigo of Object.keys(names)) {
    const nombre = names[codigo];
    const stats = comunas.getIneStats(codigo, nombre);
    if (stats) out.set(normalizeCommuneName(nombre), stats);
  }
  return out;
};

const computeIsoBbox = (
  feat: ReturnType<typeof pickBandFeature>,
): [number, number, number, number] | null => {
  if (!feat) return null;
  const rings: number[][][] =
    feat.geometry.type === "Polygon"
      ? feat.geometry.coordinates
      : feat.geometry.coordinates.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
};

export const useIsochroneAnalysis = ({
  isochrone,
  bandSeconds,
  manzanas = null,
}: Params): IsochroneAnalysis | null => {
  const { groups, layers } = useTerritorialLayers();
  const layerIds = useMemo(() => layers.map((l) => l.id), [layers]);
  const features = useTerritorialFeatures(layerIds);
  const comunas = useComunasGeoIndex(true);

  const bandFeature = useMemo(
    () => (isochrone ? pickBandFeature(isochrone.features, bandSeconds) : null),
    [isochrone, bandSeconds],
  );
  const isoBbox = useMemo(() => computeIsoBbox(bandFeature), [bandFeature]);

  // El GSE se guarda JUNTO A LA CLAVE del área a la que pertenece.
  //
  // Limpiarlo en un efecto no basta: los efectos corren DESPUÉS del render, así
  // que al cambiar de isócrona alcanzaba a pintarse un render con el polígono
  // nuevo y las manzanas viejas — el parpadeo con cifras que luego se
  // corregían. Comparando la clave, un dato que no corresponde al área actual
  // simplemente no se usa, y el panel muestra "cargando" en vez de algo falso.
  const isoKey = isoBbox ? isoBbox.join(",") : "";
  const [gseState, setGseState] = useState<{
    key: string;
    data: GseFeatureCollection | null;
  }>({ key: "", data: null });
  const gse = gseState.key === isoKey ? gseState.data : null;

  useEffect(() => {
    if (!isoBbox) {
      setGseState({ key: "", data: null });
      return;
    }
    let cancelled = false;
    gseService
      .fetchGse({
        west: isoBbox[0],
        south: isoBbox[1],
        east: isoBbox[2],
        north: isoBbox[3],
        variable: "gse",
        zoom: 13,
        // maxFeatures alto: acá no se renderiza, y truncar subestimaría la
        // población y la distribución GSE de isócronas grandes.
        maxFeatures: 200_000,
      })
      .then((res) => {
        if (!cancelled) setGseState({ key: isoKey, data: res });
      })
      .catch(() => {
        if (!cancelled) setGseState({ key: isoKey, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [isoBbox, isoKey]);

  const comunasFc = comunas.fc;
  const nombresPorCodigo = comunas.nombresPorCodigo;
  return useMemo(() => {
    if (!isochrone || !bandFeature) return null;
    return computeIsochroneAnalysis({
      isoId: isochrone.id,
      isoFeature: bandFeature,
      territorialFeatures: features,
      territorialLayers: layers,
      territorialGroups: groups,
      comunasFC: comunasFc,
      ineByName: buildIneByName(comunas),
      nombresPorCodigo,
      manzanas,
      gse,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isochrone, bandFeature, features, layers, groups, comunasFc, nombresPorCodigo, manzanas, gse]);
};
