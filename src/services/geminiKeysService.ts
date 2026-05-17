import { supabase } from "@/integrations/supabase/client";

export interface GeminiApiKey {
  id: string;
  alias: string;
  api_key: string;
  enabled: boolean;
  priority: number;
  last_used_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  last_error_reason: string | null;
  success_count: number;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface GeminiKeyLink {
  id: string;
  label: string;
  url: string;
  order_index: number;
}

export interface GeminiKeyTestResult {
  ok: boolean;
  status: number;
  reason?: string;
  message?: string;
  latencyMs: number;
}

export const maskKey = (key: string): string => {
  if (!key) return "";
  if (key.length <= 10) return "****";
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
};

const TABLE = "gemini_api_keys" as const;
const LINKS_TABLE = "gemini_key_links" as const;

export const listGeminiKeys = async (): Promise<GeminiApiKey[]> => {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .select("*")
    .order("priority", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GeminiApiKey[];
};

export const createGeminiKey = async (input: {
  alias: string;
  api_key: string;
  enabled?: boolean;
  priority?: number;
}) => {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .insert({
      alias: input.alias,
      api_key: input.api_key,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 100,
    })
    .select()
    .single();
  if (error) throw error;
  return data as GeminiApiKey;
};

export const updateGeminiKey = async (
  id: string,
  patch: Partial<Pick<GeminiApiKey, "alias" | "api_key" | "enabled" | "priority">>,
) => {
  const { data, error } = await (supabase as any)
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as GeminiApiKey;
};

export const deleteGeminiKey = async (id: string) => {
  const { error } = await (supabase as any).from(TABLE).delete().eq("id", id);
  if (error) throw error;
};

export const testGeminiKeyById = async (
  keyId: string,
): Promise<GeminiKeyTestResult> => {
  const { data, error } = await supabase.functions.invoke("gemini-key-test", {
    body: { keyId },
  });
  if (error) throw error;
  return data as GeminiKeyTestResult;
};

export const testGeminiKeyRaw = async (
  apiKey: string,
): Promise<GeminiKeyTestResult> => {
  const { data, error } = await supabase.functions.invoke("gemini-key-test", {
    body: { apiKey },
  });
  if (error) throw error;
  return data as GeminiKeyTestResult;
};

// Links
export const listGeminiLinks = async (): Promise<GeminiKeyLink[]> => {
  const { data, error } = await (supabase as any)
    .from(LINKS_TABLE)
    .select("*")
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GeminiKeyLink[];
};

export const createGeminiLink = async (input: {
  label: string;
  url: string;
  order_index?: number;
}) => {
  const { data, error } = await (supabase as any)
    .from(LINKS_TABLE)
    .insert({ label: input.label, url: input.url, order_index: input.order_index ?? 0 })
    .select()
    .single();
  if (error) throw error;
  return data as GeminiKeyLink;
};

export const updateGeminiLink = async (
  id: string,
  patch: Partial<Pick<GeminiKeyLink, "label" | "url" | "order_index">>,
) => {
  const { data, error } = await (supabase as any)
    .from(LINKS_TABLE)
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as GeminiKeyLink;
};

export const deleteGeminiLink = async (id: string) => {
  const { error } = await (supabase as any).from(LINKS_TABLE).delete().eq("id", id);
  if (error) throw error;
};
