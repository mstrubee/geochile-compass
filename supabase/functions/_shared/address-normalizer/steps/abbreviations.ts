import type { AddressChange } from "../types.ts";
import { stripAccents } from "./stripAccents.ts";

/** ETAPA 3 — Expande abreviaturas palabra por palabra usando el diccionario configurable. */
export const expandAbbreviations = (
  text: string,
  dictionary: Record<string, string>,
): { text: string; changes: AddressChange[] } => {
  const changes: AddressChange[] = [];
  const lookup = new Map<string, string>();
  for (const [key, value] of Object.entries(dictionary)) {
    if (key.startsWith("_")) continue;
    lookup.set(stripAccents(key).toUpperCase(), value);
  }

  const words = text.split(" ").map((word) => {
    const bare = word.replace(/\.$/, "");
    const key = stripAccents(bare).toUpperCase();
    const expansion = lookup.get(key);
    if (expansion && expansion !== word) {
      changes.push({ stage: "abbreviations", before: word, after: expansion });
      return expansion;
    }
    return word;
  });

  return { text: words.join(" "), changes };
};
