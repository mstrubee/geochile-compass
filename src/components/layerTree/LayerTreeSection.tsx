import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderPlus, Search, Settings2, Trash2, Undo2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LAYER_TREE_QUERY_KEY, useLayerFeaturePreviews, useLayerTreeData } from "@/hooks/useLayerTree";
import { useLayerTreeEditor } from "@/hooks/useLayerTreeEditor";
import { useTerritorialVisibility } from "@/hooks/useTerritorialVisibility";
import { useLayerStyles } from "@/hooks/useLayerStyles";
import { TerritorialLayerManagerDialog } from "@/components/panels/TerritorialLayerManagerDialog";
import { BrandStyleEditorDialog } from "@/components/panels/BrandStyleEditorDialog";
import type { BrandStyle } from "@/hooks/useBrandStyles";
import { buildKmzTree, fetchNodeBounds, type NodeBounds } from "@/services/layerTreeExport";
import { exportLayerTreeAsKmz } from "@/utils/kmzExport";
import {
  activationWeight,
  analyzeTree,
  applyLegacyRootRules,
  buildLayerTree,
  collectLayerIds,
  resolveToggle,
  withFeaturePreviews,
  type ToggleResolution,
  type TreeRow,
} from "@/utils/layerTree";
import { friendlyError, type TrashItem } from "@/utils/layerTreeEdit";
import { LayerTree, type OpenMap, type TreeEditActions } from "./LayerTree";
import { NodePropertiesDialog } from "./NodePropertiesDialog";
import { TrashDialog } from "./TrashDialog";

/** Encender de una vez más puntos que estos pide confirmación (hay 67 mil en total). */
export const CONFIRM_ACTIVATION_POINTS = 50_000;

const OPEN_STATE_KEY = "geochile.layerTree.open.v1";

const readOpenState = (): OpenMap => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_STATE_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as OpenMap) : {};
  } catch {
    return {};
  }
};

const IOSSwitch = ({ on }: { on: boolean }) => (
  <div
    className={["relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors", on ? "bg-brand-green" : "bg-surface-3"].join(" ")}
  >
    <span
      className={[
        "absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-apple-sm transition-all",
        on ? "left-[16px]" : "left-[2px]",
      ].join(" ")}
    />
  </div>
);

