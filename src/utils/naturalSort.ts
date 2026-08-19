/**
 * Orden alfabético que entiende números.
 *
 * `localeCompare` sin opciones compara dígito por dígito como texto, así que
 * "Local 10" queda entre "Local 1" y "Local 2". `numeric: true` compara los
 * tramos numéricos por valor, que es el orden que una persona espera al ver una
 * lista numerada.
 *
 * El collator se crea UNA vez: construirlo por comparación es de los costos
 * escondidos más caros de `Intl`, y acá se llama dentro de `sort` sobre listas
 * que pueden tener cientos de elementos.
 *
 * `sensitivity: "base"` hace que mayúsculas y TILDES no partan el orden
 * ("Valparaíso" junto a "valparaiso"), coherente con cómo se escriben estos
 * nombres en la práctica. La ñ sigue siendo una letra distinta de la n, que es
 * lo correcto en español y no un efecto secundario.
 */
const collator = new Intl.Collator("es", {
  numeric: true,
  sensitivity: "base",
});

/** Compara dos textos en orden natural. Los vacíos y nulos van al final. */
export const compareNatural = (a: string | null | undefined, b: string | null | undefined): number => {
  const av = a ?? "";
  const bv = b ?? "";
  if (!av && !bv) return 0;
  // Un nombre vacío al principio de la lista se lee como un error de datos;
  // al final se entiende como "sin nombre".
  if (!av) return 1;
  if (!bv) return -1;
  return collator.compare(av, bv);
};

/** Comparador por una propiedad de texto, para usar directo en `.sort()`. */
export const byNameNatural = <T extends { name?: string | null }>(a: T, b: T): number =>
  compareNatural(a.name, b.name);

/** Igual que `compareNatural` pero para valores que pueden ser número o texto. */
export const compareNaturalMixed = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return compareNatural(
    a == null ? null : String(a),
    b == null ? null : String(b),
  );
};
