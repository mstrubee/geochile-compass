import type {
  AddressChange,
  AddressNormalizer,
  AddressWarning,
  NormalizeResult,
  NormalizedCandidate,
  RawAddress,
} from "./types.ts";
import { cleanup } from "./steps/cleanup.ts";
import { splitGluedPrefix } from "./steps/splitGluedPrefix.ts";
import { toTitleCase } from "./steps/titleCase.ts";
import { expandAbbreviations } from "./steps/abbreviations.ts";
import { removeNoise } from "./steps/removeNoise.ts";
import { splitExtraInfo } from "./steps/splitExtraInfo.ts";
import { fixNumbering } from "./steps/numbering.ts";
import { generateProgressiveVariants } from "./steps/variants.ts";
import { generateSynonymVariants } from "./steps/synonyms.ts";
import { firstCommaSegment } from "./steps/firstCommaSegment.ts";
import { stripAccents } from "./steps/stripAccents.ts";

export interface AddressNormalizerConfig {
  abreviaturas: Record<string, string>;
  sinonimos: { grupos: string[][] };
  palabrasAEliminar: { palabras: string[] };
}

const dedupeCandidates = (candidates: NormalizedCandidate[]): NormalizedCandidate[] => {
  const seen = new Set<string>();
  const out: NormalizedCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.calle.toLowerCase()}|${c.numero}`;
    if (!c.calle.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
};

/**
 * Implementacion pura (sin I/O, sin llamadas a Nominatim) de AddressNormalizer.
 * Orquesta las etapas 1-9 y arma la lista de candidatos en el orden de
 * reintento de la ETAPA 10: original -> normalizada -> variantes -> sinonimos
 * -> sin tildes -> sin numero.  El ultimo intento (busqueda libre / "solo
 * calle + comuna") se hace afuera, en el orquestador de geocodificacion, ya
 * que usa una forma de consulta distinta (texto libre, no estructurada).
 */
export const createAddressNormalizer = (config: AddressNormalizerConfig): AddressNormalizer => ({
  normalize(address: RawAddress): NormalizeResult {
    const changes: AddressChange[] = [];
    const warnings: AddressWarning[] = [];

    const original: RawAddress = {
      calle: address.calle ?? "",
      numero: (address.numero ?? "").trim(),
      comuna: address.comuna ?? "",
    };

    // Etapa 1 - Limpieza
    let calle = cleanup(original.calle);
    const comuna = cleanup(original.comuna);
    if (calle !== original.calle) changes.push({ stage: "cleanup", before: original.calle, after: calle });

    // Prefijo pegado sin espacio al nombre real (ej. "Avenidaobispo Valdez")
    const beforeGlued = calle;
    calle = splitGluedPrefix(calle);
    if (calle !== beforeGlued) changes.push({ stage: "splitGluedPrefix", before: beforeGlued, after: calle });

    // Etapa 2 - Title Case
    const beforeCase = calle;
    calle = toTitleCase(calle);
    if (calle !== beforeCase) changes.push({ stage: "titleCase", before: beforeCase, after: calle });

    // Etapa 3 - Abreviaturas
    const abbrResult = expandAbbreviations(calle, config.abreviaturas);
    calle = abbrResult.text;
    changes.push(...abbrResult.changes);

    // Etapa 4 - Texto irrelevante (villa/depto/etc)
    const noiseResult = removeNoise(calle, config.palabrasAEliminar.palabras);
    const removedTokens = noiseResult.removedTokens;
    if (removedTokens.length) {
      changes.push({ stage: "removeNoise", before: calle, after: noiseResult.calle });
    }
    calle = noiseResult.calle;

    // Etapa 5 - Separar informacion adicional (solo si Etapa 4 no encontro nada que cortar)
    let extraInformation: string | null = null;
    if (!removedTokens.length) {
      const splitResult = splitExtraInfo(calle, original.numero);
      if (splitResult.extraInformation) {
        changes.push({ stage: "splitExtraInfo", before: calle, after: splitResult.calle });
        extraInformation = splitResult.extraInformation;
      }
      calle = splitResult.calle;
    }

    // Etapa 6 - Numeracion (numero final duplicado o que no coincide con la columna numero)
    const numberingResult = fixNumbering(calle, original.numero);
    if (numberingResult.changes.length) {
      calle = numberingResult.calle;
      changes.push(...numberingResult.changes);
      warnings.push(...numberingResult.warnings);
    }

    // Candidatos, en orden de intento (ETAPA 10)
    const candidates: NormalizedCandidate[] = [];

    // 1) Direccion original tal cual (por si la limpieza/expansion empeoro algo raro)
    candidates.push({ label: "original", calle: original.calle, numero: original.numero });

    // 2) Direccion normalizada (resultado de etapas 1-6)
    candidates.push({ label: "normalized", calle, numero: original.numero });

    // Primer segmento antes de una coma (campos concatenados en el dato fuente)
    const segment = firstCommaSegment(calle);
    if (segment) candidates.push({ label: "first_segment", calle: segment, numero: original.numero });

    // 3-4) Variantes por descarte progresivo de palabras (ETAPA 7)
    for (const variant of generateProgressiveVariants(segment ?? calle)) {
      candidates.push({ label: "variant", calle: variant, numero: original.numero });
    }

    // Sinonimos (ETAPA 8)
    for (const variant of generateSynonymVariants(segment ?? calle, config.sinonimos.grupos)) {
      candidates.push({ label: "synonym", calle: variant, numero: original.numero });
    }

    // 5) Sin tildes (ETAPA 9) - solo para busqueda, nunca se usa para el dato mostrado
    const sinTildes = stripAccents(calle);
    if (sinTildes !== calle) {
      candidates.push({ label: "no_accents", calle: sinTildes, numero: original.numero });
    }

    // 6) Sin numero
    if (original.numero) {
      candidates.push({ label: "no_number", calle, numero: "" });
    }

    return {
      originalAddress: original,
      normalizedAddresses: dedupeCandidates(candidates),
      changes,
      warnings,
      removedTokens,
      extraInformation,
    };
  },
});
