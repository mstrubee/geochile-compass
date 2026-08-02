/**
 * Tipos públicos del módulo address-normalizer.
 * Puro dominio: sin dependencias de Nominatim, Supabase ni HTTP.
 */

export interface RawAddress {
  calle: string;
  numero: string;
  comuna: string;
}

/** Un cambio determinístico aplicado durante la normalización (para el LOG). */
export interface AddressChange {
  stage: string;
  before: string;
  after: string;
}

/** Algo que el normalizador no pudo resolver con certeza (no bloquea, informa). */
export interface AddressWarning {
  stage: string;
  message: string;
}

/** Una variante candidata a intentar contra el geocodificador, en orden de prioridad. */
export interface NormalizedCandidate {
  /** Identifica la regla/etapa que produjo esta variante (va al campo `method` del log). */
  label: string;
  calle: string;
  numero: string;
}

export interface NormalizeResult {
  originalAddress: RawAddress;
  /** Variantes a probar, ya ordenadas (ETAPA 10: original → normalizada → variantes → sin tildes → sin número → solo calle). */
  normalizedAddresses: NormalizedCandidate[];
  changes: AddressChange[];
  warnings: AddressWarning[];
  /** Palabras removidas de la calle (villa/depto/etc, ETAPA 4) — nunca se pierden. */
  removedTokens: string[];
  /** Texto adicional separado de la calle principal (ETAPA 5), si lo hay. */
  extraInformation: string | null;
}

export interface AddressNormalizer {
  normalize(address: RawAddress): NormalizeResult;
}
