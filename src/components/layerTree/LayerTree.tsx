import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Loader2, MapPin } from "lucide-react";
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

export type OpenMap = Record<string, boolean>;

interface RowActions {
  analysis: TreeAnalysis;
  getStyle: ReturnType<typeof useLayerStyles>["getStyle"];
  onToggleCheck: (row: TreeRow) => void;
  onOpenPoi: (row: TreeRow) => void;
  onLoadMore: (layerId: string) => void;
  onEditStyle: (row: TreeRow) => void;
  onResetStyle: (layerId: string) => void;
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

const Row = ({ node, style, dragHandle }: NodeRendererProps<TreeRow>) => {
  const { analysis, getStyle, onToggleCheck, onOpenPoi, onLoadMore, onEditStyle, onResetStyle } = useRowActions();
  const row = node.data;
  const base = "flex h-full items-center gap-1.5 pr-2 text-[13px] leading-tight transition-colors";
  const hover = "cursor-pointer hover:bg-surface-2/60";

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

  if (row.kind === "folder") {
    const stat = analysis.stats.get(row.id);
    const color = row.node?.style.color ?? FALLBACK_ACCENT;
    const FolderIcon = node.isOpen ? FolderOpen : Folder;
    return (
      <div
        ref={dragHandle}
        style={style}
        className={cn(base, hover, node.isSelected && "bg-surface-2")}
        onClick={() => node.toggle()}
      >
        <Chevron node={node} expandable={!!row.children?.length} />
        <TriStateCheckbox
          state={state}
          onToggle={() => onToggleCheck(row)}
          label={`Mostrar u ocultar ${row.name}`}
          disabled={!stat?.layers}
        />
        <FolderIcon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
        <span className={cn("flex-1 truncate", on ? "text-foreground" : "text-muted-foreground")}>{row.name}</span>
        {!!stat?.layers && (
          <span className="font-mono text-[10px] text-text-muted">
            {stat.visibleLayers}/{stat.layers}
          </span>
        )}
      </div>
    );
  }

  // Capa
  const eff = getStyle(row.id, row.node?.style.color ?? null, row.node?.style.icon ?? null);
  const color = eff.color ?? FALLBACK_ACCENT;
  const hasPoints = !!row.children;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dragHandle}
          style={style}
          className={cn(base, hover, node.isSelected && "bg-surface-2")}
          aria-pressed={on}
          onClick={() => onToggleCheck(row)}
        >
          <Chevron node={node} expandable={hasPoints} />
          <TriStateCheckbox state={state} onToggle={() => onToggleCheck(row)} label={`Mostrar u ocultar ${row.name}`} />
          <LayerSwatch color={color} icon={eff.icon} />
          <span className={cn("flex-1 truncate", on ? "text-foreground" : "text-muted-foreground")}>{row.name}</span>
          <span className="font-mono text-[10px] text-text-muted">{row.featureCount ?? 0}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="z-[1200] w-52">
        <ContextMenuItem onSelect={() => onEditStyle(row)}>✏️ Editar estilo (color, ícono, tamaño)</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onResetStyle(row.id)} className="text-muted-foreground">
          ↩ Restaurar estilo por defecto
        </ContextMenuItem>
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
  /** Cuántas filas coinciden con la búsqueda (0 sin búsqueda). */
  onMatchCountChange?: (count: number) => void;
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
  onMatchCountChange,
}: LayerTreeProps) => {
  const treeRef = useRef<TreeApi<TreeRow> | null>(null);
  const { getStyle } = useLayerStyles();
  const [rowCount, setRowCount] = useState(0);
  // `onToggle` no re-renderiza este componente por sí solo; esto lo obliga a recalcular la altura.
  const [openTick, refresh] = useReducer((x: number) => x + 1, 0);

  // Se mide después de cada cambio de datos, búsqueda o apertura: la altura sigue a las filas visibles.
  useLayoutEffect(() => {
    const api = treeRef.current;
    if (!api) return;
    setRowCount((prev) => (prev === api.visibleNodes.length ? prev : api.visibleNodes.length));
    onMatchCountChange?.(api.isFiltered ? api.filteredCount : 0);
  }, [roots, searchTerm, openTick, onMatchCountChange]);

  const actions = useMemo<RowActions>(
    () => ({ analysis, getStyle, onToggleCheck, onOpenPoi, onLoadMore, onEditStyle, onResetStyle }),
    [analysis, getStyle, onToggleCheck, onOpenPoi, onLoadMore, onEditStyle, onResetStyle],
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

  // Enter enciende o apaga lo enfocado (Espacio y las flechas ya las maneja la librería).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter") return;
    const node = treeRef.current?.focusedNode;
    if (!node) return;
    const row = node.data;
    if (row.kind === "folder" || row.kind === "layer") onToggleCheck(row);
    else if (row.kind === "poi") onOpenPoi(row);
    else if (row.kind === "more" && row.layerId) onLoadMore(row.layerId);
  };

  const height = Math.min(MAX_HEIGHT, Math.max(rowCount, MIN_ROWS) * ROW_HEIGHT);

  return (
    <RowActionsContext.Provider value={actions}>
      <div onKeyDown={onKeyDown}>
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
          // Fase 2 es de solo lectura: sin arrastrar, renombrar ni selección múltiple.
          disableDrag
          disableDrop
          disableEdit
          disableMultiSelection
          aria-label="Capas territoriales"
        >
          {Row}
        </Tree>
      </div>
    </RowActionsContext.Provider>
  );
};
