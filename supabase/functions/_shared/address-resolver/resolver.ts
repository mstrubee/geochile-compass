import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { ResolveInput, ResolveResult } from "./types.ts";
import { scoreSimilarity } from "./similarity/combinedScore.ts";
import { getOrBuildStreetCatalog } from "./streetCatalogRepository.ts";

const START = String.fromCharCode(768);
const END = String.fromCharCode(879);
const COMBINING_MARKS_RE = new RegExp(`[${START}-${END}]`, "g");
const normalize = (text: string): string =>
  text.normalize("NFD").replace(COMBINING_MARKS_RE, "").toLowerCase().trim();

export interface AddressResolverConfig {
  alias: Record<string, string>;
  /** 0..1 - puntaje minimo del combinado para aceptar una correccion por fuzzy matching.
   * Nombres cortos y comunes con un solo vocal distinta ("Las Flores" vs
   * "Los Flores") pueden marcar ~0.86 de similitud siendo calles DISTINTAS -
   * por eso el default es conservador (0.90, ver ETAPA de validacion). */
  threshold: number;
  /** Margen minimo que el mejor candidato debe sacarle al segundo mejor -
   * evita aceptar una correccion cuando varias calles del catalogo son
   * ambiguamente parecidas entre si (mismo problema de "Las/Los Flores"). */
  minMarginOverRunnerUp: number;
}

export interface AddressResolver {
  resolve(admin: SupabaseClient, input: ResolveInput): Promise<ResolveResult | null>;
}

/** Busca la calle en el diccionario de alias. Exacto, sin fuzzy matching. */
export const matchAlias = (
  calle: string,
  alias: Record<string, string>,
): ResolveResult | null => {
  const calleNorm = normalize(calle);
  if (!calleNorm) return null;
  for (const [known, official] of Object.entries(alias)) {
    if (known.startsWith("_")) continue;
    if (normalize(known) === calleNorm) {
      return { originalCalle: calle, resolvedCalle: official, method: "alias", score: 1, catalogSize: 0 };
    }
  }
  return null;
};

/**
 * Fuzzy matching puro (sin I/O) de una calle contra un catalogo ya
 * cargado en memoria - separado de resolve() para poder testear la logica
 * de puntaje/umbral/margen sin necesitar un cliente de Supabase ni red.
 */
export const matchAgainstCatalog = (
  calle: string,
  catalog: string[],
  config: Pick<AddressResolverConfig, "threshold" | "minMarginOverRunnerUp">,
): ResolveResult | null => {
  const calleNorm = normalize(calle);
  if (!calleNorm || !catalog.length) return null;

  let best: { calle: string; score: number; method: ResolveResult["method"] } | null = null;
  let runnerUpScore = 0;
  for (const calleOficial of catalog) {
    const score = scoreSimilarity(calleNorm, normalize(calleOficial));
    if (!best || score.combined > best.score) {
      if (best) runnerUpScore = Math.max(runnerUpScore, best.score);
      best = { calle: calleOficial, score: score.combined, method: score.bestAlgorithm };
    } else {
      runnerUpScore = Math.max(runnerUpScore, score.combined);
    }
  }

  if (!best || best.score < config.threshold) return null;
  if (best.score - runnerUpScore < config.minMarginOverRunnerUp) return null;

  return {
    originalCalle: calle,
    resolvedCalle: best.calle,
    method: best.method,
    score: best.score,
    catalogSize: catalog.length,
  };
};

/**
 * Ultimo recurso cuando address-normalizer + Nominatim ya agotaron todos sus
 * candidatos: busca la calle "oficial" mas parecida dentro del callejero real
 * de la comuna. NO es parte del address-normalizer (que es puro, sin I/O) -
 * este modulo si hace red (Overpass) y DB (cache), por eso vive separado y
 * el orquestador de geocodificacion lo invoca explicitamente al final.
 *
 * Orden: 1) diccionario de alias (rapido, exacto, sin tocar el catalogo) ->
 * 2) fuzzy matching contra el catalogo real de la comuna (Levenshtein +
 * Jaro-Winkler + Trigram, promediados - ver similarity/combinedScore.ts).
 */
export const createAddressResolver = (config: AddressResolverConfig): AddressResolver => ({
  async resolve(admin: SupabaseClient, input: ResolveInput): Promise<ResolveResult | null> {
    const aliasHit = matchAlias(input.calle, config.alias);
    if (aliasHit) return aliasHit;

    const catalog = await getOrBuildStreetCatalog(admin, input.comuna);
    return matchAgainstCatalog(input.calle, catalog, config);
  },
});
