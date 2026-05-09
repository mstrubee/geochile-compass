import type { SavedPoi } from "@/types/pois";
import type {
  ImportRow,
  PoiAddressAlias,
  RowMatchResult,
} from "@/types/poiMetrics";
import { geocodeAddress } from "@/services/geocodingService";
import { haversineMeters } from "@/utils/geoDistance";
import { normalizeAddress } from "@/utils/addressNormalize";

/**
 * Engine de matching para una importación.
 * 1) Si la dirección normalizada coincide con un alias previo → match directo.
 * 2) Geocodifica con Nominatim.
 * 3) Busca POIs dentro de `thresholdMeters` (default 500).
 *    - 1 candidato → auto_matched.
 *    - 2+ candidatos → needs_review (se muestran top 5).
 *    - 0 candidatos → needs_review con los 5 POIs más cercanos como sugerencia.
 * 4) Si Nominatim no devuelve nada → no_geocode (admin elige en el mapa).
 */

export const DEFAULT_THRESHOLD_METERS = 500;

interface MatchParams {
  rows: ImportRow[];
  /** POIs candidatos (típicamente los de la carpeta destino). */
  pois: SavedPoi[];
  aliases: PoiAddressAlias[];
  thresholdMeters?: number;
  /** Callback de progreso 0..1. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export const matchImportRows = async ({
  rows,
  pois,
  aliases,
  thresholdMeters = DEFAULT_THRESHOLD_METERS,
  onProgress,
  signal,
}: MatchParams): Promise<RowMatchResult[]> => {
  // Indice de aliases por dirección normalizada.
  const aliasIndex = new Map<string, string>();
  for (const a of aliases) {
    if (!aliasIndex.has(a.normalized_address)) {
      aliasIndex.set(a.normalized_address, a.poi_id);
    }
  }
  const poiById = new Map(pois.map((p) => [p.id, p]));

  const results: RowMatchResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const row = rows[i];

    // 1) Alias hit
    const aliasPoiId = aliasIndex.get(row.normalizedAddress);
    if (aliasPoiId && poiById.has(aliasPoiId)) {
      const poi = poiById.get(aliasPoiId)!;
      results.push({
        rowIndex: row.rowIndex,
        status: "alias_matched",
        geocoded: { lat: poi.lat, lng: poi.lng },
        assignedPoiId: poi.id,
        distanceMeters: 0,
        candidates: [],
      });
      onProgress?.(i + 1, rows.length);
      continue;
    }

    // 2) Geocode
    let geo;
    try {
      geo = await geocodeAddress(row.rawAddress, row.comuna, signal);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      results.push({
        rowIndex: row.rowIndex,
        status: "no_geocode",
        geocoded: null,
        assignedPoiId: null,
        distanceMeters: null,
        candidates: nearestPois(pois, null, 5),
        error: (e as Error)?.message ?? "Error de geocodificación",
      });
      onProgress?.(i + 1, rows.length);
      continue;
    }

    if (!geo) {
      results.push({
        rowIndex: row.rowIndex,
        status: "no_geocode",
        geocoded: null,
        assignedPoiId: null,
        distanceMeters: null,
        candidates: nearestPois(pois, null, 5),
      });
      onProgress?.(i + 1, rows.length);
      continue;
    }

    // 3) Buscar candidatos dentro del threshold
    const within = pois
      .map((p) => ({
        poiId: p.id,
        name: p.name,
        distanceMeters: haversineMeters(geo.lat, geo.lng, p.lat, p.lng),
      }))
      .filter((c) => c.distanceMeters <= thresholdMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    if (within.length === 1) {
      results.push({
        rowIndex: row.rowIndex,
        status: "auto_matched",
        geocoded: { lat: geo.lat, lng: geo.lng },
        assignedPoiId: within[0].poiId,
        distanceMeters: within[0].distanceMeters,
        candidates: within,
      });
    } else if (within.length > 1) {
      results.push({
        rowIndex: row.rowIndex,
        status: "needs_review",
        geocoded: { lat: geo.lat, lng: geo.lng },
        assignedPoiId: null,
        distanceMeters: null,
        candidates: within.slice(0, 5),
      });
    } else {
      // 0 candidatos — devolver los 5 más cercanos para sugerir
      results.push({
        rowIndex: row.rowIndex,
        status: "needs_review",
        geocoded: { lat: geo.lat, lng: geo.lng },
        assignedPoiId: null,
        distanceMeters: null,
        candidates: nearestPois(pois, geo, 5),
      });
    }

    onProgress?.(i + 1, rows.length);
  }

  return results;
};

const nearestPois = (
  pois: SavedPoi[],
  ref: { lat: number; lng: number } | null,
  k: number,
): RowMatchResult["candidates"] => {
  if (!ref) {
    return pois.slice(0, k).map((p) => ({
      poiId: p.id,
      name: p.name,
      distanceMeters: Infinity,
    }));
  }
  return pois
    .map((p) => ({
      poiId: p.id,
      name: p.name,
      distanceMeters: haversineMeters(ref.lat, ref.lng, p.lat, p.lng),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, k);
};

/** Re-normaliza una dirección y la guarda como alias (para usar en commit). */
export const buildAliasFromRow = (
  row: ImportRow,
  poiId: string,
): { poi_id: string; normalized_address: string; raw_address: string } => ({
  poi_id: poiId,
  normalized_address: normalizeAddress(row.rawAddress),
  raw_address: row.rawAddress,
});
