import { supabase } from "@/integrations/supabase/client";

export interface GeocodeAddressInput {
  key: string;
  calle: string;
  numero: string;
  comuna: string;
}

export interface GeocodeResult {
  key: string;
  lat: number | null;
  lng: number | null;
  found: boolean;
  confidence: string | null;
  full_address: string | null;
  cached: boolean;
}

export const normalizeAddressKey = (calle: string, numero: string, comuna: string): string =>
  `${calle} ${numero}, ${comuna}, Chile`.toLowerCase().replace(/\s+/g, " ").trim();

/** Geocodifica un lote (máx. 25) de direcciones vía la edge function geocode-addresses. */
export const geocodeBatch = async (
  addresses: GeocodeAddressInput[],
  retryNotFound = false,
): Promise<{ results: GeocodeResult[]; from_cache: number; geocoded: number }> => {
  const { data, error } = await supabase.functions.invoke("geocode-addresses", {
    body: { addresses, retry_not_found: retryNotFound },
  });
  if (error) throw error;
  return data as { results: GeocodeResult[]; from_cache: number; geocoded: number };
};

const CHECK_CHUNK = 200;

/**
 * Consulta directo a geocode_cache (sin llamar al geocodificador) para saber
 * cuáles de estas keys ya están resueltas. Permite mostrar "X ya están, Y son
 * nuevas" antes de lanzar el proceso — clave para corridas periódicas donde
 * la mayoría de las direcciones se repiten mes a mes.
 */
export const checkCacheStatus = async (
  keys: string[],
): Promise<{ cachedKeys: Set<string>; cachedFoundKeys: Set<string> }> => {
  const cachedKeys = new Set<string>();
  const cachedFoundKeys = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += CHECK_CHUNK) chunks.push(keys.slice(i, i + CHECK_CHUNK));

  await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("geocode_cache")
        .select("address_key, found")
        .in("address_key", chunk);
      if (error) throw error;
      for (const row of (data ?? []) as Array<{ address_key: string; found: boolean }>) {
        cachedKeys.add(row.address_key);
        if (row.found) cachedFoundKeys.add(row.address_key);
      }
    }),
  );

  return { cachedKeys, cachedFoundKeys };
};
