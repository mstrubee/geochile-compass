/**
 * csv.ts
 * ───────
 * Parser CSV genérico de bajo nivel (detecta separador `,`/`;`, respeta
 * comillas, maneja BOM). Usado por parseGeoFile.ts (csvToGeoJSON) y por
 * herramientas admin que necesitan leer un CSV como filas de texto plano.
 */

/** Parsea una línea CSV respetando campos entre comillas. */
export function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

export interface ParsedCsv {
  headers: string[]; // originales, sin normalizar
  rows: string[][];
}

/** Parsea un CSV completo a headers + filas de strings (sin interpretar columnas). */
export function parseCsvRows(text: string): ParsedCsv {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length < 1) return { headers: [], rows: [] };

  const sep = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const headers = parseCsvLine(lines[0], sep).map((h) => h.replace(/^["']|["']$/g, "").trim());
  const rows = lines.slice(1).map((l) => parseCsvLine(l, sep).map((v) => v.replace(/^["']|["']$/g, "")));
  return { headers, rows };
}

/** Serializa filas de objetos a texto CSV (separador coma, comillas cuando hace falta). */
export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const esc = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(","));
  return lines.join("\n") + "\n"; // salto de línea final (convención POSIX)
}
