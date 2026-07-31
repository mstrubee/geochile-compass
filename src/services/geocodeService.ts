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

/** Geocodifica un lote (máx. 200) de direcciones vía la edge function geocode-addresses. */
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
