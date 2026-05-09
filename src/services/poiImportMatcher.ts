import type { SavedPoi } from "@/types/pois";
import type {
  ImportRow,
  PoiAddressAlias,
  PoiAttribute,
  RowMatchResult,
} from "@/types/poiMetrics";
import { geocodeAddress } from "@/services/geocodingService";
import { haversineMeters } from "@/utils/geoDistance";
import {
  normalizeAddress,
  normalizeName,
  addressTokens,
  tokenJaccard,
} from "@/utils/addressNormalize";

/**
 * Engine de matching para una importación. Pipeline en cascada (orden
 * de mayor a menor confianza). En cuanto un paso resuelve la fila, se
 * marca como `auto_matched` o `alias_matched` y se evita geocodificar.
 *
 *  1) Memoria de identidad por código (Centro Sap / Local) → POI.
 *  2) Memoria de identidad por nombre normalizado → POI.
 *  3) Atributo del POI con el mismo Centro Sap / Local.
 *  4) Nombre normalizado + comuna coinciden con un único POI de la carpeta.
 *  5) Alias por dirección normalizada exacta.
 *  6) Dirección normalizada del POI (poi.description) coincide.
 *  7) Geocodificación + score combinado (distancia + comuna + nombre).
 */

export const DEFAULT_THRESHOLD_METERS = 500;

/** Una entrada de memoria de identidad reusable de una importación previa. */
export interface IdentityMemoryEntry {
  key_type: "centro_sap" | "local" | "name_norm" | string;
  key_value: string;
  poi_id: string;
}

