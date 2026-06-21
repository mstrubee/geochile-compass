import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * Lee un secreto desde public.app_secrets (gestionable en el panel admin).
 * Si no existe o está vacío, cae a la variable de entorno del mismo nombre.
 */
export async function getSecret(name: string): Promise<string | undefined> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (url && serviceKey) {
    try {
      const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
      const { data } = await admin
        .from("app_secrets")
        .select("value")
        .eq("key", name)
        .maybeSingle();
      const v = (data?.value ?? "").trim();
      if (v) return v;
    } catch (_) {
      /* tabla ausente o error → fallback a env */
    }
  }
  const env = (Deno.env.get(name) ?? "").trim();
  return env || undefined;
}
