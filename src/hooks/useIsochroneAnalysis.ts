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

interface Params {
  isochrone: Isochrone | null;
  bandSeconds?: number;
  manzanas?: ManzanaFeatureCollection | null;
}

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
    // Need ine index ready
    const ineByName = (comunas as unknown as { fc: unknown }).fc
      ? // @ts-expect-error access internal
        (comunas.fc && (comunas as any)) // placeholder, real access below
      : null;
    // We need ine map: re-import via getIneStats? Use getIneStats per name instead.
    // Build a small Map from communes loaded
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

// Helper: builds Map<normalizedName, IneCommuneStats> from useComunasGeoIndex.
// The hook doesn't expose the raw map, but exposes getIneStats(codigo, nombre).
// We iterate over nombresPorCodigo to construct it.
import type { IneCommuneStats } from "@/utils/ineScales";
import { normalizeCommuneName } from "@/services/communeDataService";

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
