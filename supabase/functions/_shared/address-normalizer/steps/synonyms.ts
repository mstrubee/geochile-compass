import { stripAccents } from "./stripAccents.ts";

const normalize = (text: string): string => stripAccents(text).toLowerCase();

// Prefijos genericos de tipo de via: si el sinonimo matchea a mitad de la
// calle, solo se acepta cuando lo que precede es uno de estos (o nada) - si
// no, un miembro corto como "Baquedano" podria matchear dentro de "Avenida
// General Baquedano" y producir "Avenida General General Manuel Baquedano".
const GENERIC_PREFIXES = new Set(["avenida", "av", "avda", "calle", "pasaje", "psje"]);

/**
 * ETAPA 8 - Si la calle contiene, desde el inicio o justo despues de un
 * prefijo generico (Avenida/Pasaje/etc), un miembro de un grupo de
 * sinonimos, genera una variante por cada otro miembro del mismo grupo.
 * stripAccents preserva la longitud caracter a caracter para el espanol
 * comun (a-a, ñ-n), por lo que los indices calculados sobre el texto
 * normalizado son validos para recortar la calle original.
 */
export const generateSynonymVariants = (calle: string, grupos: string[][]): string[] => {
  const normCalle = normalize(calle);
  const variants: string[] = [];

  for (const grupo of grupos) {
    for (const miembro of grupo) {
      const normMiembro = normalize(miembro);
      const idx = normCalle.indexOf(normMiembro);
      if (idx === -1) continue;

      const before = normCalle.slice(0, idx).trim();
      if (before !== "" && !GENERIC_PREFIXES.has(before)) continue;

      for (const otro of grupo) {
        if (otro === miembro) continue;
        const replaced = `${calle.slice(0, idx)}${otro}${calle.slice(idx + miembro.length)}`.trim();
        if (replaced && replaced !== calle) variants.push(replaced);
      }
      break; // ya se encontro el miembro que matchea; no seguir buscando otros del mismo grupo
    }
  }

  return variants;
};
