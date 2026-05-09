/**
 * Normalización de direcciones chilenas para mejorar el matching contra
 * Nominatim y los aliases manuales.
 */

const ABBREV: Array<[RegExp, string]> = [
  [/\bav\.?\s+/gi, "avenida "],
  [/\bavda\.?\s+/gi, "avenida "],
  [/\bav\.?\s/gi, "avenida "],
  [/\bcl\.?\s+/gi, "calle "],
  [/\bpsj\.?\s+/gi, "pasaje "],
  [/\bpje\.?\s+/gi, "pasaje "],
  [/\bcamino\b/gi, "camino"],
  [/\bdpto\.?\s*/gi, ""],
  [/\bdepto\.?\s*/gi, ""],
  [/\boficina\s+\d+/gi, ""],
  [/\bof\.?\s*\d+/gi, ""],
  [/\block\s*\d+/gi, ""],
  [/\bpiso\s*\d+/gi, ""],
  [/\blocal\s*\d+/gi, ""],
  [/\bnro\.?\s*/gi, ""],
  [/\bn[°ºo]\.?\s*/gi, ""],
  [/\b#\s*/g, ""],
];

/**
 * Devuelve una versión normalizada para usar como llave estable de alias.
 * - lowercase, sin tildes
 * - expande abreviaturas comunes
 * - elimina sufijos de departamento/oficina/local
 * - colapsa espacios
 */
export const normalizeAddress = (raw: string): string => {
  if (!raw) return "";
  let s = raw.toLowerCase().trim();
  // Quitar tildes
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Reemplazar abreviaturas
  for (const [r, repl] of ABBREV) s = s.replace(r, repl);
  // Limpiar caracteres extraños
  s = s.replace(/[,;]/g, " ").replace(/\s+/g, " ").trim();
  return s;
};

/**
 * Construye la query a enviar a Nominatim. Adjunta comuna y país para
 * evitar matches en otros países.
 */
export const buildGeocodeQuery = (address: string, comuna: string | null): string => {
  const parts = [address.trim()];
  if (comuna) parts.push(comuna.trim());
  parts.push("Chile");
  return parts.filter(Boolean).join(", ");
};
