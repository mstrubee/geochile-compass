/**
 * scripts/local-file-client.ts
 * ───────────────────────────
 * Fuente "archivo local" para la sincronización de ventas. Expone la misma
 * forma que drive-client.ts (metadata + bytes) para que el script de sync no
 * tenga que saber de dónde sale el archivo.
 *
 * El detector de cambios es el mtime del archivo, igual que modifiedTime en
 * Drive: si no varió desde la última corrida, no hay nada que procesar.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

export interface LocalFileMeta {
  name: string;
  /** ISO 8601, derivado del mtime — mismo rol que modifiedTime de Drive. */
  modifiedTime: string;
  path: string;
  size: number;
}

const EXCEL_EXT = /\.(xlsx|xls)$/i;

export const getLocalFileMeta = async (path: string): Promise<LocalFileMeta> => {
  const abs = resolve(path);
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new Error(`No se encontró el archivo: ${abs}`);
  }
  if (!info.isFile()) throw new Error(`La ruta no es un archivo: ${abs}`);
  if (!EXCEL_EXT.test(abs)) {
    throw new Error(`El archivo no parece un Excel (.xlsx/.xls): ${abs}`);
  }
  // Excel deja archivos temporales "~$nombre.xlsx" mientras está abierto; leer
  // esos da basura, y además significa que el usuario lo tiene abierto sin
  // guardar todavía.
  if (basename(abs).startsWith("~$")) {
    throw new Error(
      `"${basename(abs)}" es un archivo temporal de Excel, no la planilla. Cierra Excel y apunta al archivo real.`,
    );
  }
  return {
    name: basename(abs),
    modifiedTime: info.mtime.toISOString(),
    path: abs,
    size: info.size,
  };
};

export const readLocalFile = async (path: string): Promise<Uint8Array> => {
  const buf = await readFile(resolve(path));
  return new Uint8Array(buf);
};
