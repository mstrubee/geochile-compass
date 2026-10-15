/**
 * apiQuotaService
 * ────────────────
 * Cuota mensual de cada API de Google (Maps JavaScript, Places, Autocomplete, Geocoding).
 * El conteo y el bloqueo viven en la base (RPCs `consume_api_quota` etc.), así que valen para
 * todos los usuarios a la vez. Toda llamada a Google debe pedir permiso aquí ANTES de salir.
 *
 * Si no se puede verificar la cuota (error de red/RPC) se NIEGA la llamada: es preferible caer
 * a OpenStreetMap que arriesgar un cobro. Ver docs de la migración 20261015130000_api_quota.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type QuotaApi = "maps_js" | "places" | "autocomplete" | "geocoding";

export interface QuotaApiStatus {
  api: QuotaApi;
  label: string;
  free_limit: number;
  extra_authorized: number;
  /** Límite efectivo del mes: gratuito + extras autorizados. */
  limit: number;
  used: number;
}

export interface QuotaStatus {
  period: string; // YYYY-MM-DD (primer día del ciclo)
  period_end: string; // primer día del ciclo siguiente
  apis: QuotaApiStatus[];
}

export interface QuotaActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  extra_authorized?: number;
}

/** Incremento fijo de cada ampliación autorizada. */
export const QUOTA_EXTENSION_STEP = 1000;

export const QUOTA_API_ORDER: QuotaApi[] = ["maps_js", "places", "autocomplete", "geocoding"];

/** Evento global: la cuota cambió (la UI de contadores se refresca). */
export const QUOTA_CHANGED_EVENT = "apiquota:changed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);

const notifyChanged = () => {
  try { window.dispatchEvent(new CustomEvent(QUOTA_CHANGED_EVENT)); } catch { /* SSR/Node */ }
};

// Aviso de bloqueo: uno por API cada 5 min, para no inundar al usuario.
const lastBlockedToast = new Map<QuotaApi, number>();
const BLOCK_TOAST_MS = 5 * 60_000;

const BLOCKED_NAME: Record<QuotaApi, string> = {
  maps_js: "el mapa de Google",
  places: "Places",
  autocomplete: "el autocompletado de Google",
  geocoding: "la geocodificación de Google",
};

const warnBlocked = (api: QuotaApi, reason: "limit" | "unverified") => {
  const now = Date.now();
  if (now - (lastBlockedToast.get(api) ?? 0) < BLOCK_TOAST_MS) return;
  lastBlockedToast.set(api, now);
  toast.warning(
    reason === "limit"
      ? `Se alcanzó el límite gratuito de ${BLOCKED_NAME[api]}. Se usa OpenStreetMap hasta que un administrador autorice más llamadas.`
      : `No se pudo verificar la cuota de ${BLOCKED_NAME[api]}; se usa OpenStreetMap por seguridad.`,
    { duration: 8000 },
  );
};

/**
 * Pide permiso para hacer `n` llamadas a la API. Devuelve true solo si la cuota lo permite
 * (y ya la descontó). Falla cerrado: ante cualquier error devuelve false.
 */
export const consumeApiQuota = async (api: QuotaApi, n = 1): Promise<boolean> => {
  try {
    const { data, error } = await rpc("consume_api_quota", { p_api: api, p_n: n });
    if (error || !data) {
      console.warn("[ApiQuota] no se pudo verificar la cuota:", error?.message);
      warnBlocked(api, "unverified");
      return false;
    }
    notifyChanged();
    const allowed = (data as { allowed: boolean }).allowed === true;
    if (!allowed) warnBlocked(api, "limit");
    return allowed;
  } catch (e) {
    console.warn("[ApiQuota] error consultando la cuota:", e);
    warnBlocked(api, "unverified");
    return false;
  }
};

export const getApiQuotaStatus = async (): Promise<QuotaStatus> => {
  const { data, error } = await rpc("get_api_quota_status");
  if (error) throw error;
  return data as QuotaStatus;
};

// ── Administración (solo ADMIN; el servidor lo verifica) ───────────────────────

const call = async (fn: string, args: Record<string, unknown>): Promise<QuotaActionResult> => {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  notifyChanged();
  return data as QuotaActionResult;
};

export const hasApiQuotaPassword = async (): Promise<boolean> => {
  const { data, error } = await rpc("has_api_quota_password");
  if (error) throw new Error(error.message);
  return data === true;
};

export const setApiQuotaPassword = (next: string, current?: string) =>
  call("set_api_quota_password", { p_new: next, p_current: current ?? null });

export const setApiQuotaLimit = (api: QuotaApi, limit: number, password?: string) =>
  call("set_api_quota_limit", { p_api: api, p_limit: limit, p_password: password ?? null });

export const extendApiQuota = (api: QuotaApi, password: string) =>
  call("extend_api_quota", { p_api: api, p_password: password });

export interface QuotaExtensionLog {
  api: QuotaApi;
  period: string;
  amount: number;
  created_at: string;
}

export const listApiQuotaExtensions = async (): Promise<QuotaExtensionLog[]> => {
  const { data, error } = await rpc("list_api_quota_extensions");
  if (error) throw new Error(error.message);
  return (data ?? []) as QuotaExtensionLog[];
};
