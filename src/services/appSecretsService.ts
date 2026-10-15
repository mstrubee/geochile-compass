import { supabase } from "@/integrations/supabase/client";

export interface AppSecret {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

const TABLE = "app_secrets" as const;

/**
 * Secrets "conocidos" por el sistema: aparecen siempre en el panel (aunque aún
 * no tengan valor) para que el admin sepa exactamente qué registrar.
 */
export const KNOWN_SECRETS: { key: string; description: string }[] = [
  {
    key: "GOOGLE_MAPS_API_KEY",
    description:
      "API Key de Google Maps. Activa el selector Google del mapa (teselas, búsqueda y geocodificación). " +
      "En Google Cloud habilita 'Map Tiles API', 'Places API (New)' y 'Geocoding API', y restringe la clave " +
      "por referrer a https://geoplanet.vercel.app/*",
  },
  {
    key: "OPENROUTESERVICE_API_KEY",
    description: "Clave de OpenRouteService para el cálculo de isócronas.",
  },
  {
    key: "MAPBOX_ACCESS_TOKEN",
    description: "Token de Mapbox para georreferenciar direcciones (geocodificación masiva en el admin).",
  },
];

export const maskSecret = (v: string): string => {
  if (!v) return "—";
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
};

export const listSecrets = async (): Promise<AppSecret[]> => {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .select("*")
    .order("key", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AppSecret[];
};

export const upsertSecret = async (input: {
  key: string;
  value: string;
  description?: string | null;
}): Promise<AppSecret> => {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .upsert(
      { key: input.key.trim(), value: input.value, description: input.description ?? null },
      { onConflict: "key" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as AppSecret;
};

export const deleteSecret = async (key: string): Promise<void> => {
  const { error } = await (supabase as any).from(TABLE).delete().eq("key", key);
  if (error) throw error;
};
