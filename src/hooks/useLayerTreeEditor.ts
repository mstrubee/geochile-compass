import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toLayerNode, type LayerNode } from "@/types/layerNodes";
import type { Json } from "@/integrations/supabase/types";
import { LAYER_TREE_QUERY_KEY, type LayerTreeData } from "@/hooks/useLayerTree";
import { TERRITORIAL_LAYERS_QUERY_KEY } from "@/hooks/useTerritorialLayers";
import {
  applyMoves,
  canDropInto,
  childrenOf,
  friendlyError,
  isNoopMove,
  nextFolderName,
  placementOf,
  planMoves,
  removeSubtrees,
  type Placement,
} from "@/utils/layerTreeEdit";

const DATA_KEY = [...LAYER_TREE_QUERY_KEY, "data"] as const;
const TRASH_KEY = [...LAYER_TREE_QUERY_KEY, "trash"] as const;
const UNDO_LIMIT = 20;

interface UndoEntry {
  label: string;
  run: () => Promise<void>;
}

export interface StyleProps {
  color?: string | null;
  icon?: string | null;
  opacity?: number | null;
}

/** Ejecuta un RPC y lanza el error de Postgres tal cual (con `code` y `message`). */
const call = async <T,>(p: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T> => {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
};

const moveRpc = (id: string, p: Placement) =>
  call(
    supabase.rpc("move_node", {
      p_node_id: id,
      p_new_parent_id: p.parentId as string,
      p_after_id: (p.afterId ?? undefined) as string,
      p_before_id: (p.beforeId ?? undefined) as string,
    }),
  );

/**
 * Edición del árbol de capas: cada acción pinta el resultado al instante,
 * llama al RPC y, si falla, revierte y avisa. Lo que se puede deshacer
 * (mover, renombrar, eliminar, crear carpeta) queda en una pila para Ctrl+Z.
 */
export const useLayerTreeEditor = () => {
  const qc = useQueryClient();
  const undoStack = useRef<UndoEntry[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStack.current = [...undoStack.current, entry].slice(-UNDO_LIMIT);
    setUndoLabel(entry.label);
  }, []);

  const getData = useCallback(() => qc.getQueryData<LayerTreeData>(DATA_KEY), [qc]);
  const setNodes = useCallback(
    (fn: (nodes: LayerNode[]) => LayerNode[] | null) => {
      qc.setQueryData<LayerTreeData>(DATA_KEY, (old) => {
        if (!old) return old;
        const next = fn(old.nodes);
        return next ? { ...old, nodes: next } : old;
      });
    },
    [qc],
  );

  /** Vuelve a leer lo que depende del árbol: el propio árbol, la papelera y lo que lee el mapa y el análisis. */
  const resync = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: DATA_KEY }),
      qc.invalidateQueries({ queryKey: TRASH_KEY }),
      qc.invalidateQueries({ queryKey: TERRITORIAL_LAYERS_QUERY_KEY }),
    ]);
  }, [qc]);

  /** Ejecuta `action` con el estado previo guardado; si falla, lo restaura y avisa. */
  const guarded = useCallback(
    async <T,>(action: () => Promise<T>, snapshot: LayerTreeData | undefined, failure: string): Promise<T | undefined> => {
      try {
        return await action();
      } catch (e) {
        if (snapshot) qc.setQueryData(DATA_KEY, snapshot);
        toast.error(failure, { description: friendlyError(e) });
        void resync();
        return undefined;
      }
    },
    [qc, resync],
  );

  // ── Deshacer ─────────────────────────────────────────────────────────────
  const undoLast = useCallback(async (): Promise<boolean> => {
    const entry = undoStack.current.at(-1);
    if (!entry) return false;
    undoStack.current = undoStack.current.slice(0, -1);
    setUndoLabel(undoStack.current.at(-1)?.label ?? null);
    try {
      await entry.run();
      toast.success(`Se deshizo: ${entry.label}`);
      await resync();
      return true;
    } catch (e) {
      toast.error("No se pudo deshacer", { description: friendlyError(e) });
      void resync();
      return false;
    }
  }, [resync]);

  // ── Mover ────────────────────────────────────────────────────────────────
  const move = useCallback(
    async (dragIds: string[], parentId: string | null, index: number, displayedSiblings?: string[]): Promise<boolean> => {
      const snapshot = getData();
      if (!snapshot) return false;
      const nodes = snapshot.nodes;
      const dragged = dragIds.map((id) => nodes.find((n) => n.id === id)).filter((n): n is LayerNode => !!n);
      if (!canDropInto(nodes, dragged, parentId)) {
        toast.error("No se puede mover ahí", { description: parentId === null ? "Una capa debe estar dentro de una carpeta." : undefined });
        return false;
      }
      const plan = planMoves(nodes, dragIds, parentId, index, displayedSiblings);
      if (isNoopMove(nodes, plan)) return false;

      const before = new Map(plan.map((m) => [m.id, placementOf(nodes, m.id)]));
      const optimistic = applyMoves(nodes, plan);
      if (optimistic) setNodes(() => optimistic);

      const ok = await guarded(
        async () => {
          for (const m of plan) await moveRpc(m.id, m);
          return true;
        },
        snapshot,
        "No se pudo mover",
      );
      if (!ok) return false;

      const label = plan.length === 1 ? `mover “${nodes.find((n) => n.id === plan[0].id)?.name ?? ""}”` : `mover ${plan.length} elementos`;
      pushUndo({
        label,
        run: async () => {
          // Se devuelven en orden inverso; si los vecinos de antes ya no sirven de ancla, se prueba con uno solo.
          for (const m of [...plan].reverse()) {
            const p = before.get(m.id);
            if (!p) continue;
            const attempts: Placement[] = [p, { ...p, beforeId: null }, { ...p, afterId: null }, { ...p, afterId: null, beforeId: null }];
            let lastError: unknown;
            for (const a of attempts) {
              try {
                await moveRpc(m.id, a);
                lastError = undefined;
                break;
              } catch (e) {
                lastError = e;
              }
            }
            if (lastError) throw lastError;
          }
        },
      });
      void resync();
      return true;
    },
    [getData, setNodes, guarded, pushUndo, resync],
  );

  // ── Renombrar ────────────────────────────────────────────────────────────
  const rename = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const snapshot = getData();
      const current = snapshot?.nodes.find((n) => n.id === id);
      const clean = name.trim();
      if (!snapshot || !current || !clean || clean === current.name) return false;
      setNodes((nodes) => nodes.map((n) => (n.id === id ? { ...n, name: clean } : n)));
      const ok = await guarded(() => call(supabase.rpc("rename_node", { p_node_id: id, p_name: clean })), snapshot, "No se pudo renombrar");
      if (!ok) return false;
      pushUndo({
        label: `renombrar “${current.name}”`,
        run: async () => {
          await call(supabase.rpc("rename_node", { p_node_id: id, p_name: current.name }));
        },
      });
      void resync();
      return true;
    },
    [getData, setNodes, guarded, pushUndo, resync],
  );

  // ── Papelera ─────────────────────────────────────────────────────────────
  const restore = useCallback(
    async (ids: string[]): Promise<boolean> => {
      try {
        for (const id of ids) await call(supabase.rpc("restore_node", { p_node_id: id }));
      } catch (e) {
        toast.error("No se pudo restaurar", { description: friendlyError(e) });
        void resync();
        return false;
      }
      await resync();
      return true;
    },
    [resync],
  );

  const archive = useCallback(
    async (ids: string[], onArchived?: (removedNodes: LayerNode[]) => void): Promise<boolean> => {
      const snapshot = getData();
      if (!snapshot || !ids.length) return false;
      const removed = snapshot.nodes.filter((n) => ids.includes(n.id));
      // Un nodo seleccionado dentro de otro también seleccionado cae con él: no se archiva dos veces.
      const topLevel = removed.filter((n) => {
        let p = n.parent_id;
        while (p) {
          if (ids.includes(p)) return false;
          p = snapshot.nodes.find((x) => x.id === p)?.parent_id ?? null;
        }
        return true;
      });
      const remaining = new Set(removeSubtrees(snapshot.nodes, topLevel.map((t) => t.id)).map((n) => n.id));
      const gone = snapshot.nodes.filter((n) => !remaining.has(n.id));
      setNodes((nodes) => nodes.filter((n) => remaining.has(n.id)));

      const ok = await guarded(
        async () => {
          for (const n of topLevel) await call(supabase.rpc("archive_node", { p_node_id: n.id }));
          return true;
        },
        snapshot,
        "No se pudo eliminar",
      );
      if (!ok) return false;

      onArchived?.(gone);
      const what = topLevel.length === 1 ? `“${topLevel[0].name}”` : `${topLevel.length} elementos`;
      const undo = async () => {
        await restore(topLevel.map((t) => t.id));
      };
      pushUndo({ label: `eliminar ${what}`, run: undo });
      toast(`${what} se movió a la papelera`, {
        action: { label: "Deshacer", onClick: () => void undoLast() },
        duration: 8000,
      });
      void resync();
      return true;
    },
    [getData, setNodes, guarded, pushUndo, resync, restore, undoLast],
  );

  // ── Crear / duplicar / propiedades ───────────────────────────────────────
  const createFolder = useCallback(
    async (parentId: string | null, name?: string): Promise<LayerNode | null> => {
      const nodes = getData()?.nodes ?? [];
      const finalName = name?.trim() || nextFolderName(childrenOf(nodes, parentId).map((n) => n.name));
      try {
        const row = await call(supabase.rpc("create_folder", { p_parent_id: parentId as string, p_name: finalName }));
        const node = toLayerNode(row);
        setNodes((cur) => [...cur, node]);
        pushUndo({
          label: `crear “${node.name}”`,
          run: async () => {
            await call(supabase.rpc("archive_node", { p_node_id: node.id }));
          },
        });
        void resync();
        return node;
      } catch (e) {
        toast.error("No se pudo crear la carpeta", { description: friendlyError(e) });
        return null;
      }
    },
    [setNodes, getData, pushUndo, resync],
  );

  const duplicate = useCallback(
    async (id: string): Promise<LayerNode | null> => {
      const promise = call(supabase.rpc("duplicate_node", { p_node_id: id }));
      toast.promise(promise, { loading: "Duplicando…", success: "Duplicado", error: (e) => friendlyError(e) });
      try {
        const node = toLayerNode(await promise);
        await resync();
        return node;
      } catch {
        return null;
      }
    },
    [resync],
  );

  const updateStyle = useCallback(
    async (id: string, patch: StyleProps): Promise<boolean> => {
      const snapshot = getData();
      if (!snapshot) return false;
      setNodes((nodes) =>
        nodes.map((n) => {
          if (n.id !== id) return n;
          const style = { ...n.style } as Record<string, unknown>;
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) delete style[k];
            else if (v !== undefined) style[k] = v;
          }
          return { ...n, style };
        }),
      );
      const ok = await guarded(
        () => call(supabase.rpc("update_node_style", { p_node_id: id, p_style: patch as unknown as Json })),
        snapshot,
        "No se pudieron guardar las propiedades",
      );
      if (!ok) return false;
      void resync();
      return true;
    },
    [getData, setNodes, guarded, resync],
  );

  return { move, rename, archive, restore, createFolder, duplicate, updateStyle, undo: undoLast, undoLabel };
};
