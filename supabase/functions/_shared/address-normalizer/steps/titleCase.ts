/**
 * ETAPA 2 — Title Case, con 2 reglas especiales que el Title Case ingenuo rompe:
 *  - Apóstrofo interno ("O'Higgins", no "O'higgins").
 *  - Prefijo Mc/Mac de apellidos ("McKay", no "Mckay").
 */
const capitalizeWord = (word: string): string => {
  if (!word) return word;
  let capitalized = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  // Apóstrofo interno: capitalizar también la letra siguiente (O'Higgins).
  capitalized = capitalized.replace(/'([a-záéíóúñ])/gi, (_, c) => `'${c.toUpperCase()}`);
  // Prefijo Mc/Mac seguido de apellido (McKay, MacKenna).
  capitalized = capitalized.replace(/^(Mc|Mac)([a-záéíóúñ])/i, (_, pre, c) => `${pre[0].toUpperCase()}${pre.slice(1).toLowerCase()}${c.toUpperCase()}`);
  return capitalized;
};

export const toTitleCase = (text: string): string =>
  text
    .split(" ")
    .map((word) => (word ? word.split("-").map(capitalizeWord).join("-") : word))
    .join(" ");
