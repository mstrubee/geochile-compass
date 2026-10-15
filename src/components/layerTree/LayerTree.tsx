import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MapPin,
  Palette,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLayerStyles } from "@/hooks/useLayerStyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TriStateCheckbox } from "./TriStateCheckbox";
import { matchesSearch, type TreeAnalysis, type TreeRow } from "@/utils/layerTree";

export const ROW_HEIGHT = 28;
const INDENT = 16;
const MIN_ROWS = 3;
const MAX_HEIGHT = 380;
const FALLBACK_ACCENT = "#F59E0B";

const isUrlLike = (s: string | null | undefined) =>
  !!s && (s.startsWith("http") || s.startsWith("/") || s.startsWith("data:"));

const isNode = (r: TreeRow) => r.kind === "folder" || r.kind === "layer";

/** ¿Lo que se está arrastrando son archivos del escritorio (y no filas del propio árbol)? */
const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

export type OpenMap = Record<string, boolean>;

/** Qué se puede hacer con el árbol. Sin `editable`, solo lectura (y volar a / exportar). */
export interface TreeEditActions {
  onMove: (dragIds: string[], parentId: string | null, index: number, displayedSiblings: string[]) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (rows: TreeRow[]) => void;
  onNewFolder: (parent: TreeRow) => void;
  onDuplicate: (row: TreeRow) => void;
  onProperties: (row: TreeRow) => void;
  onUndo: () => void;
}

interface RowActions {
  analysis: TreeAnalysis;
  getStyle: ReturnType<typeof useLayerStyles>["getStyle"];
  edit: TreeEditActions | null;
  onToggleCheck: (row: TreeRow) => void;
  onOpenPoi: (row: TreeRow) => void;
  onLoadMore: (layerId: string) => void;
  onEditStyle: (row: TreeRow) => void;
  onResetStyle: (layerId: string) => void;
  onFlyTo?: (row: TreeRow) => void;
  onExport?: (row: TreeRow) => void;
  /** Se soltó un archivo sobre una carpeta o capa del árbol (importar ahí). */
  onDropFile?: (file: File, row: TreeRow) => void;
  /** Sin menú contextual (cuando el árbol solo muestra el contenido de un archivo). */
  hideMenu?: boolean;
}

const RowActionsContext = createContext<RowActions | null>(null);

const useRowActions = (): RowActions => {
  const ctx = useContext(RowActionsContext);
  if (!ctx) throw new Error("LayerTree: fila fuera de su contexto");
  return ctx;
};

/** Chevron para expandir; las hojas dejan el mismo hueco para que los nombres queden alineados. */
const Chevron = ({ node, expandable }: { node: NodeApi<TreeRow>; expandable: boolean }) => {
  if (!expandable) return <span className="h-4 w-4 flex-shrink-0" aria-hidden />;
  // En una búsqueda las capas aparecen "abiertas" aunque aún no se hayan pedido sus puntos.
  const open = node.isOpen && !!node.children?.length;
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={open ? "Colapsar" : "Expandir"}
      onClick={(e) => {
        e.stopPropagation();
        node.toggle();
      }}
      className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
};

const LayerSwatch = ({ color, icon }: { color: string; icon: string | null | undefined }) => {
  if (icon && isUrlLike(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className="h-4 w-4 flex-shrink-0 rounded-full object-cover"
        style={{ border: `1.5px solid ${color}` }}
      />
    );
  }
  return (
    <>
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {icon && <span className="flex-shrink-0 text-[12px] leading-none">{icon}</span>}
    </>
  );
};

/** Nombre editable en la misma fila (doble clic o F2). Enter y salir del campo guardan; Esc cancela. */
const RenameInput = ({ node }: { node: NodeApi<TreeRow> }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const value = ref.current?.value.trim() ?? "";
    if (value && value !== node.data.name) node.submit(value);
    else node.reset();
  };
  return (
    <input
      ref={ref}
      defaultValue={node.data.name}
      aria-label="Nombre"
      className="h-5 min-w-0 flex-1 rounded border border-primary bg-background px-1 text-[13px] text-foreground outline-none"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") node.reset();
      }}
    />
  );
};

