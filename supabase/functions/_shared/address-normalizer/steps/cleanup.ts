// U+200B..U+200D (zero-width space/non-joiner/joiner) y U+FEFF (BOM) -
// construidos por codigo en vez de pegar los caracteres literales para
// evitar el lint no-irregular-whitespace y problemas de encoding en editores.
const INVISIBLE_CHARS_RE = new RegExp(
  `[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0xfeff)}]`,
  "g",
);

/** ETAPA 1 - Limpieza: espacios dobles, comas repetidas, puntos sueltos, caracteres invisibles. */
export const cleanup = (text: string): string =>
  text
    .replace(INVISIBLE_CHARS_RE, "") // caracteres invisibles (zero-width, BOM)
    .replace(/[\t\n\r]+/g, " ") // tabulaciones y saltos de linea
    .replace(/,+/g, ",") // comas repetidas
    .replace(/\s*,\s*/g, ", ") // espacio consistente alrededor de comas
    .replace(/\.{2,}/g, ".") // puntos repetidos
    .replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ])\.(?=\s|,|$)/g, "$1") // punto suelto pegado a una palabra (ej. "Avenida." typo, no abreviatura)
    .replace(/\s+/g, " ") // espacios dobles
    .replace(/^[\s,]+|[\s,]+$/g, "") // espacios/comas al inicio y final
    .trim();
