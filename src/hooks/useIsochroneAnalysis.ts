import { useMemo } from "react";
import type { Isochrone } from "@/types/isochrones";
import type { ManzanaFeatureCollection } from "@/types/manzanas";
import { useTerritorialLayers, useTerritorialFeatures } from "@/hooks/useTerritorialLayers";
import { useComunasGeoIndex } from "@/hooks/useComunasGeoIndex";
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

export const useIsochroneAnalysis = ({
  isochrone,
  bandSeconds,
  manzanas = null,
}: Params): IsochroneAnalysis | null => {
  const { groups, layers } = useTerritorialLayers();
  const layerIds = useMemo(() => layers.map((l) => l.id), [layers]);
  const features = useTerritorialFeatures(layerIds);
  const comunas = useComunasGeoIndex(true);

  return useMemo(() => {
    if (!isochrone) return null;
    const f = pickBandFeature(isochrone.features, bandSeconds);
    if (!f) return null;
    return computeIsochroneAnalysis({
      isoId: isochrone.id,
      isoFeature: f,
      territorialFeatures: features,
      territorialLayers: layers,
      territorialGroups: groups,
      comunasFC: comunas.fc,
      ineByName: buildIneByName(comunas),
      nombresPorCodigo: comunas.nombresPorCodigo,
      manzanas,
    });
  }, [isochrone, bandSeconds, features, layers, groups, comunas, manzanas]);
};
