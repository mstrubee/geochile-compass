// Autorización de edge functions: lógica PURA (sin Deno, sin red, sin imports) para poder probarla con Vitest
// (src/test/edgeAuth.test.ts). El cableado real con supabase-js vive en ./edge-auth-deps.ts.
//
// Regla de "rol": la misma que ya aplica la interfaz (usePermissions): administrador, o `view` en la sección.
// Los permisos salen del RPC user_section_permissions, que devuelve {"__admin": true} o {"<sección>": {view, edit}}.
// Falla CERRADO: si no se puede verificar al usuario, sus permisos o la cuota, no se deja pasar.

export type SectionPerm = { view?: boolean; edit?: boolean };
export type PermissionMap = { __admin?: boolean } & Record<string, SectionPerm | boolean | undefined>;

export type Requirement =
  | { kind: "admin" }
  /** Administrador, o permiso `view` en esa sección (misma regla que `canView` del frontend). */
  | { kind: "section"; key: string };

export interface AuthDeps {
  /** Id del dueño del JWT; null si el token no es de un usuario (p. ej. la clave anon) o es inválido. */
  getUserId(token: string): Promise<string | null>;
  /** Resultado de user_section_permissions, consultado con la sesión del propio usuario; null si falló. */
  getPermissions(userId: string, token: string): Promise<PermissionMap | null>;
}

export type AuthResult =
  | { ok: true; userId: string; isAdmin: boolean }
  | { ok: false; status: 401 | 403 | 503; error: "unauthorized" | "forbidden" | "service_unavailable" };

export const bearerToken = (req: Request): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec((req.headers.get("Authorization") ?? "").trim());
  return m ? m[1] : null;
};

export const isPermitted = (perms: PermissionMap, requirement: Requirement): boolean => {
  if (perms.__admin === true) return true;
  if (requirement.kind === "admin") return false;
  const s = perms[requirement.key];
  return typeof s === "object" && s !== null && s.view === true;
};

export async function authorizeRequest(req: Request, requirement: Requirement, deps: AuthDeps): Promise<AuthResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  let userId: string | null;
  try {
    userId = await deps.getUserId(token);
  } catch {
    return { ok: false, status: 503, error: "service_unavailable" };
  }
  if (!userId) return { ok: false, status: 401, error: "unauthorized" };

  let perms: PermissionMap | null;
  try {
    perms = await deps.getPermissions(userId, token);
  } catch {
    perms = null;
  }
  if (!perms) return { ok: false, status: 503, error: "service_unavailable" };

  if (!isPermitted(perms, requirement)) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true, userId, isAdmin: perms.__admin === true };
}

// ── Cuota (api_quota) ───────────────────────────────────────────────────────────────────────────────────────

export interface QuotaDeps {
  /** consume_api_quota(api, n); null si no se pudo verificar. */
  consume(api: string, n: number): Promise<{ allowed: boolean; used: number; limit: number } | null>;
}

export type QuotaResult =
  | { ok: true; used: number; limit: number }
  | { ok: false; status: 429; error: "quota_exhausted"; used: number; limit: number }
  | { ok: false; status: 503; error: "quota_unavailable" };

export async function consumeQuota(api: string, n: number, deps: QuotaDeps): Promise<QuotaResult> {
  let r: Awaited<ReturnType<QuotaDeps["consume"]>>;
  try {
    r = await deps.consume(api, n);
  } catch {
    r = null;
  }
  if (!r) return { ok: false, status: 503, error: "quota_unavailable" };
  if (!r.allowed) return { ok: false, status: 429, error: "quota_exhausted", used: r.used, limit: r.limit };
  return { ok: true, used: r.used, limit: r.limit };
}
