/**
 * ETAPA 9 - Quita tildes y diereses de una cadena ya normalizada a forma NFD.
 * Solo para generar una variante de busqueda; nunca se usa para modificar el
 * dato original que se guarda/muestra al usuario.
 */
const COMBINING_MARK_START = String.fromCharCode(768); // U+0300
const COMBINING_MARK_END = String.fromCharCode(879); // U+036F
const COMBINING_MARKS_RE = new RegExp(`[${COMBINING_MARK_START}-${COMBINING_MARK_END}]`, "g");

export const stripAccents = (text: string): string =>
  text.normalize("NFD").replace(COMBINING_MARKS_RE, "");
