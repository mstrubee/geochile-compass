import { useEffect, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { normalizeCommuneName } from "@/services/communeDataService";

export interface ComunaProps {
  codigo_comuna?: string;
  cod_comuna?: string;
  nom_comuna?: string;
}

export type ComunaFeature = Feature<Geometry, ComunaProps>;
export type ComunaFC = FeatureCollection<Geometry, ComunaProps>;

interface ComunasIndex {
  fc: ComunaFC;
  /** mapa nombre normalizado → feature */
  byName: Map<string, ComunaFeature>;
  /** mapa código de comuna → nombre oficial (desde el CSV) */
  nombresPorCodigo: Record<string, string>;
}

let cache: ComunasIndex | null = null;
let inflight: Promise<ComunasIndex> | null = null;
const subscribers = new Set<(idx: ComunasIndex) => void>();

const loadOnce = async (): Promise<ComunasIndex> => {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const [geoRes, csvRes] = await Promise.all([
      fetch("/comunas.geojson"),
      fetch("/codigos_territoriales.csv"),
    ]);

    const ct = geoRes.headers.get("content-type") ?? "";
    if (!geoRes.ok || ct.includes("text/html")) {
      throw new Error(
        `No se encontró /comunas.geojson en public/. Servidor devolvió ${geoRes.status} (${ct}).`,
      );
    }
    const fc = (await geoRes.json()) as ComunaFC;

    const csvText = await csvRes.text();
    const lineas = csvText.trim().split(/\r?\n/);
    const nombresPorCodigo: Record<string, string> = {};
    for (let i = 1; i < lineas.length; i++) {
      const cols = lineas[i].split(",");
      if (cols.length < 6) continue;
      const codigo = cols[4]?.trim();
      const nombre = cols[5]?.trim();
      if (codigo && nombre) nombresPorCodigo[codigo] = nombre;
    }

    const byName = new Map<string, ComunaFeature>();
    for (const f of fc.features) {
      const codigo = f.properties.codigo_comuna ?? f.properties.cod_comuna ?? "";
      const nombre = nombresPorCodigo[codigo] ?? f.properties.nom_comuna ?? "";
      if (nombre) byName.set(normalizeCommuneName(nombre), f);
    }

    cache = { fc, byName, nombresPorCodigo };
    inflight = null;
    subscribers.forEach((cb) => cb(cache!));
    return cache;
  })().catch((e) => {
    inflight = null;
    throw e;
  });

  return inflight;
};

/**
 * Hook compartido que carga (perezosamente y una sola vez) `/comunas.geojson`
 * y el CSV de códigos. Devuelve el índice y un helper para obtener el feature
 * de una comuna por su nombre.
 */
export const useComunasGeoIndex = (enabled: boolean = true) => {
  const [index, setIndex] = useState<ComunasIndex | null>(cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || index) return;
    let mounted = true;
    const sub = (idx: ComunasIndex) => {
      if (mounted) setIndex(idx);
    };
    subscribers.add(sub);
    loadOnce()
      .then((idx) => mounted && setIndex(idx))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[useComunasGeoIndex]", msg);
        if (mounted) setError(msg);
      });
    return () => {
      mounted = false;
      subscribers.delete(sub);
    };
  }, [enabled, index]);

  const getFeatureByName = (name: string): ComunaFeature | null => {
    if (!index) return null;
    return index.byName.get(normalizeCommuneName(name)) ?? null;
  };

  return {
    ready: !!index,
    fc: index?.fc ?? null,
    nombresPorCodigo: index?.nombresPorCodigo ?? {},
    getFeatureByName,
    error,
  };
};
