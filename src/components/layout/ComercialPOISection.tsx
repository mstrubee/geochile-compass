/**
 * ComercialPOISection.tsx — v4
 * ─────────────────────────────
 * Árbol recursivo de carpetas + categorías comerciales.
 * - Click derecho → menú contextual (crear carpeta, cortar, pegar, renombrar, eliminar, exportar)
 * - Drag & drop para mover carpetas/categorías
 * - Estado persistido en localStorage (geochile_comercial_tree_v1)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronDown, ChevronRight, Globe, FileDown, Map, X,
  FolderPlus, Scissors, ClipboardPaste, Trash2, Pencil,
  FolderOpen, Folder as FolderIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { ComercialCategoria, ComercialLayerState } from "@/types/comercial";
import { COMERCIAL_LAYER_META } from "@/types/comercial";
import { useComercialMarcas } from "@/hooks/useComercialPOI";
import {
  fetchPOIsForExport,
  downloadCSV,
  downloadKML,
  toSlug,
} from "@/utils/exportPOI";
import {
  useComercialFolders,
  descendantFolderIds,
  type Carpeta,
  type CatOverride,
} from "@/hooks/useComercialFolders";

// ── Orden por defecto de categorías ──────────────────────────────────────────

export const CATEGORY_ORDER: ComercialCategoria[] = [
  "supermercado", "farmacia", "combustible", "banco",
  "retail_departamental", "ferreteria", "restaurante",
  "automotriz", "bodega",
];

// ── Types ─────────────────────────────────────────────────────────────────────

type CtxTarget =
  | { kind: "category"; cat: ComercialCategoria }
  | { kind: "folder"; id: string; nombre: string; parentId: string | null }
  | { kind: "brand"; cat: ComercialCategoria; marca: string };

interface CtxMenuState { x: number; y: number; target: CtxTarget }

export type ClipNode =
  | { kind: "category"; cat: ComercialCategoria }
  | { kind: "folder"; id: string };

interface Props {
  layers:             ComercialLayerState;
  counts:             Partial<Record<ComercialCategoria, number>>;
  hiddenBrands:       Partial<Record<ComercialCategoria, Set<string>>>;
  onToggle:           (cat: ComercialCategoria) => void;
  onBrandToggle:      (cat: ComercialCategoria, brand: string) => void;
  onSetHiddenBrands:  (cat: ComercialCategoria, brands: Set<string>) => void;
}

// ── Switch iOS ────────────────────────────────────────────────────────────────

const IOSSwitch = ({ on }: { on: boolean }) => (
  <div className={["relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors", on ? "bg-brand-green" : "bg-surface-3"].join(" ")}>
    <span className={["absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-apple-sm transition-all", on ? "left-[16px]" : "left-[2px]"].join(" ")} />
  </div>
);

// ── FolderRow ────────────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: Carpeta;
  isDragOver: boolean;
  onCtxMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  children?: React.ReactNode;
}

const FolderRow = ({
  folder, isDragOver, onCtxMenu,
  onDragStart, onDragOver, onDragLeave, onDrop,
  children,
}: FolderRowProps) => {
  const [open, setOpen] = useState(true);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onCtxMenu}
      className={["rounded-lg transition-all", isDragOver ? "bg-blue-500/10 ring-1 ring-blue-400/40" : ""].join(" ")}
    >
      <div
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-surface-2/60 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <button
          type="button"
          className="flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          {open
            ? <ChevronDown  className="h-3 w-3 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </button>
        {open
          ? <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
          : <FolderIcon  className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />}
        <span className="flex-1 text-[13px] text-foreground leading-tight truncate">{folder.nombre}</span>
      </div>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0">{children}</div>
      )}
    </div>
  );
};

// ── CategoryRow ───────────────────────────────────────────────────────────────

interface CategoryRowProps {
  cat:               ComercialCategoria;
  on:                boolean;
  count?:            number;
  hidden:            Set<string>;
  isDragOver:        boolean;
  onToggle:          () => void;
  onBrandToggle:     (brand: string) => void;
  onSetHiddenBrands: (brands: Set<string>) => void;
  onCtxMenu:         (e: React.MouseEvent, marca?: string) => void;
  onDragStart:       (e: React.DragEvent) => void;
  onDragOver:        (e: React.DragEvent) => void;
  onDragLeave:       (e: React.DragEvent) => void;
  onDrop:            (e: React.DragEvent) => void;
}

const CategoryRow = ({
  cat, on, count, hidden, isDragOver,
  onToggle, onBrandToggle, onSetHiddenBrands,
  onCtxMenu, onDragStart, onDragOver, onDragLeave, onDrop,
}: CategoryRowProps) => {
  const [brandOpen, setBrandOpen] = useState(false);
  const meta = COMERCIAL_LAYER_META[cat];
  const { marcas, loading } = useComercialMarcas(cat, on && brandOpen);

  const allVisible   = hidden.size === 0;
  const visibleCount = marcas.filter((m) => !hidden.has(m.marca_estandar)).length;
  const someHidden   = hidden.size > 0 && marcas.length > 0 && visibleCount < marcas.length;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={["rounded-lg transition-all", isDragOver ? "bg-blue-500/10 ring-1 ring-blue-400/40" : ""].join(" ")}
      onContextMenu={(e) => onCtxMenu(e)}
    >
      <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2/60">
        <button
          type="button"
          onClick={() => on && setBrandOpen((v) => !v)}
          className={["flex-shrink-0", on ? "cursor-pointer opacity-100" : "cursor-not-allowed opacity-20"].join(" ")}
          title={on ? "Ver marcas" : "Activa la capa primero"}
        >
          {brandOpen && on
            ? <ChevronDown  className="h-3 w-3 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </button>

        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
        <span className="flex-shrink-0 text-[13px] leading-none">{meta.icon}</span>

        <button type="button" onClick={onToggle} className="flex flex-1 items-center text-left" aria-pressed={on}>
          <span className={["flex-1 text-[13px] leading-tight", on ? "text-foreground" : "text-muted-foreground"].join(" ")}>
            {meta.label}
          </span>
        </button>

        {on && count !== undefined && (
          <span className="font-mono text-[10px] text-text-muted">{count.toLocaleString()}</span>
        )}
        {on && count === undefined && (
          <span className="font-mono text-[10px] text-text-muted animate-pulse">…</span>
        )}
        {on && someHidden && (
          <span className="rounded-full bg-amber-100 px-1 py-0.5 font-mono text-[9px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {visibleCount}/{marcas.length}
          </span>
        )}

        <button type="button" onClick={onToggle} className="flex-shrink-0 ml-0.5">
          <IOSSwitch on={on} />
        </button>
      </div>

      {on && brandOpen && (
        <div className="ml-8 mt-0.5 mb-1 space-y-0.5">
          {loading && <p className="px-2 text-[11px] text-text-muted animate-pulse">Cargando marcas…</p>}
          {!loading && marcas.length === 0 && <p className="px-2 text-[11px] text-text-muted">Sin marcas registradas</p>}

          {!loading && marcas.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => onSetHiddenBrands(allVisible ? new Set(marcas.map((m) => m.marca_estandar)) : new Set())}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition-all hover:bg-surface-2/60"
              >
                <span className="flex-1 text-[12px] font-semibold text-foreground">Todas las marcas</span>
                <span className="font-mono text-[10px] text-text-muted">{visibleCount}/{marcas.length}</span>
                <IOSSwitch on={allVisible} />
              </button>

              <div className="border-t border-border/20 my-0.5" />

              {marcas.filter((m) => m.marca_estandar !== "Otros").map((m) => {
                const brandOn = !hidden.has(m.marca_estandar);
                const noPOIs  = m.n === 0;
                return (
                  <button
                    key={m.marca_estandar}
                    type="button"
                    onClick={() => onBrandToggle(m.marca_estandar)}
                    onContextMenu={(e) => onCtxMenu(e, m.marca_estandar)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-all hover:bg-surface-2/60"
                    aria-pressed={brandOn}
                    title={noPOIs ? "Sin locales sincronizados aún. Ejecuta una sincronización OSM." : undefined}
                  >
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: noPOIs ? "#9CA3AF" : meta.color, opacity: brandOn ? 1 : 0.25 }} />
                    <span className={["flex-1 text-[12px] leading-tight truncate text-left", brandOn && !noPOIs ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                      {m.marca_estandar}
                    </span>
                    <span className={["font-mono text-[10px] flex-shrink-0", noPOIs ? "text-amber-500 dark:text-amber-400" : "text-text-muted"].join(" ")}>
                      {noPOIs ? "sin sync" : m.n.toLocaleString()}
                    </span>
                    <IOSSwitch on={brandOn && !noPOIs} />
                  </button>
                );
              })}

              {marcas.some((m) => m.marca_estandar === "Otros") && (() => {
                const otros = marcas.find((m) => m.marca_estandar === "Otros")!;
                const brandOn = !hidden.has("Otros");
                return (
                  <>
                    <div className="border-t border-border/20 my-0.5" />
                    <button
                      key="Otros"
                      type="button"
                      onClick={() => onBrandToggle("Otros")}
                      onContextMenu={(e) => onCtxMenu(e, "Otros")}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-all hover:bg-surface-2/60"
                      aria-pressed={brandOn}
                      title="POIs sin cadena reconocida (nombre local, sin normalizar)"
                    >
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" style={{ opacity: brandOn ? 0.7 : 0.25 }} />
                      <span className={["flex-1 text-[12px] leading-tight truncate text-left italic", brandOn ? "text-muted-foreground" : "text-muted-foreground/50"].join(" ")}>
                        Otros
                      </span>
                      <span className="font-mono text-[10px] text-text-muted flex-shrink-0">{otros.n.toLocaleString()}</span>
                      <IOSSwitch on={brandOn} />
                    </button>
                  </>
                );
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── Context Menu ──────────────────────────────────────────────────────────────

interface CtxMenuProps {
  ctx: CtxMenuState;
  clipboard: ClipNode | null;
  onCreateFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCut: () => void;
  onPaste: () => void;
  onExport: (format: "csv" | "kml") => void;
  onClose: () => void;
}

const CtxMenu = ({
  ctx, clipboard,
  onCreateFolder, onRename, onDelete, onCut, onPaste,
  onExport, onClose,
}: CtxMenuProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const { target } = ctx;
  const isFolder   = target.kind === "folder";
  const isCategory = target.kind === "category";
  const isBrand    = target.kind === "brand";

  const label = isFolder   ? target.nombre
              : isCategory ? COMERCIAL_LAYER_META[target.cat].label
              : target.marca;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 210;
  const menuH = isBrand ? 80 : isFolder ? 210 : 200;
  const x = Math.min(ctx.x, vw - menuW - 8);
  const y = Math.min(ctx.y, vh - menuH - 8);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const id = setTimeout(() => window.addEventListener("mousedown", onOutside), 50);
    return () => { clearTimeout(id); window.removeEventListener("mousedown", onOutside); };
  }, [onClose]);

  const Row = ({ icon, label: lbl, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      className={["flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-surface-2/60", danger ? "text-red-500 dark:text-red-400" : "text-foreground"].join(" ")}
    >
      <span className="flex-shrink-0 h-4 w-4">{icon}</span>
      <span>{lbl}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[210px] rounded-xl border border-border bg-background shadow-xl overflow-hidden"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/50 bg-surface-2/40 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
            {isFolder ? "Carpeta" : isCategory ? "Categoría" : "Marca"}
          </p>
          <p className="text-[13px] font-semibold text-foreground truncate max-w-[158px]">{label}</p>
        </div>
        <button type="button" onClick={onClose} className="flex-shrink-0 mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Acciones de carpeta/categoría */}
      {!isBrand && (
        <>
          <Row icon={<FolderPlus className="h-4 w-4 text-amber-500" />} label="Crear subcarpeta" onClick={onCreateFolder} />
          {isFolder && <Row icon={<Pencil className="h-4 w-4 text-blue-500" />} label="Renombrar" onClick={onRename} />}
          <Row icon={<Scissors className="h-4 w-4 text-muted-foreground" />} label="Cortar" onClick={onCut} />
          {clipboard && (
            <Row icon={<ClipboardPaste className="h-4 w-4 text-green-500" />} label="Pegar aquí" onClick={onPaste} />
          )}
          {isFolder && (
            <Row icon={<Trash2 className="h-4 w-4" />} label="Eliminar carpeta" onClick={onDelete} danger />
          )}
          <div className="border-t border-border/30 my-0.5" />
        </>
      )}

      {/* Exportar (no en carpetas personalizadas) */}
      {!isFolder && (
        <>
          <Row icon={<FileDown className="h-4 w-4 text-green-600" />} label="Exportar CSV" onClick={() => onExport("csv")} />
          <Row icon={<Map className="h-4 w-4 text-blue-500" />} label="Exportar KML" onClick={() => onExport("kml")} />
        </>
      )}
    </div>
  );
};

