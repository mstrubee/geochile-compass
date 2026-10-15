/**
 * runtimeConfig
 * ──────────────
 * Carga en runtime la clave de Google Maps desde la base de datos
 * (tabla app_secrets, vía el RPC público `get_public_map_config`), para que el
 * administrador pueda registrarla o cambiarla desde el panel "API Keys y Secrets"
 * sin necesidad de redeploy.
 *
 * Precedencia: valor runtime (DB) → valor de build (VITE_GOOGLE_MAPS_KEY).
 * Si el RPC aún no existe o falla, cae al valor de build, así Google Maps sigue
 * funcionando igual que antes (sin regresión).
 */
import { supabase } from "@/integrations/supabase/client";

// En Node (sincronización desde Drive) import.meta.env puede no existir.
const BUILD_KEY =
  ((import.meta as { env?: Record<string, string> }).env?.VITE_GOOGLE_MAPS_KEY as string) || "";

let cached: string | null = null;
let loaded = false;
let inflight: Promise<string> | null = null;

/** Valor disponible sin esperar (cache runtime, o el de build como fallback). */
export function getGoogleMapsKeySync(): string {
  return (cached ?? BUILD_KEY) || "";
}

/** Carga la clave desde la DB una sola vez (dedupe). Cae al build ante error. */
export function loadGoogleMapsKey(): Promise<string> {
  if (loaded) return Promise.resolve(getGoogleMapsKeySync());
  if (!inflight) {
    inflight = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any).rpc("get_public_map_config");
        const runtimeKey = (data as { googleMapsKey?: string } | null)?.googleMapsKey?.trim();
        cached = (runtimeKey || BUILD_KEY) || "";
      } catch {
        cached = BUILD_KEY || "";
      }
      loaded = true;
      return cached ?? "";
    })();
  }
  return inflight;
}

/** Invalida la caché (tras guardar la clave en el panel admin, para re-leerla). */
export function resetGoogleMapsKeyCache(): void {
  cached = null;
  loaded = false;
  inflight = null;
}
