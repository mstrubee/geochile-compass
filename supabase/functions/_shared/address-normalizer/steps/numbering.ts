import type { AddressChange, AddressWarning } from "../types.ts";

/**
 * ETAPA 6 - Numeracion: detecta un numero al final de la calle y lo compara
 * con la columna numero.
 *  - Si coincide (duplicado, ej. "Baquedano 22" + numero=22): se quita, es
 *    redundante y ensuciaria la busqueda ("Baquedano 22 22").
 *  - Si no coincide (ej. "San Nicolas 1331" + numero=94): el numero de la
 *    calle es ruido (codigo interno del dato fuente) - se quita y se confia
 *    siempre en la columna numero separada.
 */
export const fixNumbering = (
  calle: string,
  numero: string,
): { calle: string; changes: AddressChange[]; warnings: AddressWarning[] } => {
  const match = calle.match(/\s(\d+)\s*$/);
  if (!match) return { calle, changes: [], warnings: [] };

  const embedded = match[1];
  const cleaned = calle.slice(0, match.index).trim();

  if (embedded === numero) {
    return {
      calle: cleaned,
      changes: [{ stage: "numbering", before: calle, after: cleaned }],
      warnings: [],
    };
  }

  return {
    calle: cleaned,
    changes: [{ stage: "numbering", before: calle, after: cleaned }],
    warnings: [
      {
        stage: "numbering",
        message: `Numero "${embedded}" dentro de la calle no coincide con la columna numero ("${numero}") - se descarto y se uso la columna numero.`,
      },
    ],
  };
};