const Row = ({ node, style, dragHandle, tree }: NodeRendererProps<TreeRow>) => {
  const { analysis, getStyle, edit, onToggleCheck, onOpenPoi, onLoadMore, onEditStyle, onResetStyle, onFlyTo, onExport, onDropFile, hideMenu } =
    useRowActions();
  const [fileOver, setFileOver] = useState(false);
  const row = node.data;
  const base = "flex h-full items-center gap-1.5 pr-2 text-[13px] leading-tight transition-colors";
  const hover = "cursor-pointer hover:bg-surface-2/60";
  const dropping = (node.willReceiveDrop || fileOver) && "bg-primary/15 ring-1 ring-inset ring-primary";
  // Soltar un archivo del escritorio sobre una carpeta o capa: importar ahí.
  const fileDrop = onDropFile
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          if (!fileOver) setFileOver(true);
        },
        onDragLeave: () => setFileOver(false),
        onDrop: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setFileOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onDropFile(file, row);
        },
      }
    : {};
  const dragging = node.isDragging && "opacity-40";

  if (row.kind === "status") {
    return (
      <div ref={dragHandle} style={style} className={cn(base, "text-[11px] italic text-text-muted")}>
        <span className="h-4 w-4 flex-shrink-0" aria-hidden />
        {row.name === "Cargando…" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {row.name}
      </div>
    );
  }

  if (row.kind === "more") {
    return (
      <div
        ref={dragHandle}
        style={style}
        className={cn(base, hover, "text-[11px] text-primary")}
        onClick={() => row.layerId && onLoadMore(row.layerId)}
      >
        <span className="h-4 w-4 flex-shrink-0" aria-hidden />
        {row.name}
      </div>
    );
  }

  if (row.kind === "poi") {
    const canFly = row.lat != null && row.lng != null;
    return (
      <div
        ref={dragHandle}
        style={style}
        className={cn(base, canFly ? hover : "text-text-muted", node.isSelected && "bg-surface-2")}
        title={canFly ? "Ir al punto en el mapa" : undefined}
        onClick={() => canFly && onOpenPoi(row)}
      >
        <span className="h-4 w-4 flex-shrink-0" aria-hidden />
        <MapPin className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-[12px] text-muted-foreground">{row.name}</span>
      </div>
    );
  }

  const state = analysis.states.get(row.id) ?? "unchecked";
  const on = state !== "unchecked";
  const isFolder = row.kind === "folder";
  const stat = analysis.stats.get(row.id);

  // Con Ctrl/Cmd o Shift el clic es de selección (para arrastrar o eliminar varios), no enciende ni abre.
  const isSelectionClick = (e: React.MouseEvent) => e.ctrlKey || e.metaKey || e.shiftKey;
  const onRowClick = (e: React.MouseEvent) => {
    if (isSelectionClick(e)) return;
    if (isFolder) node.toggle();
    else onToggleCheck(row);
  };

  let content: JSX.Element;
  if (isFolder) {
    const color = row.node?.style.color ?? FALLBACK_ACCENT;
    const FolderIcon = node.isOpen ? FolderOpen : Folder;
    content = (
      <div
        ref={dragHandle}
        style={style}
        className={cn(base, hover, node.isSelected && "bg-surface-2", dropping, dragging)}
        onClick={onRowClick}
        onDoubleClick={() => edit && node.isEditable && node.edit()}
        {...fileDrop}
      >
        <Chevron node={node} expandable={!!row.children?.length} />
        <TriStateCheckbox
          state={state}
          onToggle={() => onToggleCheck(row)}
          label={`Mostrar u ocultar ${row.name}`}
          disabled={!stat?.layers}
        />
        <FolderIcon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
        {node.isEditing ? (
          <RenameInput node={node} />
        ) : (
          <span className={cn("flex-1 truncate", on ? "text-foreground" : "text-muted-foreground")}>{row.name}</span>
        )}
        {!!stat?.layers && !node.isEditing && (
          <span className="font-mono text-[10px] text-text-muted">
            {stat.visibleLayers}/{stat.layers}
          </span>
        )}
      </div>
    );
  } else {
    const eff = getStyle(row.id, row.node?.style.color ?? null, row.node?.style.icon ?? null);
    const color = eff.color ?? FALLBACK_ACCENT;
    content = (
      <div
        ref={dragHandle}
        style={style}
        className={cn(base, hover, node.isSelected && "bg-surface-2", dropping, dragging)}
        aria-pressed={on}
        onClick={onRowClick}
        onDoubleClick={() => edit && node.isEditable && node.edit()}
        {...fileDrop}
      >
        <Chevron node={node} expandable={!!row.children} />
        <TriStateCheckbox state={state} onToggle={() => onToggleCheck(row)} label={`Mostrar u ocultar ${row.name}`} />
        <LayerSwatch color={color} icon={eff.icon} />
        {node.isEditing ? (
          <RenameInput node={node} />
        ) : (
          <span className={cn("flex-1 truncate", on ? "text-foreground" : "text-muted-foreground")}>{row.name}</span>
        )}
        {!node.isEditing && <span className="font-mono text-[10px] text-text-muted">{row.featureCount ?? 0}</span>}
      </div>
    );
  }

  // Un clic derecho sobre algo fuera de la selección la reemplaza; sobre algo seleccionado, actúa sobre toda la selección.
  const targets = (): TreeRow[] =>
    node.isSelected ? tree.selectedNodes.map((n) => n.data).filter(isNode) : [row];

  if (hideMenu) return content;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={() => !node.isSelected && node.select()}>
        {content}
      </ContextMenuTrigger>
      <ContextMenuContent className="z-[1200] w-56">
        {edit && isFolder && (
          <ContextMenuItem onSelect={() => edit.onNewFolder(row)}>
            <FolderPlus className="mr-2 h-3.5 w-3.5" /> Nueva carpeta aquí
          </ContextMenuItem>
        )}
        {edit && (
          <ContextMenuItem onSelect={() => setTimeout(() => node.edit(), 0)}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Renombrar
          </ContextMenuItem>
        )}
        {edit && (
          <ContextMenuItem onSelect={() => edit.onProperties(row)}>
            <Palette className="mr-2 h-3.5 w-3.5" /> Propiedades…
          </ContextMenuItem>
        )}
        {edit && (
          <ContextMenuItem onSelect={() => edit.onDuplicate(row)}>
            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicar
          </ContextMenuItem>
        )}
        {edit && <ContextMenuSeparator />}
        {onFlyTo && (
          <ContextMenuItem onSelect={() => onFlyTo(row)}>
            <Crosshair className="mr-2 h-3.5 w-3.5" /> Volar a
          </ContextMenuItem>
        )}
        {onExport && (
          <ContextMenuItem onSelect={() => onExport(row)}>
            <Download className="mr-2 h-3.5 w-3.5" /> Exportar como KMZ
          </ContextMenuItem>
        )}
        {!isFolder && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onEditStyle(row)}>✏️ Mi estilo en este equipo…</ContextMenuItem>
            <ContextMenuItem onSelect={() => onResetStyle(row.id)} className="text-muted-foreground">
              ↩ Restaurar mi estilo
            </ContextMenuItem>
          </>
        )}
        {edit && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => edit.onDelete(targets())} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {targets().length > 1 ? `Eliminar ${targets().length} elementos` : "Eliminar"}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};

