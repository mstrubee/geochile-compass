// Cableado de edge-auth.ts con supabase-js (solo Deno). La lógica y sus pruebas están en ./edge-auth.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AuthDeps, PermissionMap, QuotaDeps } from "./edge-auth.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const noSession = { persistSession: false, autoRefreshToken: false };

/**
 * Valida el JWT contra el servicio de Auth (la clave anon es un JWT válido para el gateway pero NO es de un
 * usuario, así que getUser la rechaza) y lee los permisos con la sesión del propio usuario, no con service_role.
 */
export const userAuthDeps = (): AuthDeps => {
  const clientFor = (token: string) =>
    createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: noSession,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  return {
    async getUserId(token) {
      const { data, error } = await clientFor(token).auth.getUser(token);
      return error || !data?.user ? null : data.user.id;
    },
    async getPermissions(userId, token) {
      const { data, error } = await clientFor(token).rpc("user_section_permissions", { _user_id: userId });
      return error ? null : ((data as PermissionMap | null) ?? {});
    },
  };
};

/**
 * Consume cuota con service_role: para 'ors', consume_api_quota solo acepta al servidor (si lo pudiera llamar anon,
 * cualquiera con la clave pública vaciaría la cuota). Se usa DESPUÉS de autorizar al usuario.
 */
export const serviceQuotaDeps = (): QuotaDeps => {
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: noSession });
  return {
    async consume(api, n) {
      const { data, error } = await admin.rpc("consume_api_quota", { p_api: api, p_n: n });
      if (error || !data) return null;
      const d = data as { allowed?: boolean; used?: number; limit?: number };
      return { allowed: d.allowed === true, used: Number(d.used ?? 0), limit: Number(d.limit ?? 0) };
    },
  };
};
