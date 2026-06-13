import { useState, useCallback } from "react";
import type { ComercialCategoria } from "@/types/comercial";

export interface Carpeta {
  id: string;
  nombre: string;
  parentId: string | null; // null = raíz; puede ser id de carpeta o ComercialCategoria
}

export interface CatOverride {
  cat: ComercialCategoria;
  parentId: string | null;
}

export interface ComercialTree {
  folders: Carpeta[];
  catOverrides: CatOverride[];
}

const KEY = "geochile_comercial_tree_v1";

function load(): ComercialTree {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") ?? { folders: [], catOverrides: [] };
  } catch {
    return { folders: [], catOverrides: [] };
  }
}

function persist(s: ComercialTree) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* noop */ }
}

export function descendantFolderIds(rootId: string, folders: Carpeta[]): Set<string> {
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    visited.add(cur);
    folders.filter((f) => f.parentId === cur).forEach((f) => queue.push(f.id));
  }
  return visited;
}

export function useComercialFolders() {
  const [tree, setTree] = useState<ComercialTree>(load);

  const commit = useCallback((updater: (s: ComercialTree) => ComercialTree) => {
    setTree((prev) => {
      const next = updater(prev);
      persist(next);
      return next;
    });
  }, []);

  const createFolder = useCallback(
    (nombre: string, parentId: string | null) => {
      commit((s) => ({
        ...s,
        folders: [...s.folders, { id: crypto.randomUUID(), nombre: nombre.trim() || "Nueva carpeta", parentId }],
      }));
    },
    [commit],
  );

  const renameFolder = useCallback(
    (id: string, nombre: string) => {
      commit((s) => ({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, nombre } : f)) }));
    },
    [commit],
  );

  const deleteFolder = useCallback(
    (id: string, parentId: string | null) => {
      commit((s) => {
        const dead = descendantFolderIds(id, s.folders);
        return {
          folders: s.folders.filter((f) => !dead.has(f.id)),
          catOverrides: s.catOverrides.map((o) =>
            dead.has(o.parentId ?? "") ? { ...o, parentId } : o,
          ),
        };
      });
    },
    [commit],
  );

  const moveFolderTo = useCallback(
    (id: string, newParentId: string | null, folders: Carpeta[]) => {
      if (newParentId) {
        const dead = descendantFolderIds(id, folders);
        if (dead.has(newParentId)) return; // evitar ciclo
      }
      commit((s) => ({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, parentId: newParentId } : f)) }));
    },
    [commit],
  );

  const moveCatTo = useCallback(
    (cat: ComercialCategoria, newParentId: string | null) => {
      commit((s) => {
        const existing = s.catOverrides.find((o) => o.cat === cat);
        return {
          ...s,
          catOverrides: existing
            ? s.catOverrides.map((o) => (o.cat === cat ? { ...o, parentId: newParentId } : o))
            : [...s.catOverrides, { cat, parentId: newParentId }],
        };
      });
    },
    [commit],
  );

  return { tree, createFolder, renameFolder, deleteFolder, moveFolderTo, moveCatTo };
}
