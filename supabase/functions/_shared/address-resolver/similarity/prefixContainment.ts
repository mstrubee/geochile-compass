const START = String.fromCharCode(768);
const END = String.fromCharCode(879);
const COMBINING_MARKS_RE = new RegExp(`[${START}-${END}]`, "g");

const tokenize = (text: string): string[] =>
  text.normalize("NFD").replace(COMBINING_MARKS_RE, "").toLowerCase().trim().split(/\s+/).filter(Boolean);

/**
 * La primera palabra debe coincidir cuando AMBOS nombres tienen 2+ palabras.
 *
 * Es el filtro que separa las correcciones legitimas de los falsos positivos
 * clasicos: en los nombres de calle chilenos la primera palabra es el
 * determinante o el nombre de pila, y confundirla cambia de calle ("Las
 * Flores" vs "Los Flores", "Joaquín Fernández Blanco" vs "Juan Fernández
 * Blanco") aunque el ratio de similitud sea alto. Los nombres de una sola
 * palabra quedan exentos: ahi el nombre entero ES la primera palabra y el
 * ratio ya es el criterio correcto ("Maquehue" -> "Manquehue").
 *
 * Validado contra los 27 pares marginales reales auditados a mano del archivo
 * del usuario: conserva los 23 correctos y rechaza 3 de los 4 falsos
 * positivos (el cuarto queda bajo el umbral de similitud igual).
 */
export const firstTokenMatches = (a: string, b: string): boolean => {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length < 2 || tb.length < 2) return true;
  return ta[0] === tb[0];
};

export interface PrefixContainment {
  /** Chars del prefijo de palabras compartido / chars del nombre mas largo (0..1). */
  coverage: number;
  /** Cuantas palabras completas comparten desde el inicio. */
  sharedTokens: number;
}

/**
 * Mide si dos nombres de calle comparten un prefijo de PALABRAS COMPLETAS.
 *
 * Complementa a los algoritmos de similitud por caracteres: el dato fuente
 * suele traer el nombre truncado o con palabras extra al final ("Doctor
 * Antonio Donghi Paladino" cuando OSM tiene "Doctor Antonio Donghi"), un caso
 * que Levenshtein/trigramas castigan por la diferencia de largo pero que es
 * una coincidencia segura. Verificado contra los casos marginales reales del
 * archivo del usuario: los truncamientos correctos dan coverage >= 0.70,
 * mientras los pares riesgosos de nombres cortos distintos ("Pasaje Kudi" vs
 * "Pasaje Kure") quedan <= 0.55.
 */
export const prefixContainment = (a: string, b: string): PrefixContainment => {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return { coverage: 0, sharedTokens: 0 };

  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;

  let sharedTokens = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) break;
    sharedTokens++;
  }
  if (sharedTokens === 0) return { coverage: 0, sharedTokens: 0 };

  const sharedChars = shorter.slice(0, sharedTokens).join(" ").length;
  const longerChars = longer.join(" ").length;
  return { coverage: sharedChars / longerChars, sharedTokens };
};
