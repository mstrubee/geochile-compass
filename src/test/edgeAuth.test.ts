/**
 * Autorización de las edge functions `isochrone` y `sign-urls` (rama fix/seguridad-edge).
 *
 * La lógica vive en supabase/functions/_shared/edge-auth.ts (pura, sin Deno ni red) y se prueba aquí con dependencias
 * FALSAS: estos tests prueban el mecanismo, no la base real. Los handlers (`index.ts`) corren en Deno y no se pueden
 * ejecutar en Vitest; por eso las últimas pruebas comprueban su ESTRUCTURA (el orden de las llamadas) leyendo el código.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeRequest,
  bearerToken,
  consumeQuota,
  isPermitted,
  type AuthDeps,
  type PermissionMap,
  type QuotaDeps,
} from "../../supabase/functions/_shared/edge-auth.ts";

const req = (authorization?: string) =>
  new Request("https://x.test/functions/v1/f", { method: "POST", headers: authorization ? { Authorization: authorization } : {} });

const deps = (over: Partial<AuthDeps> = {}): AuthDeps & { getUserId: ReturnType<typeof vi.fn>; getPermissions: ReturnType<typeof vi.fn> } =>
  ({
    getUserId: vi.fn(async () => "user-1"),
    getPermissions: vi.fn(async () => ({}) as PermissionMap),
    ...over,
  }) as never;

const SECTION = { kind: "section", key: "isocronas" } as const;

describe("bearerToken", () => {
  it("extrae el token y acepta la palabra Bearer en cualquier capitalización", () => {
    expect(bearerToken(req("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
    expect(bearerToken(req("bearer abc"))).toBe("abc");
  });
  it("devuelve null si falta, no es Bearer o trae basura", () => {
    expect(bearerToken(req())).toBeNull();
    expect(bearerToken(req("Basic abc"))).toBeNull();
    expect(bearerToken(req("Bearer"))).toBeNull();
    expect(bearerToken(req("Bearer a b"))).toBeNull();
  });
});

describe("isPermitted (misma regla que canView del frontend)", () => {
  it("el administrador pasa cualquier requisito", () => {
    expect(isPermitted({ __admin: true }, { kind: "admin" })).toBe(true);
    expect(isPermitted({ __admin: true }, SECTION)).toBe(true);
  });
  it("sección: exige view === true", () => {
    expect(isPermitted({ isocronas: { view: true, edit: false } }, SECTION)).toBe(true);
    expect(isPermitted({ isocronas: { view: false, edit: true } }, SECTION)).toBe(false);
    expect(isPermitted({ pois: { view: true } }, SECTION)).toBe(false);
    expect(isPermitted({}, SECTION)).toBe(false);
  });
  it("un usuario con permiso de sección NO cumple el requisito de administrador", () => {
    expect(isPermitted({ isocronas: { view: true, edit: true } }, { kind: "admin" })).toBe(false);
    expect(isPermitted({ __admin: false }, { kind: "admin" })).toBe(false);
  });
  it("no se deja engañar por claves heredadas del prototipo", () => {
    expect(isPermitted({}, { kind: "section", key: "toString" })).toBe(false);
    expect(isPermitted({}, { kind: "section", key: "constructor" })).toBe(false);
  });
});

describe("authorizeRequest", () => {
  it("sin Authorization → 401 y no consulta nada", async () => {
    const d = deps();
    expect(await authorizeRequest(req(), SECTION, d)).toEqual({ ok: false, status: 401, error: "unauthorized" });
    expect(d.getUserId).not.toHaveBeenCalled();
    expect(d.getPermissions).not.toHaveBeenCalled();
  });

  it("clave anon (no es de un usuario) → 401 y no consulta permisos", async () => {
    const d = deps({ getUserId: vi.fn(async () => null) });
    expect(await authorizeRequest(req("Bearer anon-key"), SECTION, d)).toMatchObject({ ok: false, status: 401 });
    expect(d.getPermissions).not.toHaveBeenCalled();
  });

  it("falla cerrado: si Auth o los permisos no responden → 503, nunca pasa", async () => {
    expect(await authorizeRequest(req("Bearer t"), SECTION, deps({ getUserId: vi.fn(async () => { throw new Error("red"); }) })))
      .toEqual({ ok: false, status: 503, error: "service_unavailable" });
    expect(await authorizeRequest(req("Bearer t"), SECTION, deps({ getPermissions: vi.fn(async () => null) })))
      .toEqual({ ok: false, status: 503, error: "service_unavailable" });
    expect(await authorizeRequest(req("Bearer t"), SECTION, deps({ getPermissions: vi.fn(async () => { throw new Error("x"); }) })))
      .toMatchObject({ ok: false, status: 503 });
  });

  it("usuario sin permiso → 403", async () => {
    const d = deps({ getPermissions: vi.fn(async () => ({ pois: { view: true } })) });
    expect(await authorizeRequest(req("Bearer t"), SECTION, d)).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("usuario con view en la sección → pasa, sin ser admin", async () => {
    const d = deps({ getPermissions: vi.fn(async () => ({ isocronas: { view: true, edit: false } })) });
    expect(await authorizeRequest(req("Bearer t"), SECTION, d)).toEqual({ ok: true, userId: "user-1", isAdmin: false });
  });

  it("administrador → pasa en ambos requisitos; un no admin no pasa el de administrador", async () => {
    const admin = deps({ getPermissions: vi.fn(async () => ({ __admin: true })) });
    expect(await authorizeRequest(req("Bearer t"), { kind: "admin" }, admin)).toEqual({ ok: true, userId: "user-1", isAdmin: true });
    const user = deps({ getPermissions: vi.fn(async () => ({ isocronas: { view: true } })) });
    expect(await authorizeRequest(req("Bearer t"), { kind: "admin" }, user)).toMatchObject({ ok: false, status: 403 });
  });

  it("le pasa al cableado el token y el id validado (los permisos se leen con la sesión del usuario)", async () => {
    const d = deps({ getPermissions: vi.fn(async () => ({ __admin: true })) });
    await authorizeRequest(req("Bearer el-token"), SECTION, d);
    expect(d.getUserId).toHaveBeenCalledWith("el-token");
    expect(d.getPermissions).toHaveBeenCalledWith("user-1", "el-token");
  });
});

describe("consumeQuota", () => {
  const q = (r: Awaited<ReturnType<QuotaDeps["consume"]>> | "throw"): QuotaDeps & { consume: ReturnType<typeof vi.fn> } =>
    ({ consume: vi.fn(async () => { if (r === "throw") throw new Error("x"); return r; }) }) as never;

  it("permitida → ok con el consumo", async () => {
    const d = q({ allowed: true, used: 5, limit: 10 });
    expect(await consumeQuota("ors", 1, d)).toEqual({ ok: true, used: 5, limit: 10 });
    expect(d.consume).toHaveBeenCalledWith("ors", 1);
  });
  it("agotada → 429 con used y limit", async () => {
    expect(await consumeQuota("ors", 1, q({ allowed: false, used: 10, limit: 10 })))
      .toEqual({ ok: false, status: 429, error: "quota_exhausted", used: 10, limit: 10 });
  });
  it("falla cerrado: sin respuesta o con error → 503", async () => {
    expect(await consumeQuota("ors", 1, q(null))).toEqual({ ok: false, status: 503, error: "quota_unavailable" });
    expect(await consumeQuota("ors", 1, q("throw"))).toEqual({ ok: false, status: 503, error: "quota_unavailable" });
  });
});

// --- estructura de los handlers (corren en Deno; aquí se verifica el ORDEN de las llamadas) ---------------------------
const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf-8");
const at = (src: string, needle: string) => {
  const i = src.indexOf(needle);
  expect(i, `no se encontró «${needle}»`).toBeGreaterThan(-1);
  return i;
};

describe("estructura de supabase/functions/isochrone/index.ts", () => {
  const src = read("supabase/functions/isochrone/index.ts");

  it("autoriza (usuario + sección isocronas) ANTES de leer la clave de ORS", () => {
    expect(src).toContain('authorizeRequest(req, { kind: "section", key: "isocronas" }, userAuthDeps())');
    expect(at(src, "authorizeRequest(")).toBeLessThan(at(src, 'getSecret("OPENROUTESERVICE_API_KEY")'));
  });
  it("descuenta la cuota 'ors' DESPUÉS de validar la entrada y ANTES de llamar a ORS", () => {
    expect(src).toContain('consumeQuota("ors", 1, serviceQuotaDeps())');
    const q = at(src, "consumeQuota(");
    expect(q).toBeGreaterThan(at(src, 'error: "invalid minutes"'));
    expect(q).toBeLessThan(at(src, "await fetch(url"));
  });
  it("sigue respondiendo el preflight sin autenticar", () => {
    expect(at(src, 'req.method === "OPTIONS"')).toBeLessThan(at(src, "authorizeRequest("));
  });
  it("no deja ninguna ruta que llame a ORS sin pasar por la autorización", () => {
    expect(src.match(/await fetch\(/g)?.length).toBe(1);
  });
});

describe("estructura de supabase/functions/sign-urls/index.ts", () => {
  const src = read("supabase/functions/sign-urls/index.ts");
  it("exige administrador ANTES de crear el cliente con service_role y de firmar", () => {
    expect(src).toContain('authorizeRequest(req, { kind: "admin" }, userAuthDeps())');
    expect(at(src, "authorizeRequest(")).toBeLessThan(at(src, "SUPABASE_SERVICE_ROLE_KEY"));
    expect(at(src, "authorizeRequest(")).toBeLessThan(at(src, "createSignedUrl"));
  });
});

describe("supabase/config.toml", () => {
  const toml = read("supabase/config.toml");
  const verify = (fn: string) => new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt\\s*=\\s*(true|false)`).exec(toml)?.[1];
  it("el gateway verifica JWT en isochrone y sign-urls", () => {
    expect(verify("isochrone")).toBe("true");
    expect(verify("sign-urls")).toBe("true");
  });
});

describe("la migración de cuota de ORS", () => {
  const sql = read("supabase/migrations/20261101000000_api_quota_ors.sql");
  it("restringe el consumo de ORS a service_role y no lista ors en el estado público", () => {
    expect(sql).toContain("p_api = 'ors' and coalesce(auth.role(), '') <> 'service_role'");
    expect(sql).toContain("where c.api <> 'ors'");
  });
  it("tiene su rollback", () => {
    expect(read("supabase/rollbacks/20261101000000_api_quota_ors_down.sql")).toContain("delete from public.api_quota_config     where api = 'ors'");
  });
});
