/**
 * Población comunal desde la base (Censo 2024, INE). ÚNICA fuente de población por comuna de la aplicación: no hay CSV, ni cifras en el código, ni valores por
 * defecto. Si la base no tiene captura o la lectura falla, la población es `null` («sin dato»). Un error de la RPC NUNCA se disfraza de otra cifra.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PoblacionComunalRow, PoblacionEdadRow, PoblacionIndex } from "@/types/poblacion";

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
const rpc = <T>(name: string, args: Record<string, unknown> = {}): RpcResult<T> =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => RpcResult<T>)(name, args);

export const fetchPoblacionComunal = async (): Promise<PoblacionComunalRow[]> => {
  const { data, error } = await rpc<PoblacionComunalRow[]>("get_poblacion_comunal");
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const fetchPoblacionEdad = async (cut: string | null = null): Promise<PoblacionEdadRow[]> => {
  const { data, error } = await rpc<PoblacionEdadRow[]>("get_poblacion_comunal_edad", { p_cut: cut });
  if (error) throw new Error(error.message);
  return data ?? [];
};

/** Normaliza un nombre de comuna para cruzar: sin tildes, minúsculas y sin signos («O’Higgins» = «o higgins»). */
export const normName = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Nombres con los que la aplicación conoce una comuna y que NO coinciden con el del Censo ni con el de public/codigos_territoriales.csv
 * (COMMUNES, ine_communes.csv). La clave siempre es el CUT; esto solo cruza nombres.
 */
export const NAME_ALIASES: Record<string, string> = {
  "aysen": "11201",
  "coyhaique": "11101",
  "o higgins": "11302",
  "paihuano": "04105",
  "la calera": "05502",
  "llay llay": "05703",
  "marchigue": "06204",
  "san vicente de tagua tagua": "06117",
  "til til": "13303",
};

export const EMPTY_POBLACION: PoblacionIndex = { status: "empty", error: null, meta: null, byCut: new Map(), byName: new Map() };

/** Arma el índice por CUT y por nombre (nombre del Censo, nombre del CSV de códigos territoriales y alias explícitos). */
export const buildPoblacionIndex = (rows: PoblacionComunalRow[], csvNames: Record<string, string> = {}): PoblacionIndex => {
  if (rows.length === 0) return { ...EMPTY_POBLACION };
  const byCut = new Map(rows.map((r) => [r.cut, r]));
  const byName = new Map<string, PoblacionComunalRow>();
  for (const r of rows) byName.set(normName(r.comuna), r);
  for (const [cut, name] of Object.entries(csvNames)) {
    const r = byCut.get(cut);
    if (r) byName.set(normName(name), r);
  }
  for (const [alias, cut] of Object.entries(NAME_ALIASES)) {
    const r = byCut.get(cut);
    if (r) byName.set(alias, r);
  }
  const first = rows[0];
  return { status: "ok", error: null, byCut, byName, meta: { snapshotId: first.snapshot_id, periodStart: first.period_start, periodEnd: first.period_end, declaredDate: first.declared_date } };
};

/** Población censada de una comuna por CUT o por nombre; `null` = sin dato. */
export const poblacionOf = (idx: PoblacionIndex | null | undefined, key: { cut?: string | null; name?: string | null }): number | null => {
  if (!idx) return null;
  const r = (key.cut ? idx.byCut.get(key.cut) : undefined) ?? (key.name ? idx.byName.get(normName(key.name)) : undefined);
  return r ? r.total : null;
};

const fetchCsvNames = async (): Promise<Record<string, string>> => {
  try {
    const res = await fetch("/codigos_territoriales.csv");
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || ct.includes("text/html")) return {};
    const out: Record<string, string> = {};
    for (const line of (await res.text()).trim().split(/\r?\n/).slice(1)) {
      const c = line.split(",");
      if (c.length >= 6 && c[4]?.trim()) out[c[4].trim()] = c[5].trim();
    }
    return out;
  } catch {
    return {};
  }
};

let cache: PoblacionIndex | null = null;
let inflight: Promise<PoblacionIndex> | null = null;

/**
 * Carga (una vez por sesión) la población censada. Solo se cachea el éxito: si la base no responde se devuelve un índice `error` (población «sin dato»)
 * y el siguiente llamado vuelve a intentar. La causa queda en `error` y en la consola, no se oculta.
 */
export const loadPoblacionIndex = async (): Promise<PoblacionIndex> => {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [rows, csvNames] = await Promise.all([fetchPoblacionComunal(), fetchCsvNames()]);
      const idx = buildPoblacionIndex(rows, csvNames);
      if (idx.status === "ok") cache = idx;
      return idx;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[poblacion] no se pudo leer la población censada:", msg);
      return { ...EMPTY_POBLACION, status: "error" as const, error: msg };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

/** Solo para pruebas. */
export const resetPoblacionCache = () => {
  cache = null;
  inflight = null;
};
