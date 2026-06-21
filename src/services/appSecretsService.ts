import { supabase } from "@/integrations/supabase/client";

export interface AppSecret {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

const TABLE = "app_secrets" as const;

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
