/**
 * Address Normalizer - punto de entrada publico.
 *
 * Servicio independiente y desacoplado del geocodificador: recibe una
 * direccion chilena (calle, numero, comuna) y devuelve variantes
 * normalizadas listas para intentar contra Nominatim, en orden de
 * prioridad, junto con un log de cambios/advertencias.  No hace red, no
 * conoce Nominatim ni Supabase - eso vive en geocode-addresses/index.ts,
 * que llama a normalize() antes de geocodificar.
 *
 * Toda la configuracion (abreviaturas, sinonimos, palabras a eliminar,
 * comunas, regiones) vive en ./config/*.json - nunca hardcodeada aca.
 */
import abreviaturas from "./config/abreviaturas.json" with { type: "json" };
import sinonimos from "./config/sinonimos.json" with { type: "json" };
import palabrasAEliminar from "./config/palabras_a_eliminar.json" with { type: "json" };

import { createAddressNormalizer } from "./normalizer.ts";

export type {
  AddressChange,
  AddressNormalizer,
  AddressWarning,
  NormalizeResult,
  NormalizedCandidate,
  RawAddress,
} from "./types.ts";
export { createAddressNormalizer } from "./normalizer.ts";

/** Instancia lista para usar, cargada con la configuracion por defecto del repo. */
export const addressNormalizer = createAddressNormalizer({
  abreviaturas,
  sinonimos,
  palabrasAEliminar,
});