interface LayerTreeProps {
  /** Árbol ya armado (con los puntos de las capas expandidas incluidos). */
  roots: readonly TreeRow[];
  analysis: TreeAnalysis;
  searchTerm: string;
  /** Apertura inicial de las carpetas (la que quedó guardada). */
  initialOpenState?: OpenMap;
  onToggleCheck: (row: TreeRow) => void;
  /** Una carpeta o capa se abrió o cerró (fuera de búsqueda). */
  onOpenChange?: (id: string, isOpen: boolean, openState: OpenMap) => void;
  onOpenPoi: (row: TreeRow) => void;
  onLoadMore: (layerId: string) => void;
  onEditStyle: (row: TreeRow) => void;
  onResetStyle: (layerId: string) => void;
  onFlyTo?: (row: TreeRow) => void;
  onExport?: (row: TreeRow) => void;
  onDropFile?: (file: File, row: TreeRow) => void;
  hideMenu?: boolean;
  /** Cuántas filas coinciden con la búsqueda (0 sin búsqueda). */
  onMatchCountChange?: (count: number) => void;
  /** Si viene, el árbol es editable (arrastrar, renombrar, eliminar…). */
  edit?: TreeEditActions;
  /** Pide dejar en modo renombrar a un nodo recién creado. */
  editRequest?: { id: string; nonce: number } | null;
  onEditRequestHandled?: () => void;
}

