// Shared module: Gemini API key rotation with automatic fallback.
// Reads keys from `public.gemini_api_keys` (admin-managed) and tries them in
// order, classifying errors and recording usage stats per key.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type GeminiErrorReason =
  | "quota"
  | "rate_limit"
  | "unavailable"
  | "auth"
  | "bad_request"
  | "other";

export interface GeminiKeyRow {
  id: string;
  alias: string;
  api_key: string;
  enabled: boolean;
  priority: number;
  last_error_at: string | null;
}

export interface GeminiAttemptError {
  keyId: string | null;
  alias: string;
  status: number;
  reason: GeminiErrorReason;
  message: string;
}

export class AllGeminiKeysFailedError extends Error {
  attempts: GeminiAttemptError[];
  constructor(attempts: GeminiAttemptError[]) {
    super("All Gemini API keys failed");
    this.attempts = attempts;
  }
}

export const getAdminClient = (): SupabaseClient | null => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

export const loadActiveKeys = async (
  admin: SupabaseClient,
): Promise<GeminiKeyRow[]> => {
  const { data, error } = await admin
    .from("gemini_api_keys")
    .select("id, alias, api_key, enabled, priority, last_error_at")
    .eq("enabled", true)
    .order("priority", { ascending: true })
    .order("last_error_at", { ascending: true, nullsFirst: true });
  if (error) {
    console.error("[gemini-rotation] failed to load keys", error);
    return [];
  }
  return (data ?? []) as GeminiKeyRow[];
};

export const classifyGeminiError = (
  status: number,
  body: string,
): GeminiErrorReason => {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("api key not valid")) {
    return "auth";
  }
  if (status === 429 || lower.includes("resource_exhausted") || lower.includes("quota")) {
    return lower.includes("rate") && !lower.includes("quota") ? "rate_limit" : "quota";
  }
  if (status === 503 || lower.includes("unavailable") || lower.includes("overloaded")) {
    return "unavailable";
  }
  if (status === 400) return "bad_request";
  return "other";
};

const recordSuccess = async (admin: SupabaseClient, keyId: string) => {
  const { data } = await admin
    .from("gemini_api_keys")
    .select("success_count")
    .eq("id", keyId)
    .maybeSingle();
  await admin
    .from("gemini_api_keys")
    .update({
      last_used_at: new Date().toISOString(),
      success_count: ((data?.success_count as number | undefined) ?? 0) + 1,
      last_error_at: null,
      last_error_message: null,
      last_error_reason: null,
    })
    .eq("id", keyId);
};

const recordFailure = async (
  admin: SupabaseClient,
  keyId: string,
  reason: GeminiErrorReason,
  message: string,
  disable: boolean,
) => {
  const { data } = await admin
    .from("gemini_api_keys")
    .select("error_count")
    .eq("id", keyId)
    .maybeSingle();
  const update: Record<string, unknown> = {
    last_error_at: new Date().toISOString(),
    last_error_reason: reason,
    last_error_message: message.slice(0, 500),
    error_count: ((data?.error_count as number | undefined) ?? 0) + 1,
  };
  if (disable) update.enabled = false;
  await admin.from("gemini_api_keys").update(update).eq("id", keyId);
};

export interface GeminiCallParams {
  model: string;
  body: unknown;
  admin?: SupabaseClient | null;
  fallbackEnvKey?: string;
}

export interface GeminiCallResult {
  data: any;
  keyAlias: string;
  keyId: string | null;
}

const callOnce = async (apiKey: string, model: string, body: unknown) => {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return res;
};

/**
 * Calls Gemini with automatic rotation across all enabled keys.
 * On 401/403 (auth) the key is auto-disabled.
 * On quota/rate_limit/unavailable, the next key is tried.
 */
export const callGeminiWithRotation = async ({
  model,
  body,
  admin,
  fallbackEnvKey,
}: GeminiCallParams): Promise<GeminiCallResult> => {
  const attempts: GeminiAttemptError[] = [];
  const keys: Array<{ id: string | null; alias: string; api_key: string }> = [];

  if (admin) {
    const dbKeys = await loadActiveKeys(admin);
    for (const k of dbKeys) keys.push({ id: k.id, alias: k.alias, api_key: k.api_key });
  }
  if (keys.length === 0 && fallbackEnvKey) {
    keys.push({ id: null, alias: "env:GEMINI_API_KEY", api_key: fallbackEnvKey });
  }

  if (keys.length === 0) {
    throw new AllGeminiKeysFailedError([
      {
        keyId: null,
        alias: "(none)",
        status: 0,
        reason: "other",
        message: "No Gemini API keys configured. Add one in Admin → Gemini API Keys.",
      },
    ]);
  }

  for (const key of keys) {
    try {
      const res = await callOnce(key.api_key, model, body);
      if (res.ok) {
        const data = await res.json();
        if (key.id && admin) {
          recordSuccess(admin, key.id).catch((e) =>
            console.error("[gemini-rotation] recordSuccess failed", e),
          );
        }
        console.log(`[gemini-rotation] success key=${key.alias} model=${model}`);
        return { data, keyAlias: key.alias, keyId: key.id };
      }
      const text = await res.text();
      const reason = classifyGeminiError(res.status, text);
      console.warn(
        `[gemini-rotation] key=${key.alias} reason=${reason} status=${res.status} -> trying next`,
      );
      attempts.push({
        keyId: key.id,
        alias: key.alias,
        status: res.status,
        reason,
        message: text.slice(0, 500),
      });
      if (key.id && admin) {
        recordFailure(admin, key.id, reason, text, reason === "auth").catch((e) =>
          console.error("[gemini-rotation] recordFailure failed", e),
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[gemini-rotation] key=${key.alias} network error`, message);
      attempts.push({
        keyId: key.id,
        alias: key.alias,
        status: 0,
        reason: "other",
        message,
      });
      if (key.id && admin) {
        recordFailure(admin, key.id, "other", message, false).catch(() => {});
      }
    }
  }

  throw new AllGeminiKeysFailedError(attempts);
};

/** Helper for the test-key edge function: try a single key, no DB updates. */
export const testGeminiKey = async (
  apiKey: string,
  model = "gemini-2.0-flash",
): Promise<{ ok: boolean; status: number; reason?: GeminiErrorReason; message?: string; latencyMs: number }> => {
  const start = Date.now();
  try {
    const res = await callOnce(apiKey, model, {
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 1 },
    });
    const latencyMs = Date.now() - start;
    if (res.ok) return { ok: true, status: res.status, latencyMs };
    const text = await res.text();
    return {
      ok: false,
      status: res.status,
      reason: classifyGeminiError(res.status, text),
      message: text.slice(0, 500),
      latencyMs,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      reason: "other",
      message: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - start,
    };
  }
};
