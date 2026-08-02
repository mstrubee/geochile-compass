/**
 * Valida que un resultado de Nominatim realmente corresponda a la comuna
 * (y, si se puede determinar, la region) pedida - evita aceptar coincidencias
 * de una calle con el mismo nombre en una ciudad distinta (ver
 * geoplanet-geocoding: nombres de calle comunes como "Colon" o "Santa Rita"
 * existen en decenas de comunas chilenas).
 */
import comunasData from "./address-normalizer/config/comunas.json" with { type: "json" };

const START = String.fromCharCode(768);
const END = String.fromCharCode(879);
const COMBINING_MARKS_RE = new RegExp(`[${START}-${END}]`, "g");
const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
    .trim();

interface ComunaRow {
  comuna: string;
  region_code: string | null;
  region: string | null;
}

const comunaByName = new Map<string, ComunaRow>(
  (comunasData as ComunaRow[]).map((c) => [normalize(c.comuna), c]),
);

export interface NominatimAddressDetails {
  country?: string;
  country_code?: string;
  [key: string]: string | undefined;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Nominatim reparte la comuna chilena entre distintos campos segun la zona
 * (city, town, village, municipality, city_district, suburb, county) - se
 * revisan todos en vez de asumir uno fijo.
 */
const COMUNA_FIELD_CANDIDATES = [
  "city",
  "town",
  "village",
  "municipality",
  "city_district",
  "suburb",
  "county",
];

export const validateGeocodeResult = (
  address: NominatimAddressDetails | undefined,
  expectedComuna: string,
): ValidationResult => {
  if (!address) return { valid: false, reason: "sin addressdetails en la respuesta" };

  const countryOk =
    address.country_code?.toLowerCase() === "cl" || normalize(address.country ?? "") === "chile";
  if (!countryOk) return { valid: false, reason: `pais inesperado: ${address.country ?? "?"}` };

  const expectedNorm = normalize(expectedComuna);
  const found = COMUNA_FIELD_CANDIDATES.some((field) => {
    const value = address[field];
    return value && normalize(value) === expectedNorm;
  });
  if (!found) {
    return {
      valid: false,
      reason: `comuna esperada "${expectedComuna}" no aparece en la respuesta (campos revisados: ${COMUNA_FIELD_CANDIDATES.map((f) => address[f]).filter(Boolean).join(", ") || "ninguno"})`,
    };
  }

  // Chequeo de region cuando el dato de referencia lo permite (mejor esfuerzo, no bloqueante).
  const comunaRef = comunaByName.get(expectedNorm);
  if (comunaRef?.region && address.state) {
    const stateNorm = normalize(address.state);
    const regionNorm = normalize(comunaRef.region);
    if (!regionNorm.includes(stateNorm) && !stateNorm.includes(regionNorm)) {
      return {
        valid: false,
        reason: `region no coincide: se esperaba "${comunaRef.region}", Nominatim devolvio "${address.state}"`,
      };
    }
  }

  return { valid: true };
};