export const LayerTree = ({
  roots,
  analysis,
  searchTerm,
  initialOpenState,
  onToggleCheck,
  onOpenChange,
  onOpenPoi,
  onLoadMore,
  onEditStyle,
  onResetStyle,
  onFlyTo,
  onExport,
  onDropFile,
  hideMenu,
  onMatchCountChange,
  edit,
  editRequest,
  onEditRequestHandled,
}: LayerTreeProps) => {
  const treeRef = useRef<TreeApi<TreeRow> | null>(null);
  const { getStyle } = useLayerStyles();
  const [rowCount, setRowCount] = useState(0);
  // `onToggle` no re-renderiza este componente por sí solo; esto lo obliga a recalcular la altura.
  const [openTick, refresh] = useReducer((x: number) => x + 1, 0);
  const searching = searchTerm.trim().length > 0;
  // Con una búsqueda activa la lista está filtrada y los índices de un arrastre no corresponden al árbol real.
  const canEdit = !!edit && !searching;

  // Se mide después de cada cambio de datos, búsqueda o apertura: la altura sigue a las filas visibles.
  useLayoutEffect(() => {
    const api = treeRef.current;
    if (!api) return;
    setRowCount((prev) => (prev === api.visibleNodes.length ? prev : api.visibleNodes.length));
    onMatchCountChange?.(api.isFiltered ? api.filteredCount : 0);
  }, [roots, searchTerm, openTick, onMatchCountChange]);

  const actions = useMemo<RowActions>(
    () => ({
      analysis,
      getStyle,
      edit: canEdit ? edit! : null,
      onToggleCheck,
      onOpenPoi,
      onLoadMore,
      onEditStyle,
      onResetStyle,
      onFlyTo,
      onExport,
      onDropFile,
      hideMenu,
    }),
    [analysis, getStyle, canEdit, edit, onToggleCheck, onOpenPoi, onLoadMore, onEditStyle, onResetStyle, onFlyTo, onExport, onDropFile, hideMenu],
  );

  const handleToggle = useCallback(
    (id: string) => {
      const api = treeRef.current;
      if (api) onOpenChange?.(id, api.isOpen(id), api.isFiltered ? {} : { ...api.openState });
      refresh();
    },
    [onOpenChange],
  );

  const searchMatch = useCallback((node: NodeApi<TreeRow>, term: string) => {
    // Las filas de estado no deben contar como coincidencia por su texto ("Cargando…").
    if (node.data.kind === "status" || node.data.kind === "more") return false;
    const names: string[] = [];
    for (let n: NodeApi<TreeRow> | null = node; n && !n.isRoot; n = n.parent) names.push(n.data.name);
    return matchesSearch(names, term);
  }, []);

  // Un nodo recién creado entra directo en modo renombrar (cuando ya llegó al árbol).
  useEffect(() => {
    if (!editRequest) return;
    const api = treeRef.current;
    if (!api || !api.get(editRequest.id)) return;
    const t = setTimeout(() => {
      api.openParents(editRequest.id);
      void api.scrollTo(editRequest.id);
      void api.edit(editRequest.id);
      onEditRequestHandled?.();
    }, 30);
    return () => clearTimeout(t);
  }, [editRequest, roots, onEditRequestHandled]);

  // Atajos, en fase de captura para quedarse con Enter antes que la librería (que lo usa para renombrar):
  //   Enter enciende o apaga · F2 renombra · Suprimir elimina · Ctrl/Cmd+Z deshace. Flechas y Retroceso los maneja la librería.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
    const api = treeRef.current;
    if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && canEdit) {
      e.preventDefault();
      e.stopPropagation();
      edit!.onUndo();
      return;
    }
    // La librería solo borra con Retroceso; Suprimir (teclados de Windows) se atiende acá.
    if (e.key === "Delete" && canEdit) {
      const nodes = api?.selectedNodes.length ? api.selectedNodes : api?.focusedNode ? [api.focusedNode] : [];
      const rows = nodes.map((n) => n.data).filter(isNode);
      if (rows.length) {
        e.preventDefault();
        e.stopPropagation();
        edit!.onDelete(rows);
      }
      return;
    }
    if (e.key === "F2" && canEdit) {
      const node = api?.focusedNode;
      if (node && node.isEditable) {
        e.preventDefault();
        e.stopPropagation();
        void node.edit();
      }
      return;
    }
    if (e.key === "Enter") {
      const node = api?.focusedNode;
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      const row = node.data;
      if (row.kind === "folder" || row.kind === "layer") onToggleCheck(row);
      else if (row.kind === "poi") onOpenPoi(row);
      else if (row.kind === "more" && row.layerId) onLoadMore(row.layerId);
    }
  };

  const height = Math.min(MAX_HEIGHT, Math.max(rowCount, MIN_ROWS) * ROW_HEIGHT);

  return (
    <RowActionsContext.Provider value={actions}>
      <div onKeyDownCapture={onKeyDownCapture}>
        <Tree<TreeRow>
          ref={treeRef}
          data={roots}
          childrenAccessor={(d) => d.children ?? null}
          idAccessor="id"
          width="100%"
          height={height}
          rowHeight={ROW_HEIGHT}
          indent={INDENT}
          // Las carpetas parten cerradas; la búsqueda abre por su cuenta las que tienen coincidencias.
          openByDefault={false}
          initialOpenState={initialOpenState}
          searchTerm={searchTerm}
          searchMatch={searchMatch}
          onToggle={handleToggle}
          // Edición: solo carpetas y capas se arrastran o renombran; solo las carpetas reciben, y las capas no van a la raíz.
          disableDrag={(d) => !canEdit || !isNode(d)}
          disableEdit={(d) => !canEdit || !isNode(d)}
          disableDrop={({ parentNode, dragNodes }) => {
            if (!canEdit) return true;
            if (parentNode.isRoot) return dragNodes.some((n) => n.data.kind === "layer");
            return parentNode.data.kind !== "folder";
          }}
          disableMultiSelection={!canEdit}
          onMove={({ dragIds, parentId, index, parentNode }) =>
            edit?.onMove(
              dragIds,
              parentId,
              index,
              (parentNode?.children ?? []).filter((c) => isNode(c.data)).map((c) => c.id),
            )
          }
          onRename={({ id, name }) => edit?.onRename(id, name)}
          onDelete={canEdit ? ({ nodes }) => edit!.onDelete(nodes.map((n) => n.data).filter(isNode)) : undefined}
          aria-label="Capas territoriales"
        >
          {Row}
        </Tree>
      </div>
    </RowActionsContext.Provider>
  );
};
