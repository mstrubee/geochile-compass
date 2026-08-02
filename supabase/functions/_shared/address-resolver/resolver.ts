import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { ResolveInput, ResolveResult } from "./types.ts";
import { scoreSimilarity } from "./similarity/combinedScore.ts";
import { prefixContainment, firstTokenMatches } from "./similarity/prefixContainment.ts";
import { getOrBuildStreetCatalog } from "./streetCatalogRepository.ts";

const START = String.fromCharCode(768);
const END = String.fromCharCode(879);
const COMBINING_MARKS_RE = new RegExp(`[${START}-${END}]`, "g");
const normalize = (text: string): string =>
  text.normalize("NFD").replace(COMBINING_MARKS_RE, "").toLowerCase().trim();

export interface AddressResolverConfig {
  alias: Record<string, string>;
  /** 0..1 - puntaje minimo del combinado para aceptar una correccion por fuzzy
   * matching. Calibrado auditando a mano los 35 matches marginales reales del
   * archivo del usuario: en la banda 0.85-0.90 ~32 de 35 eran correcciones
   * correctas (tildes, espacios faltantes, typos), y los pares genuinamente
   * distintos y riesgosos ("Pasaje Kudi" vs "Pasaje Kure", "Las Flores" vs
   * "Los Flores") caian todos por debajo de 0.84. */
  threshold: number;
  /** Margen minimo que el mejor candidato debe sacarle al segundo mejor -
   * evita aceptar una correccion cuando varias calles del catalogo son
   * ambiguamente parecidas entre si (mismo problema de "Las/Los Flores"). */
  minMarginOverRunnerUp: number;
  /** Camino alternativo de aceptacion para truncamientos/extensiones: cobertura
   * minima del prefijo de palabras completas compartido (ver
   * similarity/prefixContainment.ts). Los truncamientos correctos reales dan
   * >= 0.70; los pares riesgosos <= 0.55. */
  minPrefixCoverage: number;
  /** Palabras completas minimas que debe cubrir el prefijo compartido, para que
   * no alcance con compartir solo el generico ("Pasaje", "Avenida"). */
  minPrefixTokens: number;
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
  config: Pick<
    AddressResolverConfig,
    "threshold" | "minMarginOverRunnerUp" | "minPrefixCoverage" | "minPrefixTokens"
  >,
): ResolveResult | null => {
  const calleNorm = normalize(calle);
  if (!calleNorm || !catalog.length) return null;

  let best: { calle: string; score: number; method: ResolveResult["method"] } | null = null;
  let runnerUpScore = 0;
  // Mejor candidato por el camino alternativo de prefijo de palabras completas.
  let bestPrefix: { calle: string; coverage: number; score: number } | null = null;

  for (const calleOficial of catalog) {
    const oficialNorm = normalize(calleOficial);
    const score = scoreSimilarity(calleNorm, oficialNorm);
    // Descartar de entrada los pares cuya primera palabra no coincide: es el
    // patron de falso positivo mas comun y el ratio no lo detecta.
    if (firstTokenMatches(calleNorm, oficialNorm)) {
      if (!best || score.combined > best.score) {
        if (best) runnerUpScore = Math.max(runnerUpScore, best.score);
        best = { calle: calleOficial, score: score.combined, method: score.bestAlgorithm };
      } else {
        runnerUpScore = Math.max(runnerUpScore, score.combined);
      }
    }

    const { coverage, sharedTokens } = prefixContainment(calleNorm, oficialNorm);
    if (
      coverage >= config.minPrefixCoverage &&
      sharedTokens >= config.minPrefixTokens &&
      (!bestPrefix || coverage > bestPrefix.coverage)
    ) {
      bestPrefix = { calle: calleOficial, coverage, score: score.combined };
    }
  }

  const passesRatio =
    best !== null &&
    best.score >= config.threshold &&
    best.score - runnerUpScore >= config.minMarginOverRunnerUp;

  if (passesRatio) {
    return {
      originalCalle: calle,
      resolvedCalle: best!.calle,
      method: best!.method,
      score: best!.score,
      catalogSize: catalog.length,
    };
  }

  // El ratio no alcanzo, pero puede ser un truncamiento/extension del nombre
  // oficial (ej. "Doctor Antonio Donghi Paladino" vs "Doctor Antonio Donghi").
  if (bestPrefix) {
    return {
      originalCalle: calle,
      resolvedCalle: bestPrefix.calle,
      method: "prefix",
      score: bestPrefix.coverage,
      catalogSize: catalog.length,
    };
  }

  return null;
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