// ── TreeLevel (recursivo) ─────────────────────────────────────────────────────

interface TreeLevelProps {
  parentId:    string | null;
  folders:     Carpeta[];
  catOverrides: CatOverride[];
  dragOverId:  string | null;
  onCtxMenu:   (e: React.MouseEvent, target: CtxTarget) => void;
  onDragStart: (e: React.DragEvent, node: ClipNode) => void;
  onDragOver:  (e: React.DragEvent, id: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop:      (e: React.DragEvent, targetParentId: string | null) => void;
  // layer props
  layers:             ComercialLayerState;
  counts:             Partial<Record<ComercialCategoria, number>>;
  hiddenBrands:       Partial<Record<ComercialCategoria, Set<string>>>;
  onToggle:           (cat: ComercialCategoria) => void;
  onBrandToggle:      (cat: ComercialCategoria, brand: string) => void;
  onSetHiddenBrands:  (cat: ComercialCategoria, brands: Set<string>) => void;
}

const TreeLevel = ({
  parentId, folders, catOverrides, dragOverId,
  onCtxMenu, onDragStart, onDragOver, onDragLeave, onDrop,
  layers, counts, hiddenBrands, onToggle, onBrandToggle, onSetHiddenBrands,
}: TreeLevelProps) => {
  const foldersHere = folders.filter((f) => f.parentId === parentId);
  const catsHere = CATEGORY_ORDER.filter((cat) => {
    const override = catOverrides.find((o) => o.cat === cat);
    return (override?.parentId ?? null) === parentId;
  });

  if (foldersHere.length === 0 && catsHere.length === 0) return null;

  const commonProps = { folders, catOverrides, dragOverId, onCtxMenu, onDragStart, onDragOver, onDragLeave, onDrop, layers, counts, hiddenBrands, onToggle, onBrandToggle, onSetHiddenBrands };

  return (
    <>
      {foldersHere.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          isDragOver={dragOverId === folder.id}
          onCtxMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCtxMenu(e, { kind: "folder", id: folder.id, nombre: folder.nombre, parentId: folder.parentId }); }}
          onDragStart={(e) => { e.stopPropagation(); onDragStart(e, { kind: "folder", id: folder.id }); }}
          onDragOver={(e) => { e.stopPropagation(); onDragOver(e, folder.id); }}
          onDragLeave={(e) => { e.stopPropagation(); onDragLeave(e); }}
          onDrop={(e) => { e.stopPropagation(); onDrop(e, folder.id); }}
        >
          <TreeLevel parentId={folder.id} {...commonProps} />
        </FolderRow>
      ))}

      {catsHere.map((cat) => (
        <CategoryRow
          key={cat}
          cat={cat}
          on={layers[cat]}
          count={counts[cat]}
          hidden={hiddenBrands[cat] ?? new Set()}
          isDragOver={dragOverId === cat}
          onToggle={() => onToggle(cat)}
          onBrandToggle={(brand) => onBrandToggle(cat, brand)}
          onSetHiddenBrands={(brands) => onSetHiddenBrands(cat, brands)}
          onCtxMenu={(e, marca) => {
            e.preventDefault();
            e.stopPropagation();
            const target: CtxTarget = marca
              ? { kind: "brand", cat, marca }
              : { kind: "category", cat };
            onCtxMenu(e, target);
          }}
          onDragStart={(e) => { e.stopPropagation(); onDragStart(e, { kind: "category", cat }); }}
          onDragOver={(e) => { e.stopPropagation(); onDragOver(e, cat); }}
          onDragLeave={(e) => { e.stopPropagation(); onDragLeave(e); }}
          onDrop={(e) => { e.stopPropagation(); onDrop(e, cat); }}
        />
      ))}
    </>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────

