/**
 * Piezas comunes a los exports de una carpeta de POIs
 * (exportFolderDataset.ts y exportFolderLocales.ts).
 */
import { supabase } from "@/integrations/supabase/client";
import type { PoiFolder } from "@/types/pois";

const CHUNK = 200;
const PAGE = 1000;

/** Pagina una query filtrada por un set de poi_ids para sobrepasar el límite de 1000 filas de PostgREST. */
export const fetchPaginated = async <T,>(
  ids: string[],
  runPage: (chunk: string[], from: number, to: number) => Promise<T[]>,
): Promise<T[]> => {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    let from = 0;
    while (true) {
      const to = from + PAGE - 1;
      const rows = await runPage(slice, from, to);
      out.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return out;
};

export interface PoiAttributeRow {
  poi_id: string;
  attr_key: string;
  attr_value: string | null;
}

/** Carga `poi_attributes` de los POIs dados; `attrKeys` limita las claves traídas. */
export const fetchPoiAttributes = (poiIds: string[], attrKeys?: string[]): Promise<PoiAttributeRow[]> =>
  fetchPaginated(poiIds, async (chunk, from, to) => {
    let q = supabase.from("poi_attributes").select("poi_id,attr_key,attr_value").in("poi_id", chunk);
    if (attrKeys) q = q.in("attr_key", attrKeys);
    const { data, error } = await q.range(from, to);
    if (error) throw new Error(`poi_attributes: ${error.message}`);
    return (data ?? []) as PoiAttributeRow[];
  });

/** Ids de la carpeta y de todas sus subcarpetas (ignora las eliminadas). */
export const collectFolderIds = (rootId: string, allFolders: PoiFolder[]): Set<string> => {
  const out = new Set<string>([rootId]);
  const childrenOf = new Map<string, string[]>();
  for (const f of allFolders) {
    if (f.deleted_at) continue;
    if (!f.parent_id) continue;
    const arr = childrenOf.get(f.parent_id) ?? [];
    arr.push(f.id);
    childrenOf.set(f.parent_id, arr);
  }
  const walk = (id: string) => {
    for (const child of childrenOf.get(id) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        walk(child);
      }
    }
  };
  walk(rootId);
  return out;
};

/** Ruta "A › B" desde la carpeta raíz hasta `id`. */
export const folderPathOf = (id: string | null, byId: Map<string, PoiFolder>): string => {
  if (!id) return "";
  const parts: string[] = [];
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard++ < 100) {
    const f = byId.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parent_id;
  }
  return parts.join(" › ");
};

/**
 * Crea un escapador de celdas CSV: entrecomilla si la celda trae comillas,
 * saltos de línea o alguno de los `delimiters`. Devuelve una función de un solo
 * argumento para que sea seguro pasarla directo a `Array.map`.
 */
export const makeCsvEscape = (delimiters: string): ((v: unknown) => string) => {
  const needsQuotes = new RegExp(`["\\n\\r${delimiters.replace(/[\]\\^-]/g, "\\$&")}]`);
  return (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
};

/** Escapador del dataset completo (separador coma). */
export const csvEscape = makeCsvEscape(",");

export const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

export const slugify = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "carpeta";
