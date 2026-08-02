/**
 * Address Resolver - ultimo recurso de geocodificacion.
 *
 * Se ejecuta SOLO cuando address-normalizer + Nominatim ya agotaron todos
 * sus candidatos (ver geocode-addresses/index.ts). Busca la calle oficial
 * mas parecida dentro del callejero real de la comuna via fuzzy matching
 * (Levenshtein + Jaro-Winkler + Trigram), sin usar IA. No modifica ni
 * reemplaza la logica existente de limpieza/variantes - es una capa aparte.
 *
 * A diferencia de address-normalizer (puro, sin I/O), este modulo SI hace
 * red (Overpass API para construir el callejero) y DB (cache en
 * street_catalog) - por eso resolve() recibe el cliente admin de Supabase
 * en vez de tener una instancia lista para usar como el normalizer.
 */
import alias from "./config/alias.json" with { type: "json" };
import { createAddressResolver } from "./resolver.ts";

export type { AddressResolver, AddressResolverConfig } from "./resolver.ts";
export type { ResolveInput, ResolveMethod, ResolveResult } from "./types.ts";
export { createAddressResolver } from "./resolver.ts";

/** Instancia lista para usar, cargada con el alias.json del repo. */
export const addressResolver = createAddressResolver({
  alias: alias.alias,
  threshold: 0.9,
  minMarginOverRunnerUp: 0.03,
});
