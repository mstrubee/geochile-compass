/**
 * Dato fuente sin espacio entre el prefijo de via y el nombre real (ej.
 * "Avenidaobispo Valdez", "Avenidakennedy") - inserta el espacio faltante.
 * Se excluye deliberadamente "calle" de esta lista: "Calles" (con "s") es
 * una palabra real de nombres de lugar en Chile y no se puede distinguir de
 * un glued-prefix sin diccionario de nombres propios; el caso "Calle X" con
 * espacio ya lo cubre el paso de abreviaturas.
 */
const GLUED_PREFIXES = ["avenida", "pasaje", "poblacion", "villa", "camino", "pje", "psje"];

export const splitGluedPrefix = (calle: string): string => {
  const lower = calle.toLowerCase();
  for (const prefix of GLUED_PREFIXES) {
    if (lower.startsWith(prefix) && calle.length > prefix.length && calle[prefix.length] !== " ") {
      return `${calle.slice(0, prefix.length)} ${calle.slice(prefix.length)}`;
    }
  }
  return calle;
};
