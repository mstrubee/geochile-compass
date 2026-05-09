/**
 * Normalización de direcciones chilenas para mejorar el matching contra
 * Nominatim, los aliases manuales y los POIs ya guardados.
 */

const ABBREV: Array<[RegExp, string]> = [
  // Vías
  [/\bav(da|enida)?\.?\s+/gi, "avenida "],
  [/\bcl\.?\s+/gi, "calle "],
  [/\bps?j\.?\s+/gi, "pasaje "],
  [/\bpje\.?\s+/gi, "pasaje "],
  [/\bpob\.?\s+/gi, "poblacion "],
  [/\bvilla\b/gi, "villa"],
  [/\bcamino\b/gi, "camino"],
  [/\bruta\b/gi, "ruta"],
  [/\bkm\.?\s*/gi, "km "],

  // Cargos/títulos comunes en nombres de calles
  [/\bgral\.?\s+/gi, "general "],
  [/\bcnel\.?\s+/gi, "coronel "],
  [/\btte\.?\s+/gi, "teniente "],
  [/\bcap\.?\s+/gi, "capitan "],
  [/\bdr\.?\s+/gi, "doctor "],
  [/\bdra\.?\s+/gi, "doctora "],
  [/\bprof\.?\s+/gi, "profesor "],
  [/\bing\.?\s+/gi, "ingeniero "],
  [/\barq\.?\s+/gi, "arquitecto "],
  [/\bpdte\.?\s+/gi, "presidente "],
  [/\bpte\.?\s+/gi, "presidente "],
  [/\bpres\.?\s+/gi, "presidente "],
  [/\bsr\.?\s+/gi, ""],
  [/\bsra\.?\s+/gi, ""],

  // Religiosos
  [/\bsta\.?\s+/gi, "santa "],
  [/\bsto\.?\s+/gi, "santo "],
  [/\bsn\.?\s+/gi, "san "],

  // Nombres comunes abreviados
  [/\bedo\.?\s+/gi, "eduardo "],
  [/\bfco\.?\s+/gi, "francisco "],
  [/\bjose\b/gi, "jose"],
  [/\bjosé\b/gi, "jose"],
  [/\bma\.\s+/gi, "maria "],

  // Sufijos a eliminar (unidad/local/etc)
  [/\bdpto\.?\s*\d*/gi, ""],
  [/\bdepto\.?\s*\d*/gi, ""],
  [/\boficina\s*\d+/gi, ""],
  [/\bof\.?\s*\d+/gi, ""],
  [/\block\s*\d+/gi, ""],
  [/\bpiso\s*\d+/gi, ""],
  [/\blocal\s*\d+/gi, ""],
  [/\bmodulo\s*\d+/gi, ""],
  [/\bmod\.?\s*\d+/gi, ""],
  [/\bnro\.?\s*/gi, ""],
  [/\bn[°ºo]\.?\s*/gi, ""],
  [/\b#\s*/g, ""],

  // "Mall", "Strip Center", "Centro Comercial" → ruido
  [/\bstrip\s+center\b/gi, ""],
  [/\bcentro\s+comercial\b/gi, ""],
  [/\bmall\s+plaza\b/gi, ""],
  [/\bmall\b/gi, ""],

  // Sin número
  [/\bs\s*\/\s*n\b/gi, ""],
  [/\bs\s*n\b(?!\w)/gi, ""],
  [/\bsin\s+numero\b/gi, ""],
];

const ROMAN_TO_ARABIC: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5",
  vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
};

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Devuelve una versión normalizada para usar como llave estable de alias
 * y para comparar contra direcciones de POIs guardados.
 */
export const normalizeAddress = (raw: string): string => {
  if (!raw) return "";
  let s = stripAccents(raw.toLowerCase().trim());
  // Quitar contenido entre paréntesis ("(esquina X)", "(frente al mall)").
  s = s.replace(/\([^)]*\)/g, " ");
  // Reemplazar abreviaturas
  for (const [r, repl] of ABBREV) s = s.replace(r, repl);
  // Quitar sufijos "1234-A" → "1234" (sólo para llave de alias).
  s = s.replace(/(\d+)\s*[-/]\s*[a-z]\b/gi, "$1");
  // Romanos → arábigos en tokens cortos al final ("calle los carrera ii")
  s = s.replace(/\b(i{1,3}|iv|v|vi{0,3}|ix|x)\b/gi, (m) => ROMAN_TO_ARABIC[m.toLowerCase()] ?? m);
  // Limpiar puntuación residual
  s = s.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
  return s;
};

/**
 * Normaliza un nombre (de local, sucursal, POI) con criterios similares
 * pero sin remover números (los nombres tipo "Local 045" siguen siendo distintos).
 */
export const normalizeName = (raw: string): string => {
  if (!raw) return "";
  return stripAccents(raw.toLowerCase().trim())
    .replace(/[.,;:()/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/** Tokens significativos de una dirección (para Jaccard). */
export const addressTokens = (raw: string): Set<string> => {
  const norm = normalizeAddress(raw);
  const tokens = norm
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
};

const STOPWORDS = new Set([
  "de", "del", "la", "las", "el", "los", "y", "a", "al", "en",
  "con", "por", "para", "san", "santa", "santo", "calle", "avenida",
  "pasaje", "ruta", "camino", "chile",
]);

/** Similitud Jaccard entre dos sets de tokens. */
export const tokenJaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
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

/** Variantes de query progresivamente más laxas para reintentar geocoding. */
export const buildGeocodeQueryFallbacks = (
  address: string,
  comuna: string | null,
): string[] => {
  const out: string[] = [];
  const norm = normalizeAddress(address);
  if (!norm) return out;
  out.push(buildGeocodeQuery(address, comuna));
  // Variante con dirección normalizada
  out.push(buildGeocodeQuery(norm, comuna));
  // Variante sin sufijos numéricos extra (deja sólo calle + primer número)
  const simpleMatch = norm.match(/^([a-z\s]+\s\d+)/i);
  if (simpleMatch) out.push(buildGeocodeQuery(simpleMatch[1], comuna));
  // Variante sólo la calle (sin número) — al menos posiciona la calle
  const streetOnly = norm.replace(/\d+.*$/, "").trim();
  if (streetOnly && streetOnly !== norm) {
    out.push(buildGeocodeQuery(streetOnly, comuna));
  }
  // Dedup preservando orden
  return Array.from(new Set(out));
};