export const ComercialPOISection = ({
  layers, counts, hiddenBrands, onToggle, onBrandToggle, onSetHiddenBrands,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [ctxMenu, setCtxMenu]     = useState<CtxMenuState | null>(null);
  const [clipboard, setClipboard] = useState<ClipNode | null>(null);
  const [dragNode, setDragNode]   = useState<ClipNode | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const { tree, createFolder, renameFolder, deleteFolder, moveFolderTo, moveCatTo } = useComercialFolders();
  const activeCount = CATEGORY_ORDER.filter((c) => layers[c]).length;

  // ── DnD ──────────────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, node: ClipNode) => {
    e.dataTransfer.effectAllowed = "move";
    setDragNode(node);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
  }, []);

  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetParentId: string | null) => {
    e.preventDefault();
    setDragOverId(null);
    if (!dragNode) return;
    applyMove(dragNode, targetParentId);
    setDragNode(null);
  }, [dragNode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Move helper ───────────────────────────────────────────────────────────────

  const applyMove = useCallback((node: ClipNode, newParentId: string | null) => {
    if (node.kind === "folder") {
      moveFolderTo(node.id, newParentId, tree.folders);
    } else {
      moveCatTo(node.cat, newParentId);
    }
  }, [moveFolderTo, moveCatTo, tree.folders]);

  // ── Context menu ──────────────────────────────────────────────────────────────

  const openCtxMenu = useCallback((e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const doCreateFolder = useCallback(() => {
    if (!ctxMenu) return;
    const nombre = window.prompt("Nombre de la carpeta:");
    if (!nombre?.trim()) { setCtxMenu(null); return; }
    const parentId = ctxMenu.target.kind === "folder"    ? ctxMenu.target.id
                   : ctxMenu.target.kind === "category"  ? ctxMenu.target.cat
                   : null;
    createFolder(nombre, parentId);
    setCtxMenu(null);
  }, [ctxMenu, createFolder]);

  const doRename = useCallback(() => {
    if (!ctxMenu || ctxMenu.target.kind !== "folder") return;
    const nuevo = window.prompt("Nuevo nombre:", ctxMenu.target.nombre);
    if (!nuevo?.trim()) { setCtxMenu(null); return; }
    renameFolder(ctxMenu.target.id, nuevo.trim());
    setCtxMenu(null);
  }, [ctxMenu, renameFolder]);

  const doDelete = useCallback(() => {
    if (!ctxMenu || ctxMenu.target.kind !== "folder") return;
    const { id, parentId, nombre } = ctxMenu.target;
    if (!window.confirm(`¿Eliminar "${nombre}"?\nLas subcarpetas y categorías internas se moverán al nivel padre.`)) {
      setCtxMenu(null);
      return;
    }
    deleteFolder(id, parentId);
    setCtxMenu(null);
  }, [ctxMenu, deleteFolder]);

  const doCut = useCallback(() => {
    if (!ctxMenu) return;
    const node: ClipNode | null =
      ctxMenu.target.kind === "folder"   ? { kind: "folder",   id: ctxMenu.target.id }
    : ctxMenu.target.kind === "category" ? { kind: "category", cat: ctxMenu.target.cat }
    : null;
    setClipboard(node);
    setCtxMenu(null);
  }, [ctxMenu]);

  const doPaste = useCallback(() => {
    if (!ctxMenu || !clipboard) return;
    const targetParentId =
      ctxMenu.target.kind === "folder"   ? ctxMenu.target.id
    : ctxMenu.target.kind === "category" ? ctxMenu.target.cat
    : null;
    applyMove(clipboard, targetParentId);
    setClipboard(null);
    setCtxMenu(null);
  }, [ctxMenu, clipboard, applyMove]);

  // ── Export ────────────────────────────────────────────────────────────────────

  const doExport = useCallback(async (format: "csv" | "kml") => {
    if (!ctxMenu) return;
    const { target } = ctxMenu;
    if (target.kind === "folder") return;
    const cat   = target.cat;
    const marca = target.kind === "brand" ? target.marca : undefined;
    setCtxMenu(null);

    const label = marca ?? COMERCIAL_LAYER_META[cat].label;
    const toastId = toast.loading(`Exportando ${label}…`);
    try {
      const pois = await fetchPOIsForExport(cat, marca);
      const date = new Date().toISOString().slice(0, 10);
      const slug = toSlug(marca ?? COMERCIAL_LAYER_META[cat].label);
      const base = `geochile_${toSlug(cat)}${marca ? `_${slug}` : ""}_${date}`;
      if (format === "csv") downloadCSV(pois, `${base}.csv`);
      else                  downloadKML(pois, label, `${base}.kml`);
      toast.success(`${pois.length.toLocaleString()} POIs exportados`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Error al exportar. Intenta de nuevo.", { id: toastId });
    }
  }, [ctxMenu]);

  // ── Drop zone raíz ────────────────────────────────────────────────────────────

  const [rootDragOver, setRootDragOver] = useState(false);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="mt-0.5 border-t border-border/30 pt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
        <Globe className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
        <span className={["flex-1 text-[13px] leading-tight", activeCount > 0 ? "text-foreground" : "text-muted-foreground"].join(" ")}>
          Red Comercial Nacional
        </span>
        {activeCount > 0 && (
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            {activeCount}
          </span>
        )}
        {clipboard && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title="Elemento copiado — haz click derecho sobre un destino y selecciona Pegar">
            ✂
          </span>
        )}
        <span className="font-mono text-[9px] text-text-muted">OSM</span>
      </button>

      {open && (
        <div className="ml-3 mt-0.5 space-y-0">
          <TreeLevel
            parentId={null}
            folders={tree.folders}
            catOverrides={tree.catOverrides}
            dragOverId={dragOverId}
            onCtxMenu={openCtxMenu}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            layers={layers}
            counts={counts}
            hiddenBrands={hiddenBrands}
            onToggle={onToggle}
            onBrandToggle={onBrandToggle}
            onSetHiddenBrands={onSetHiddenBrands}
          />

          {/* Zona de drop para mover a raíz */}
          <div
            onDragOver={(e) => { e.preventDefault(); setRootDragOver(true); }}
            onDragLeave={() => setRootDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setRootDragOver(false); if (dragNode) { applyMove(dragNode, null); setDragNode(null); } }}
            className={["mt-1 rounded-lg border border-dashed px-2 py-1 text-center text-[10px] text-text-muted transition-all", rootDragOver ? "border-blue-400 bg-blue-500/10 text-blue-500" : "border-border/30"].join(" ")}
          >
            Soltar aquí para mover a raíz
          </div>

          <p className="px-2 py-1 text-[10px] text-text-muted">
            Fuente: OpenStreetMap · Click derecho para organizar
          </p>
        </div>
      )}

      {/* Menú contextual */}
      {ctxMenu && (
        <CtxMenu
          ctx={ctxMenu}
          clipboard={clipboard}
          onCreateFolder={doCreateFolder}
          onRename={doRename}
          onDelete={doDelete}
          onCut={doCut}
          onPaste={doPaste}
          onExport={doExport}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
};
