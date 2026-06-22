import { supabase } from "@/integrations/supabase/client";

export interface StorageFile {
  name: string;
  size: number;
  updated_at: string | null;
  mimetype: string | null;
}

// Buckets administrables desde el panel (con políticas admin de CRUD).
export const MANAGED_BUCKETS = [
  "territorial-sources",
  "geodata",
  "territorial-aggregates",
  "poi-imports",
  "brand-logos",
] as const;

export type ManagedBucket = (typeof MANAGED_BUCKETS)[number];

export const listFiles = async (bucket: string): Promise<StorageFile[]> => {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  return (data ?? [])
    .filter((o) => o.name && o.id !== null) // ignora "carpetas" placeholder
    .map((o) => ({
      name: o.name,
      size: (o.metadata as any)?.size ?? 0,
      updated_at: o.updated_at ?? (o as any).created_at ?? null,
      mimetype: (o.metadata as any)?.mimetype ?? null,
    }));
};

export const uploadFile = async (
  bucket: string,
  path: string,
  file: File,
): Promise<void> => {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
};

export const downloadFile = async (bucket: string, path: string): Promise<void> => {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const a = Object.assign(document.createElement("a"), { href: url, download: path.split("/").pop() || path });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const deleteFile = async (bucket: string, path: string): Promise<void> => {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
};

export const fmtSize = (bytes: number): string => {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};
