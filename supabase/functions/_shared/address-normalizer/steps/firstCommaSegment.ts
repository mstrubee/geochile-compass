/**
 * Cuando la calle trae varios campos concatenados con comas (ej. "Manuel
 * Rodríguez, 62, Tinguiririca" - calle, numero y sector/localidad pegados en
 * un solo campo de origen), el primer segmento suele ser el nombre real de
 * la calle. Complementa a removeNoise/splitExtraInfo, que dependen de una
 * palabra de ruido reconocible o de encontrar el numero como token exacto -
 * este caso no tiene ninguna de las dos señales.
 */
export const firstCommaSegment = (calle: string): string | null => {
  if (!calle.includes(",")) return null;
  const first = calle.split(",")[0].trim();
  return first && first !== calle ? first : null;
};
