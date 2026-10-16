import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

/**
 * Biblioteca compartida de íconos PNG para carpetas y capas. Es el contenido del bucket
 * público `layer-icons`: lo que se sube se ve desde cualquier carpeta del sistema.
 */

export const LAYER_ICONS_BUCKET = "layer-icons";
export const MAX_ICON_BYTES = 512 * 1024;
/** Tope de íconos que se aceptan de un solo paquete (ZIP o selección múltiple). */
export const MAX_ICONS_PER_UPLOAD = 200;

export interface LibraryIcon {
  /** Nombre del archivo en el bucket (sirve para borrarlo). */
  path: string;
  /** Nombre legible, sin extensión ni sufijo. */
  label: string;
  url: string;
}

export interface UploadReport {
  uploaded: LibraryIcon[];
  /** Archivos que no se subieron, con el motivo. */
  rejected: { name: string; reason: string }[];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);

const readBytes = (blob: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";

/** Quita carpetas, extensión y todo lo que no sea letra, número, guion o guion bajo. */
const slugOf = (fileName: string) => {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const slug = base
    .replace(/\.png$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return slug || "icono";
};

const randomSuffix = () => Math.random().toString(36).slice(2, 8);

const toIcon = (path: string): LibraryIcon => {
  const { data } = supabase.storage.from(LAYER_ICONS_BUCKET).getPublicUrl(path);
  // "farmacia-k3j9xa.png" → "farmacia"
  const label = path.replace(/\.png$/i, "").replace(/-[a-z0-9]{6}$/, "");
  return { path, label, url: data.publicUrl };
};

export async function listLibraryIcons(): Promise<LibraryIcon[]> {
  const { data, error } = await supabase.storage
    .from(LAYER_ICONS_BUCKET)
    .list("", { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (error) throw error;
  return (data ?? []).filter((o) => /\.png$/i.test(o.name)).map((o) => toIcon(o.name));
}

interface Candidate {
  name: string;
  blob: Blob;
}

/** Expande lo elegido: los ZIP se abren y se toman sus PNG (ignora lo demás, p. ej. __MACOSX). */
async function collectCandidates(files: File[], rejected: UploadReport["rejected"]): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const file of files) {
    if (!isZip(file)) {
      out.push({ name: file.name, blob: file });
      continue;
    }
    try {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(
        (e) => !e.dir && !e.name.startsWith("__MACOSX/") && !(e.name.split("/").pop() ?? "").startsWith("."),
      );
      let pngs = 0;
      for (const entry of entries) {
        if (!/\.png$/i.test(entry.name)) {
          rejected.push({ name: `${file.name} › ${entry.name}`, reason: "No es PNG" });
          continue;
        }
        pngs++;
        out.push({ name: entry.name, blob: await entry.async("blob") });
      }
      if (!pngs) rejected.push({ name: file.name, reason: "El ZIP no tiene archivos PNG" });
    } catch {
      rejected.push({ name: file.name, reason: "No se pudo abrir el ZIP" });
    }
  }
  return out;
}

/**
 * Sube uno o varios PNG (o ZIP con PNG) a la biblioteca. Valida que sea PNG de verdad (firma del
 * archivo, no solo la extensión) y que pese menos de 512 KB; lo que no cumple se informa y el
 * resto sigue. Si un nombre ya existe no se pisa: cada archivo recibe un sufijo propio.
 */
export async function uploadLibraryIcons(files: File[]): Promise<UploadReport> {
  const report: UploadReport = { uploaded: [], rejected: [] };
  const candidates = await collectCandidates(files, report.rejected);

  const accepted = candidates.slice(0, MAX_ICONS_PER_UPLOAD);
  for (const extra of candidates.slice(MAX_ICONS_PER_UPLOAD)) {
    report.rejected.push({ name: extra.name, reason: `Máximo ${MAX_ICONS_PER_UPLOAD} íconos por vez` });
  }

  for (const c of accepted) {
    const shortName = c.name.split(/[\\/]/).pop() ?? c.name;
    if (!/\.png$/i.test(shortName)) {
      report.rejected.push({ name: shortName, reason: "No es PNG" });
      continue;
    }
    if (c.blob.size > MAX_ICON_BYTES) {
      report.rejected.push({ name: shortName, reason: "Pesa más de 512 KB" });
      continue;
    }
    const head = await readBytes(c.blob.slice(0, PNG_SIGNATURE.length));
    if (!isPng(head)) {
      report.rejected.push({ name: shortName, reason: "El archivo no es un PNG válido" });
      continue;
    }
    const path = `${slugOf(shortName)}-${randomSuffix()}.png`;
    const { error } = await supabase.storage
      .from(LAYER_ICONS_BUCKET)
      .upload(path, c.blob, { contentType: "image/png", upsert: false });
    if (error) report.rejected.push({ name: shortName, reason: error.message });
    else report.uploaded.push(toIcon(path));
  }
  return report;
}

export async function deleteLibraryIcon(path: string): Promise<void> {
  const { error } = await supabase.storage.from(LAYER_ICONS_BUCKET).remove([path]);
  if (error) throw error;
}