const ToolButton = ({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
  >
    {children}
  </button>
);

interface Props {
  isAdmin?: boolean;
  /** Centra el mapa en un punto (clic sobre un punto de una capa). */
  onFlyToPoint?: (lat: number, lng: number) => void;
  /** Encuadra el mapa en el rectángulo que contiene una carpeta o capa ("Volar a"). */
  onFlyToBounds?: (bounds: NodeBounds) => void;
}

/**
 * Panel de capas: árbol de carpetas y capas con casillas de tres estados. La
 * visibilidad que se marca acá es la misma (`useTerritorialVisibility`) que lee
 * el mapa, así que no hay otra capa Leaflet que mantener. Los administradores
 * además pueden ordenarlo (arrastrar y soltar), crear carpetas, renombrar,
 * editar propiedades, duplicar y eliminar (a la papelera, con deshacer).
 */
export const LayerTreeSection = ({ isAdmin = false, onFlyToPoint, onFlyToBounds }: Props) => {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useLayerTreeData();
  const { visibleLayerIds, setLayers, heatmapEnabled, setHeatmapEnabled } = useTerritorialVisibility();
  const { getStyle, setLayerStyle, resetLayerStyle } = useLayerStyles();
  const editor = useLayerTreeEditor();
  const { move, rename, archive, restore, createFolder, duplicate, updateStyle, undo, undoLabel } = editor;

  const [search, setSearch] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [initialOpen] = useState<OpenMap>(readOpenState);
  // capa → páginas de puntos pedidas (solo las capas que el usuario expandió)
  const [requested, setRequested] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<{ res: ToggleResolution; points: number } | null>(null);
  const [editing, setEditing] = useState<TreeRow | null>(null);
  const [propertiesRow, setPropertiesRow] = useState<TreeRow | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [editRequest, setEditRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  const baseRoots = useMemo(
    () => (data ? applyLegacyRootRules(buildLayerTree(data.nodes, data.featureCounts).roots) : []),
    [data],
  );
  const previews = useLayerFeaturePreviews(requested, data?.featureCounts);
  const roots = useMemo(() => withFeaturePreviews(baseRoots, previews), [baseRoots, previews]);
  // Los puntos no cambian ninguna casilla: se analiza el árbol sin ellos.
  const analysis = useMemo(() => analyzeTree(baseRoots, visibleLayerIds), [baseRoots, visibleLayerIds]);

  const layerIds = useMemo(() => new Set(data?.nodes.filter((n) => n.kind === "layer").map((n) => n.id)), [data]);
  const hasVisibleLayers = useMemo(() => [...visibleLayerIds].some((id) => layerIds.has(id)), [visibleLayerIds, layerIds]);

  useEffect(() => {
    if (data && !hasVisibleLayers && heatmapEnabled) setHeatmapEnabled(false);
  }, [data, hasVisibleLayers, heatmapEnabled, setHeatmapEnabled]);

  const handleToggleCheck = useCallback(
    (row: TreeRow) => {
      const res = resolveToggle(row, analysis.states.get(row.id) ?? "unchecked", visibleLayerIds);
      if (!res.ids.length) return;
      const points = res.visible ? activationWeight(res.activating, data?.featureCounts ?? new Map()) : 0;
      if (points > CONFIRM_ACTIVATION_POINTS) setPending({ res, points });
      else setLayers(res.ids, res.visible);
    },
    [analysis, visibleLayerIds, data, setLayers],
  );

  const handleOpenChange = useCallback(
    (id: string, isOpen: boolean, openState: OpenMap) => {
      if (isOpen && (data?.featureCounts.get(id) ?? 0) > 0) {
        setRequested((prev) => (prev[id] ? prev : { ...prev, [id]: 1 }));
      }
      // Solo se recuerdan las carpetas; las capas abiertas se vuelven a pedir al expandirlas.
      const folders = Object.fromEntries(Object.entries(openState).filter(([k]) => !data?.featureCounts.has(k)));
      if (Object.keys(openState).length) {
        try {
          localStorage.setItem(OPEN_STATE_KEY, JSON.stringify(folders));
        } catch {
          // ignore
        }
      }
    },
    [data],
  );

  const handleLoadMore = useCallback((layerId: string) => setRequested((prev) => ({ ...prev, [layerId]: (prev[layerId] ?? 1) + 1 })), []);
  const handleOpenPoi = useCallback(
    (row: TreeRow) => {
      if (row.lat != null && row.lng != null) onFlyToPoint?.(row.lat, row.lng);
    },
    [onFlyToPoint],
  );

  // ── Volar a / exportar (las puede usar cualquiera) ─────────────────────────
  const handleFlyTo = useCallback(
    async (row: TreeRow) => {
      try {
        const bounds = await fetchNodeBounds(row.id);
        if (!bounds) toast(`“${row.name}” no tiene puntos que mostrar`);
        else onFlyToBounds?.(bounds);
      } catch (e) {
        toast.error("No se pudo ubicar en el mapa", { description: friendlyError(e) });
      }
    },
    [onFlyToBounds],
  );

  const handleExport = useCallback(async (row: TreeRow) => {
    const total = collectLayerIds(row).length;
    const toastId = toast.loading(`Preparando “${row.name}”…`);
    try {
      const tree = await buildKmzTree(row, (done) => toast.loading(`Preparando “${row.name}”… (${done}/${total} capas)`, { id: toastId }));
      await exportLayerTreeAsKmz(tree);
      toast.success(`“${row.name}” exportada como KMZ`, { id: toastId });
    } catch (e) {
      toast.error("No se pudo exportar", { id: toastId, description: friendlyError(e) });
    }
  }, []);

  // ── Edición (administradores) ──────────────────────────────────────────────
  const handleNewFolder = useCallback(
    async (parent: TreeRow | null) => {
      const node = await createFolder(parent?.id ?? null);
      if (node) setEditRequest({ id: node.id, nonce: Date.now() });
    },
    [createFolder],
  );

  const edit = useMemo<TreeEditActions | undefined>(
    () =>
      isAdmin
        ? {
            onMove: (dragIds, parentId, index, siblings) => void move(dragIds, parentId, index, siblings),
            onRename: (id, name) => void rename(id, name),
            // Lo eliminado deja de pintarse: se apagan sus capas para que no reaparezcan encendidas al restaurar.
            onDelete: (rows) =>
              void archive(
                rows.map((r) => r.id),
                (removed) =>
                  setLayers(
                    removed.filter((n) => n.kind === "layer").map((n) => n.id),
                    false,
                  ),
              ),
            onNewFolder: (parent) => void handleNewFolder(parent),
            onDuplicate: (row) => void duplicate(row.id),
            onProperties: setPropertiesRow,
            onUndo: () => void undo(),
          }
        : undefined,
    [isAdmin, move, rename, archive, setLayers, handleNewFolder, duplicate, undo],
  );

  const handleRestore = useCallback(
    async (item: TrashItem) => {
      if (await restore([item.node.id])) toast.success(`“${item.node.name}” restaurado`);
    },
    [restore],
  );

  const editingStyle: BrandStyle | null = editing
    ? (() => {
        const s = getStyle(editing.id, editing.node?.style.color ?? null, editing.node?.style.icon ?? null);
        return { color: s.color ?? "#F59E0B", icon: s.icon, iconSize: s.iconSize, visible: true };
      })()
    : null;

  const closeManager = () => {
    setManagerOpen(false);
    // El administrador pudo crear, mover o borrar capas.
    void queryClient.invalidateQueries({ queryKey: LAYER_TREE_QUERY_KEY });
  };

  if (isLoading) return <p className="px-2 py-1 text-[11px] text-text-muted">Cargando capas…</p>;
  if (isError || !data) {
    return (
      <div className="px-2 py-1 text-[11px] text-text-muted">
        No se pudieron cargar las capas.{" "}
        <button type="button" className="text-primary underline" onClick={() => void refetch()}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!baseRoots.length && !isAdmin) return <p className="px-2 py-1 text-[11px] text-text-muted">No hay capas.</p>;

  const heatOn = heatmapEnabled && hasVisibleLayers;
  const searching = search.trim().length > 0;

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setHeatmapEnabled(!heatOn && hasVisibleLayers)}
          disabled={!hasVisibleLayers}
          className="mb-0.5 flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60 disabled:cursor-not-allowed disabled:opacity-50"
          aria-pressed={heatOn}
        >
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand-orange" />
          <span className={["flex-1 text-[13px] leading-tight", heatOn ? "text-foreground" : "text-muted-foreground"].join(" ")}>
            Mapa de calor
          </span>
          <span className="font-mono text-[10px] text-text-muted">{hasVisibleLayers ? "azul→rojo" : "—"}</span>
          <IOSSwitch on={heatOn} />
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="mb-0.5 flex-shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            title="Gestionar capas territoriales (admin)"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mb-1 flex items-center gap-0.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar capas"
            className="h-8 pl-7 pr-7 text-[12px]"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {isAdmin && (
          <>
            <ToolButton label="Nueva carpeta" onClick={() => void handleNewFolder(null)}>
              <FolderPlus className="h-4 w-4" />
            </ToolButton>
            <ToolButton label={undoLabel ? `Deshacer: ${undoLabel} (Ctrl+Z)` : "Nada que deshacer"} onClick={() => void undo()} disabled={!undoLabel}>
              <Undo2 className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Papelera" onClick={() => setTrashOpen(true)}>
              <Trash2 className="h-4 w-4" />
            </ToolButton>
          </>
        )}
      </div>
      {isAdmin && searching && (
        <p className="mb-1 px-1 text-[10px] text-text-muted">Mientras buscas no se puede arrastrar: borra la búsqueda para reordenar.</p>
      )}

      <LayerTree
        roots={roots}
        analysis={analysis}
        searchTerm={search}
        initialOpenState={initialOpen}
        onToggleCheck={handleToggleCheck}
        onOpenChange={handleOpenChange}
        onOpenPoi={handleOpenPoi}
        onLoadMore={handleLoadMore}
        onEditStyle={setEditing}
        onResetStyle={resetLayerStyle}
        onFlyTo={onFlyToBounds ? handleFlyTo : undefined}
        onExport={handleExport}
        onMatchCountChange={setMatchCount}
        edit={edit}
        editRequest={editRequest}
        onEditRequestHandled={() => setEditRequest(null)}
      />
      {searching && matchCount === 0 && (
        <p className="px-2 py-1 text-[11px] text-text-muted">Ninguna capa coincide con “{search.trim()}”.</p>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Mostrar {pending?.res.activating.length} capas?</AlertDialogTitle>
            <AlertDialogDescription>
              Suman {pending?.points.toLocaleString("es-CL")} puntos. Cargarlos de una vez puede dejar lento el mapa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) setLayers(pending.res.ids, pending.res.visible);
                setPending(null);
              }}
            >
              Mostrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BrandStyleEditorDialog
        brand={editing?.name ?? null}
        currentStyle={editingStyle}
        onSave={(_, style) => {
          if (!editing) return;
          setLayerStyle(editing.id, { color: style.color, icon: style.icon, iconSize: style.iconSize });
        }}
        onReset={() => {
          if (editing) resetLayerStyle(editing.id);
        }}
        onClose={() => setEditing(null)}
      />

      {isAdmin && (
        <>
          <NodePropertiesDialog row={propertiesRow} onClose={() => setPropertiesRow(null)} onSave={(id, patch) => void updateStyle(id, patch)} />
          <TrashDialog open={trashOpen} onClose={() => setTrashOpen(false)} onRestore={handleRestore} />
          <TerritorialLayerManagerDialog open={managerOpen} onClose={closeManager} />
        </>
      )}
    </>
  );
};