interface MatchParams {
  rows: ImportRow[];
  pois: SavedPoi[];
  aliases: PoiAddressAlias[];
  /** Atributos guardados de los POIs (usado para match por código). */
  poiAttributes?: PoiAttribute[];
  /** Memoria persistida de matches manuales previos. */
  identityMemory?: IdentityMemoryEntry[];
  thresholdMeters?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

const CODE_KEYS = ["Centro Sap", "Local"] as const;
const NAME_KEYS = ["Nombre Local", "Local", "Nombre"] as const;

const pickRowName = (row: ImportRow): string =>
  (NAME_KEYS.map((k) => row.identity[k]).find((v) => v && v.trim()) ?? "").trim();

export const matchImportRows = async ({
  rows,
  pois,
  aliases,
  poiAttributes = [],
  identityMemory = [],
  thresholdMeters = DEFAULT_THRESHOLD_METERS,
  onProgress,
  signal,
}: MatchParams): Promise<RowMatchResult[]> => {
  const poiById = new Map(pois.map((p) => [p.id, p]));

  // ---------- Índices auxiliares ----------
  // Aliases por dirección normalizada exacta.
  const aliasByAddress = new Map<string, string>();
  for (const a of aliases) {
    if (!aliasByAddress.has(a.normalized_address)) {
      aliasByAddress.set(a.normalized_address, a.poi_id);
    }
  }

  // Memoria persistida (folder-scoped) por tipo de clave.
  const memCentroSap = new Map<string, string>();
  const memLocal = new Map<string, string>();
  const memName = new Map<string, string>();
  for (const m of identityMemory) {
    const v = m.key_value.toLowerCase().trim();
    if (!v) continue;
    if (m.key_type === "centro_sap") memCentroSap.set(v, m.poi_id);
    else if (m.key_type === "local") memLocal.set(v, m.poi_id);
    else if (m.key_type === "name_norm") memName.set(v, m.poi_id);
  }

  // Atributos del POI por (poi_id, attr_key) → valor normalizado.
  const poisByCentroSap = new Map<string, string>();
  const poisByLocalCode = new Map<string, string>();
  const dupCentroSap = new Set<string>();
  const dupLocalCode = new Set<string>();
  for (const a of poiAttributes) {
    if (!a.attr_value) continue;
    const v = a.attr_value.toLowerCase().trim();
    if (!v) continue;
    if (a.attr_key === "Centro Sap") {
      if (poisByCentroSap.has(v)) dupCentroSap.add(v);
      else poisByCentroSap.set(v, a.poi_id);
    } else if (a.attr_key === "Local") {
      if (poisByLocalCode.has(v)) dupLocalCode.add(v);
      else poisByLocalCode.set(v, a.poi_id);
    }
  }

  // Indice por (nombre normalizado, comuna normalizada) → poi_id (único).
  const poisByNameComuna = new Map<string, string>();
  const dupNameComuna = new Set<string>();
  // Indice por dirección normalizada del POI → poi_id.
  const poisByAddress = new Map<string, string>();
  const dupAddress = new Set<string>();
  for (const p of pois) {
    const nm = normalizeName(p.name ?? "");
    const co = normalizeName(
      (p.properties as Record<string, unknown>)?.comuna as string ??
      (p.properties as Record<string, unknown>)?.["Comuna"] as string ??
      "",
    );
    if (nm && co) {
      const key = `${nm}|${co}`;
      if (poisByNameComuna.has(key)) dupNameComuna.add(key);
      else poisByNameComuna.set(key, p.id);
    }
    const addrSource =
      (p.properties as Record<string, unknown>)?.["Dirección"] as string ??
      (p.properties as Record<string, unknown>)?.address as string ??
      p.description ??
      "";
    const addrNorm = normalizeAddress(addrSource as string);
    if (addrNorm) {
      if (poisByAddress.has(addrNorm)) dupAddress.add(addrNorm);
      else poisByAddress.set(addrNorm, p.id);
    }
  }

  const results: RowMatchResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const row = rows[i];

    const rowName = pickRowName(row);
    const rowNameNorm = normalizeName(rowName);
    const rowComunaNorm = normalizeName(row.comuna ?? "");
    const centroSap = (row.identity["Centro Sap"] ?? "").toLowerCase().trim();
    const localCode = (row.identity["Local"] ?? "").toLowerCase().trim();

    const pushAlias = (poiId: string): RowMatchResult | null => {
      const poi = poiById.get(poiId);
      if (!poi) return null;
      return {
        rowIndex: row.rowIndex,
        status: "alias_matched",
        geocoded: { lat: poi.lat, lng: poi.lng },
        assignedPoiId: poi.id,
        distanceMeters: 0,
        candidates: [],
      };
    };

    let resolved: RowMatchResult | null = null;

    // 1) Memoria por código.
    if (!resolved && centroSap && memCentroSap.has(centroSap)) {
      resolved = pushAlias(memCentroSap.get(centroSap)!);
    }
    if (!resolved && localCode && memLocal.has(localCode)) {
      resolved = pushAlias(memLocal.get(localCode)!);
    }
    // 2) Memoria por nombre normalizado.
    if (!resolved && rowNameNorm && memName.has(rowNameNorm)) {
      resolved = pushAlias(memName.get(rowNameNorm)!);
    }
    // 3) Atributo POI por código (sólo si es único en la carpeta).
    if (!resolved && centroSap && !dupCentroSap.has(centroSap) && poisByCentroSap.has(centroSap)) {
      resolved = pushAlias(poisByCentroSap.get(centroSap)!);
    }
    if (!resolved && localCode && !dupLocalCode.has(localCode) && poisByLocalCode.has(localCode)) {
      resolved = pushAlias(poisByLocalCode.get(localCode)!);
    }
    // 4) Nombre normalizado + comuna.
    if (!resolved && rowNameNorm && rowComunaNorm) {
      const key = `${rowNameNorm}|${rowComunaNorm}`;
      if (!dupNameComuna.has(key) && poisByNameComuna.has(key)) {
        resolved = pushAlias(poisByNameComuna.get(key)!);
      }
    }
    // 5) Alias por dirección.
    if (!resolved) {
      const aliasPoiId = aliasByAddress.get(row.normalizedAddress);
      if (aliasPoiId && poiById.has(aliasPoiId)) {
        resolved = pushAlias(aliasPoiId);
      }
    }
    // 6) Dirección normalizada del POI coincide.
    if (!resolved && row.normalizedAddress) {
      if (!dupAddress.has(row.normalizedAddress) && poisByAddress.has(row.normalizedAddress)) {
        resolved = pushAlias(poisByAddress.get(row.normalizedAddress)!);
      }
    }

    if (resolved) {
      results.push(resolved);
      onProgress?.(i + 1, rows.length);
      continue;
    }

    // 7) Geocode + score combinado.
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

    // Score combinado para cada POI dentro del radio.
    const rowAddrTokens = addressTokens(row.rawAddress);
    const scored = pois
      .map((p) => {
        const dist = haversineMeters(geo!.lat, geo!.lng, p.lat, p.lng);
        const poiNameNorm = normalizeName(p.name ?? "");
        const nameSim = rowNameNorm
          ? jaccardSets(new Set(rowNameNorm.split(" ")), new Set(poiNameNorm.split(" ")))
          : 0;
        const poiComuna = normalizeName(
          (p.properties as Record<string, unknown>)?.comuna as string ??
          (p.properties as Record<string, unknown>)?.["Comuna"] as string ??
          "",
        );
        const sameComuna = rowComunaNorm && poiComuna === rowComunaNorm ? 1 : 0;
        const poiAddrTokens = addressTokens(
          (p.properties as Record<string, unknown>)?.["Dirección"] as string ??
          p.description ?? "",
        );
        const addrSim = tokenJaccard(rowAddrTokens, poiAddrTokens);
        // Score: distancia (más cerca = mejor), bonus por comuna, nombre, dirección.
        const distScore = dist <= thresholdMeters
          ? 1 - dist / thresholdMeters
          : Math.max(0, 1 - dist / (thresholdMeters * 4));
        const score = distScore + 0.6 * nameSim + 0.4 * sameComuna + 0.3 * addrSim;
        return { poiId: p.id, name: p.name, distanceMeters: dist, score };
      })
      .sort((a, b) => b.score - a.score);

    const within = scored.filter((c) => c.distanceMeters <= thresholdMeters);
    const top = scored[0];
    const second = scored[1];

    // Auto-match si:
    //  - 1 sólo POI dentro del radio, o
    //  - el mejor score supera al segundo por margen claro y comparte comuna o nombre fuerte.
    const strongLead =
      top &&
      second &&
      top.score - second.score >= 0.45 &&
      top.distanceMeters <= thresholdMeters * 1.5;

    if (within.length === 1) {
      results.push({
        rowIndex: row.rowIndex,
        status: "auto_matched",
        geocoded: { lat: geo.lat, lng: geo.lng },
        assignedPoiId: within[0].poiId,
        distanceMeters: within[0].distanceMeters,
        candidates: within.map(({ poiId, name, distanceMeters }) => ({ poiId, name, distanceMeters })),
      });
    } else if (strongLead && top) {
      results.push({
        rowIndex: row.rowIndex,
        status: "auto_matched",
        geocoded: { lat: geo.lat, lng: geo.lng },
        assignedPoiId: top.poiId,
        distanceMeters: top.distanceMeters,
        candidates: scored.slice(0, 5).map(({ poiId, name, distanceMeters }) => ({ poiId, name, distanceMeters })),
      });
    } else if (within.length > 1) {
      results.push({
        rowIndex: row.rowIndex,
        status: "needs_review",
        geocoded: { lat: geo.lat, lng: geo.lng },
        assignedPoiId: null,
        distanceMeters: null,
        candidates: within.slice(0, 5).map(({ poiId, name, distanceMeters }) => ({ poiId, name, distanceMeters })),
      });
    } else {
      results.push({
        rowIndex: row.rowIndex,
        status: "needs_review",
        geocoded: { lat: geo.lat, lng: geo.lng },
        assignedPoiId: null,
        distanceMeters: null,
        candidates: scored.slice(0, 5).map(({ poiId, name, distanceMeters }) => ({ poiId, name, distanceMeters })),
      });
    }

    onProgress?.(i + 1, rows.length);
  }

  return results;
};

const jaccardSets = (a: Set<string>, b: Set<string>): number => {
  const ax = new Set([...a].filter((t) => t.length > 1));
  const bx = new Set([...b].filter((t) => t.length > 1));
  if (ax.size === 0 || bx.size === 0) return 0;
  let inter = 0;
  for (const t of ax) if (bx.has(t)) inter++;
  return inter / (ax.size + bx.size - inter);
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
