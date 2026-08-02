/**
 * ETAPA 5 - Separa informacion adicional que sigue al numero real dentro de la
 * calle, cuando no hay una palabra de ruido reconocible (ver removeNoise) que
 * ya haya hecho el corte. Ejemplo: "Pasaje Minero Walterio Zapata Sarabia 953
 * La Peña 2 C" + numero=953 -> calle="Pasaje Minero Walterio Zapata Sarabia
 * 953", extra="La Peña 2 C".
 */
export const splitExtraInfo = (
  calle: string,
  numero: string,
): { calle: string; extraInformation: string | null } => {
  if (!numero) return { calle, extraInformation: null };
  const words = calle.split(" ");
  const idx = words.indexOf(numero);
  if (idx === -1 || idx === words.length - 1) return { calle, extraInformation: null };

  const kept = words.slice(0, idx + 1).join(" ").trim();
  const extra = words.slice(idx + 1).join(" ").trim();
  return { calle: kept, extraInformation: extra || null };
};
