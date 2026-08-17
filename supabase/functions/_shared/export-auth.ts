/**
 * Autenticación de las funciones de exportación de solo lectura
 * (`list-saved-isochrones`, `export-sales-projection`).
 *
 * Estas funciones las llama un sistema EXTERNO (leaseflow-pro) desde el
 * navegador del usuario, que no tiene sesión de Supabase de este proyecto. Por
 * eso van con `verify_jwt = false` en config.toml y el control de acceso es un
 * API key fijo en el header `x-api-key`.
 *
 * El valor se lee vía `getSecret()` —igual que el resto de las claves del
 * proyecto—, así que se puede rotar desde Admin → "API Keys y Secrets" sin
 * redeploy, con fallback a la variable de entorno `EXPORT_API_KEY`.
 */

import { getSecret } from "./get-secret.ts";

export const EXPORT_API_KEY_NAME = "EXPORT_API_KEY";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // `x-api-key` se suma a la lista habitual: sin él el preflight del navegador
  // rechaza la llamada desde leaseflow antes de que llegue acá.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

/**
 * Comparación en tiempo constante: un `===` sobre strings corta en el primer
 * byte distinto y filtra el prefijo de la clave por diferencia de latencia.
 */
const constantTimeEquals = (a: string, b: string): boolean => {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  // La longitud sí se filtra, y es información inofensiva; lo que se protege es
  // el contenido.
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
};

/**
 * Valida el header `x-api-key`. Devuelve `null` si pasa, o la Response de
 * error que hay que retornar tal cual.
 */
export const requireApiKey = async (req: Request): Promise<Response | null> => {
  const expected = (await getSecret(EXPORT_API_KEY_NAME))?.trim();
  if (!expected) {
    // Sin clave configurada NO se abre el acceso: una función de exportación
    // sin secret quedaría pública sobre datos con RLS.
    console.error(`[export-auth] ${EXPORT_API_KEY_NAME} no está configurado`);
    return json({ error: "unauthorized" }, 401);
  }
  const provided = (req.headers.get("x-api-key") ?? "").trim();
  if (!provided || !constantTimeEquals(provided, expected)) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
};
