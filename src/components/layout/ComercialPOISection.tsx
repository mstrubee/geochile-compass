/**
 * ComercialPOISection.tsx — v4
 * ─────────────────────────────
 * Árbol recursivo de carpetas + categorías comerciales.
 * - Click derecho → menú contextual (crear carpeta, cortar, pegar, renombrar, eliminar, exportar)
 * - Drag & drop para mover carpetas/categorías
 * - Estado persistido en localStorage (geochile_comercial_tree_v1)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ChevronDown, ChevronRight, Globe, FileDown, Map as MapIcon, X,
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
  type Carpeta,
  type CatOverride,
  type BrandOverride,
} from "@/hooks/useComercialFolders";

// ── Orden por defecto de categorías ──────────────────────────────────────────

export const CATEGORY_ORDER: ComercialCategoria[] = [
  "supermercado", "farmacia", "combustible", "banco",
  "retail_departamental", "ferreteria", "restaurante",
  "automotriz", "bodega",
];

// ── Saneamiento defensivo ──────────────────────────────────────────────────────
// Garantiza que TODA categoría y carpeta sea visible: reparenta a la raíz cualquier
// nodo cuyo padre no exista o forme un ciclo. Protege contra estados persistidos
// corruptos (p.ej. carpetas/overrides que quedaron apuntando a padres inexistentes).
function sanitizeTree(
  folders: Carpeta[],
  catOverrides: CatOverride[],
  brandOverrides: BrandOverride[],
): { folders: Carpeta[]; catOverrides: CatOverride[]; brandOverrides: BrandOverride[] } {
  const isCat = (id: string | null): boolean =>
    id !== null && (CATEGORY_ORDER as string[]).includes(id);
  // Posición (parentId) de cada categoría según su override
  const catParent = new Map(catOverrides.map((o) => [o.cat as string, o.parentId]));

  // ¿La cadena de padres termina en la raíz (null), siguiendo el grafo COMPLETO
  // (padres de carpetas Y overrides de categorías)? Detecta ciclos carpeta↔categoría
  // y referencias a carpetas inexistentes.
  const reachesRoot = (
    startParent: string | null,
    getFolderParent: (id: string) => string | null | undefined,
  ): boolean => {
    let cur = startParent;
    const seen = new Set<string>();
    while (cur !== null) {
      if (seen.has(cur)) return false;                 // ciclo
      seen.add(cur);
      if (isCat(cur)) {
        cur = catParent.get(cur) ?? null;              // seguir la posición de la categoría
      } else {
        const p = getFolderParent(cur);
        if (p === undefined) return false;             // carpeta inexistente
        cur = p;
      }
    }
    return true;
  };

  // Pass 1 — carpetas: usa los padres crudos. Reparenta a la raíz las que ciclan/cuelgan.
  const rawFolderById = new Map(folders.map((f) => [f.id, f]));
  const rawFolderParent = (id: string) => (rawFolderById.has(id) ? rawFolderById.get(id)!.parentId : undefined);
  const safeFolders = folders.map((f) =>
    reachesRoot(f.parentId, rawFolderParent) ? f : { ...f, parentId: null },
  );
  const safeFolderById = new Map(safeFolders.map((f) => [f.id, f]));
  const safeFolderParent = (id: string) => (safeFolderById.has(id) ? safeFolderById.get(id)!.parentId : undefined);
  const validFolderIds = new Set(safeFolders.map((f) => f.id));

  // Pass 2 — overrides de categoría: destino válido (categoría o carpeta real) y que alcance la raíz.
  // El resto vuelve a la raíz por defecto (la categoría NUNCA desaparece).
  const safeOverrides = catOverrides.filter(
    (o) =>
      o.parentId !== null &&
      (isCat(o.parentId) || validFolderIds.has(o.parentId)) &&
      reachesRoot(o.parentId, safeFolderParent),
  );

  // Pass 3 — marcas: null (raíz), categoría o carpeta existente, y que alcance la raíz.
  const safeBrandOverrides = brandOverrides.filter(
    (o) =>
      o.parentId === null ||
      ((isCat(o.parentId) || validFolderIds.has(o.parentId)) && reachesRoot(o.parentId, safeFolderParent)),
  );

  return { folders: safeFolders, catOverrides: safeOverrides, brandOverrides: safeBrandOverrides };
}

// ¿La carpeta `folderId` está (transitivamente) dentro de la categoría `cat`?
// Se usa para impedir mover una categoría dentro de una de sus propias subcarpetas (ciclo).
function isFolderUnderCategory(folderId: string, cat: ComercialCategoria, folders: Carpeta[]): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur: string | null = folderId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === cat) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    const f = byId.get(cur);
    if (!f) return false;
    cur = f.parentId;
  }
  return false;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CtxTarget =
  | { kind: "category"; cat: ComercialCategoria }
  | { kind: "folder"; id: string; nombre: string; parentId: string | null }
  | { kind: "brand"; cat: ComercialCategoria; marca: string };

interface CtxMenuState { x: number; y: number; target: CtxTarget }

export type ClipNode =
  | { kind: "category"; cat: ComercialCategoria }
  | { kind: "folder"; id: string }
  | { kind: "brand"; cat: ComercialCategoria; marca: string };

interface Props {
  layers:             ComercialLayerState;
  counts:             Partial<Record<ComercialCategoria, number>>;
  hiddenBrands:       Partial<Record<ComercialCategoria, Set<string>>>;
  onToggle:           (cat: ComercialCategoria) => void;
  onBrandToggle:      (cat: ComercialCategoria, brand: string) => void;
  onSetHiddenBrands:  (cat: ComercialCategoria, brands: Set<string>) => void;
  /** Notifica al padre qué marcas fueron reubicadas en carpetas (para el render del mapa) */
  onManagedBrandsChange?: (managed: Partial<Record<ComercialCategoria, Set<string>>>) => void;
}

// ── Switch iOS ────────────────────────────────────────────────────────────────
// `partial` = estado intermedio (algunos descendientes activos): knob al centro, ámbar.

const IOSSwitch = ({ on, partial = false }: { on: boolean; partial?: boolean }) => (
  <div className={["relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors", on ? "bg-brand-green" : partial ? "bg-amber-400/70" : "bg-surface-3"].join(" ")}>
    <span className={["absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-apple-sm transition-all", on ? "left-[16px]" : partial ? "left-[9px]" : "left-[2px]"].join(" ")} />
  </div>
);

// ── Activación jerárquica ───────────────────────────────────────────────────────
// Hojas activables bajo un nodo (carpeta o categoría-contenedor): categorías (capas)
// y marcas reubicadas. Recorre el subárbol siguiendo ids de carpeta y nombres de categoría.

interface LeafSet { cats: ComercialCategoria[]; brands: { cat: ComercialCategoria; marca: string }[] }

function descendantLeaves(
  rootId: string,
  folders: Carpeta[],
  catOverrides: CatOverride[],
  brandOverrides: BrandOverride[],
): LeafSet {
  const cats = new Set<ComercialCategoria>();
  const brands: { cat: ComercialCategoria; marca: string }[] = [];
  const seen = new Set<string>();
  const queue: string[] = [rootId];
  while (queue.length) {
    const x = queue.shift()!;
    if (seen.has(x)) continue;
    seen.add(x);
    folders.filter((f) => f.parentId === x).forEach((f) => queue.push(f.id));
    catOverrides.filter((o) => o.parentId === x).forEach((o) => { cats.add(o.cat); queue.push(o.cat); });
    brandOverrides.filter((b) => (b.parentId ?? null) === x).forEach((b) => brands.push({ cat: b.cat, marca: b.marca }));
  }
  return { cats: Array.from(cats), brands };
}

type Activation = "on" | "off" | "partial" | "empty";

function folderActivation(
  leaves: LeafSet,
  layers: ComercialLayerState,
  hiddenBrands: Partial<Record<ComercialCategoria, Set<string>>>,
): Activation {
  const states = [
    ...leaves.cats.map((c) => layers[c]),
    ...leaves.brands.map((b) => !(hiddenBrands[b.cat]?.has(b.marca))),
  ];
  if (states.length === 0) return "empty";
  const onCount = states.filter(Boolean).length;
  if (onCount === 0) return "off";
  if (onCount === states.length) return "on";
  return "partial";
}

// ── FolderRow ────────────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: Carpeta;
  isDragOver: boolean;
  onCtxMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  activation?: Activation;
  onActivationToggle?: () => void;
  children?: React.ReactNode;
}

const FolderRow = ({
  folder, isDragOver, onCtxMenu,
  onDragStart, onDragOver, onDragLeave, onDrop,
  activation = "empty", onActivationToggle,
  children,
}: FolderRowProps) => {
  const [open, setOpen] = useState(true);
  const active = activation === "on" || activation === "partial";

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
          ? <FolderOpen className={["h-3.5 w-3.5 flex-shrink-0", active ? "text-amber-400" : "text-amber-400/50"].join(" ")} />
          : <FolderIcon  className={["h-3.5 w-3.5 flex-shrink-0", active ? "text-amber-400" : "text-amber-400/50"].join(" ")} />}
        <span className={["flex-1 text-[13px] leading-tight truncate", active ? "text-foreground" : "text-muted-foreground"].join(" ")}>{folder.nombre}</span>
        {activation !== "empty" && onActivationToggle && (
          <button
            type="button"
            className="flex-shrink-0 ml-0.5"
            onClick={(e) => { e.stopPropagation(); onActivationToggle(); }}
            title="Activar/desactivar todo el contenido de la carpeta"
          >
            <IOSSwitch on={activation === "on"} partial={activation === "partial"} />
          </button>
        )}
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
  onBrandDragStart?: (e: React.DragEvent, marca: string) => void;
  /** Apaga/enciende la capa (raw, sin cascada). Para el auto-apagado al desactivar el último trigger. */
  onRawToggle?:      (active: boolean) => void;
  movedBrands?:      Set<string>;
  children?:         React.ReactNode;
}

const CategoryRow = ({
  cat, on, count, hidden, isDragOver,
  onToggle, onBrandToggle, onSetHiddenBrands,
  onCtxMenu, onDragStart, onDragOver, onDragLeave, onDrop,
  onBrandDragStart, onRawToggle, movedBrands, children,
}: CategoryRowProps) => {
  const [brandOpen, setBrandOpen] = useState(false);
  const meta = COMERCIAL_LAYER_META[cat];
  const { marcas: allMarcas, loading } = useComercialMarcas(cat, on && brandOpen);

  // Excluye del listado las marcas reubicadas en carpetas (se muestran allí)
  const marcas = movedBrands && movedBrands.size > 0
    ? allMarcas.filter((m) => !movedBrands.has(m.marca_estandar))
    : allMarcas;

  const allVisible   = hidden.size === 0;
  const visibleCount = marcas.filter((m) => !hidden.has(m.marca_estandar)).length;
  const someHidden   = hidden.size > 0 && marcas.length > 0 && visibleCount < marcas.length;

  // Aplica un nuevo set de marcas ocultas y, si NO queda ningún trigger activo
  // (todas las marcas del listado ocultas), apaga la capa automáticamente.
  const applyHidden = (next: Set<string>) => {
    onSetHiddenBrands(next);
    const activeListCount = marcas.filter((m) => !next.has(m.marca_estandar)).length;
    if (on && activeListCount === 0) onRawToggle?.(false); // último trigger desactivado → capa off
  };
  const toggleBrand = (marca: string) => {
    const next = new Set(hidden);
    if (next.has(marca)) next.delete(marca); else next.add(marca);
    applyHidden(next);
  };

  // Estado parcial: categoría apagada pero con alguna marca reubicada activa (jerarquía)
  const hasActiveManaged = !!movedBrands && [...movedBrands].some((m) => !hidden.has(m));
  const active = on || hasActiveManaged;

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
          <span className={["flex-1 text-[13px] leading-tight", active ? "text-foreground" : "text-muted-foreground"].join(" ")}>
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
          <IOSSwitch on={on} partial={!on && hasActiveManaged} />
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
                onClick={() => applyHidden(allVisible ? new Set(marcas.map((m) => m.marca_estandar)) : new Set())}
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
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); onBrandDragStart?.(e, m.marca_estandar); }}
                    onClick={() => toggleBrand(m.marca_estandar)}
                    onContextMenu={(e) => onCtxMenu(e, m.marca_estandar)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-all hover:bg-surface-2/60"
                    aria-pressed={brandOn}
                    title={noPOIs ? "Sin locales sincronizados aún. Ejecuta una sincronización OSM." : "Arrastra a una carpeta o usa click derecho → Cortar"}
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
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); onBrandDragStart?.(e, "Otros"); }}
                      onClick={() => toggleBrand("Otros")}
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

      {/* Subcarpetas anidadas bajo esta categoría (siempre visibles, sin depender del toggle) */}
      {children && <div className="ml-5 mt-0.5 space-y-0">{children}</div>}
    </div>
  );
};

// ── BrandLeafRow ───────────────────────────────────────────────────────────────
// Una marca reubicada en una carpeta. Toggle = visibilidad en el mapa (independiente
// del estado on/off de su categoría: se muestra mientras esté activada aquí).

interface BrandLeafRowProps {
  cat:         ComercialCategoria;
  marca:       string;
  on:          boolean;
  isDragOver:  boolean;
  onToggle:    () => void;
  onCtxMenu:   (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver:  (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop:      (e: React.DragEvent) => void;
}

const BrandLeafRow = ({
  cat, marca, on, isDragOver,
  onToggle, onCtxMenu, onDragStart, onDragOver, onDragLeave, onDrop,
}: BrandLeafRowProps) => {
  const meta = COMERCIAL_LAYER_META[cat];
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
      <div className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-surface-2/60">
        <span className="w-3 flex-shrink-0" />
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: meta.color, opacity: on ? 1 : 0.25 }} />
        <span className="flex-shrink-0 text-[12px] leading-none">{meta.icon}</span>
        <button type="button" onClick={onToggle} className="flex flex-1 items-center text-left" aria-pressed={on}>
          <span className={["flex-1 text-[12px] leading-tight truncate", on ? "text-foreground" : "text-muted-foreground"].join(" ")}>
            {marca}
          </span>
        </button>
        <button type="button" onClick={onToggle} className="flex-shrink-0">
          <IOSSwitch on={on} />
        </button>
      </div>
    </div>
  );
};

// ── Context Menu sub-components (nivel módulo para evitar remounts en re-renders) ──

type CtxMode = "default" | "create" | "rename" | "delete";

const CtxRow = ({
  icon, label, onClick, danger = false,
}: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      "flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-surface-2/60",
      danger ? "text-red-500 dark:text-red-400" : "text-foreground",
    ].join(" ")}
  >
    <span className="flex-shrink-0 h-4 w-4">{icon}</span>
    <span>{label}</span>
  </button>
);

const CtxInputPanel = ({
  title, placeholder, value, onChange, onConfirm, onCancel, inputRef,
}: {
  title: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) => (
  <div className="px-3 py-2.5 space-y-2">
    <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); if (e.key === "Escape") onCancel(); }}
      placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-surface-2/60 px-2 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-blue-400/60"
    />
    <div className="flex gap-1.5">
      <button type="button" onClick={onConfirm} className="flex-1 rounded-lg bg-blue-500 py-1 text-[12px] font-medium text-white hover:bg-blue-600 transition-colors">
        Aceptar
      </button>
      <button type="button" onClick={onCancel} className="flex-1 rounded-lg bg-surface-2/80 py-1 text-[12px] text-muted-foreground hover:bg-surface-2 transition-colors">
        Cancelar
      </button>
    </div>
  </div>
);

const CtxDeletePanel = ({
  targetName, onDelete, onCancel,
}: { targetName: string; onDelete: () => void; onCancel: () => void }) => (
  <div className="px-3 py-2.5 space-y-2">
    <p className="text-[12px] text-foreground">
      ¿Eliminar <span className="font-semibold">"{targetName}"</span>?
    </p>
    <p className="text-[11px] text-muted-foreground">Las subcarpetas y categorías internas subirán al nivel padre.</p>
    <div className="flex gap-1.5">
      <button type="button" onClick={onDelete} className="flex-1 rounded-lg bg-red-500 py-1 text-[12px] font-medium text-white hover:bg-red-600 transition-colors">
        Eliminar
      </button>
      <button type="button" onClick={onCancel} className="flex-1 rounded-lg bg-surface-2/80 py-1 text-[12px] text-muted-foreground hover:bg-surface-2 transition-colors">
        Cancelar
      </button>
    </div>
  </div>
);

// ── Context Menu ──────────────────────────────────────────────────────────────

interface CtxMenuProps {
  ctx: CtxMenuState;
  clipboard: ClipNode | null;
  onCreateFolder: (nombre: string) => void;
  onRename: (nombre: string) => void;
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
  const ref      = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode]         = useState<CtxMode>("default");
  const [inputVal, setInputVal] = useState("");

  const { target } = ctx;
  // Narrowing explícito por kind para evitar accesos ambiguos al tipo union
  const folderTarget   = target.kind === "folder"   ? target : null;
  const categoryTarget = target.kind === "category" ? target : null;
  const brandTarget    = target.kind === "brand"    ? target : null;

  const label = target.kind === "folder"   ? target.nombre
              : target.kind === "category" ? COMERCIAL_LAYER_META[target.cat].label
              : target.marca;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 220;
  const x = Math.min(ctx.x, vw - menuW - 8);
  const y = Math.min(ctx.y, vh - 240);

  useEffect(() => {
    if (mode === "create" || mode === "rename") {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const id = setTimeout(() => window.addEventListener("mousedown", handler), 50);
    return () => { clearTimeout(id); window.removeEventListener("mousedown", handler); };
  }, [onClose]);

  const enterCreate = () => { setInputVal(""); setMode("create"); };
  const enterRename = () => { setInputVal(folderTarget?.nombre ?? ""); setMode("rename"); };

  const confirmCreate = () => {
    const n = inputVal.trim();
    if (n) onCreateFolder(n);
    else onClose();
  };
  const confirmRename = () => {
    const n = inputVal.trim();
    if (n) onRename(n);
    else onClose();
  };

  return (
    <div
      ref={ref}
      className="fixed z-[9999] w-[220px] rounded-xl border border-border bg-background shadow-xl overflow-hidden"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/50 bg-surface-2/40 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
            {folderTarget ? "Carpeta" : categoryTarget ? "Categoría" : "Marca"}
          </p>
          <p className="text-[13px] font-semibold text-foreground truncate max-w-[158px]">{label}</p>
        </div>
        <button type="button" onClick={onClose} className="flex-shrink-0 mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Modos inline */}
      {mode === "create" && (
        <CtxInputPanel
          title="Nombre de la nueva carpeta"
          placeholder="Ej: Zona Norte"
          value={inputVal}
          onChange={setInputVal}
          onConfirm={confirmCreate}
          onCancel={() => setMode("default")}
          inputRef={inputRef}
        />
      )}
      {mode === "rename" && (
        <CtxInputPanel
          title="Nuevo nombre"
          placeholder={folderTarget?.nombre ?? ""}
          value={inputVal}
          onChange={setInputVal}
          onConfirm={confirmRename}
          onCancel={() => setMode("default")}
          inputRef={inputRef}
        />
      )}
      {mode === "delete" && folderTarget && (
        <CtxDeletePanel
          targetName={folderTarget.nombre}
          onDelete={onDelete}
          onCancel={() => setMode("default")}
        />
      )}

      {/* Menú principal */}
      {mode === "default" && (
        <>
          {!brandTarget && (
            <>
              <CtxRow icon={<FolderPlus className="h-4 w-4 text-amber-500" />} label="Crear subcarpeta" onClick={enterCreate} />
              {folderTarget && <CtxRow icon={<Pencil className="h-4 w-4 text-blue-500" />} label="Renombrar" onClick={enterRename} />}
              <CtxRow icon={<Scissors className="h-4 w-4 text-muted-foreground" />} label="Cortar" onClick={onCut} />
              {clipboard && <CtxRow icon={<ClipboardPaste className="h-4 w-4 text-green-500" />} label="Pegar aquí" onClick={onPaste} />}
              {folderTarget && <CtxRow icon={<Trash2 className="h-4 w-4" />} label="Eliminar carpeta" onClick={() => setMode("delete")} danger />}
              <div className="border-t border-border/30 my-0.5" />
            </>
          )}
          {brandTarget && (
            <>
              <CtxRow icon={<Scissors className="h-4 w-4 text-muted-foreground" />} label="Cortar marca" onClick={onCut} />
              <div className="border-t border-border/30 my-0.5" />
            </>
          )}
          {!folderTarget && (
            <>
              <CtxRow icon={<FileDown className="h-4 w-4 text-green-600" />} label="Exportar CSV" onClick={() => onExport("csv")} />
              <CtxRow icon={<MapIcon className="h-4 w-4 text-blue-500" />} label="Exportar KML" onClick={() => onExport("kml")} />
            </>
          )}
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
  brandOverrides: BrandOverride[];
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
  // activación jerárquica
  onFolderActivationToggle:   (folderId: string) => void;
  onCategoryActivationToggle: (cat: ComercialCategoria) => void;
}

const brandKey = (cat: ComercialCategoria, marca: string) => `brand:${cat}::${marca}`;

const TreeLevel = ({
  parentId, folders, catOverrides, brandOverrides, dragOverId,
  onCtxMenu, onDragStart, onDragOver, onDragLeave, onDrop,
  layers, counts, hiddenBrands, onToggle, onBrandToggle, onSetHiddenBrands,
  onFolderActivationToggle, onCategoryActivationToggle,
}: TreeLevelProps) => {
  const foldersHere = folders.filter((f) => f.parentId === parentId);
  const catsHere = CATEGORY_ORDER.filter((cat) => {
    const override = catOverrides.find((o) => o.cat === cat);
    return (override?.parentId ?? null) === parentId;
  });
  const brandsHere = brandOverrides.filter((b) => (b.parentId ?? null) === parentId);

  if (foldersHere.length === 0 && catsHere.length === 0 && brandsHere.length === 0) return null;

  const commonProps = { folders, catOverrides, brandOverrides, dragOverId, onCtxMenu, onDragStart, onDragOver, onDragLeave, onDrop, layers, counts, hiddenBrands, onToggle, onBrandToggle, onSetHiddenBrands, onFolderActivationToggle, onCategoryActivationToggle };

  return (
    <>
      {foldersHere.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          isDragOver={dragOverId === folder.id}
          activation={folderActivation(descendantLeaves(folder.id, folders, catOverrides, brandOverrides), layers, hiddenBrands)}
          onActivationToggle={() => onFolderActivationToggle(folder.id)}
          onCtxMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCtxMenu(e, { kind: "folder", id: folder.id, nombre: folder.nombre, parentId: folder.parentId }); }}
          onDragStart={(e) => { e.stopPropagation(); onDragStart(e, { kind: "folder", id: folder.id }); }}
          onDragOver={(e) => { e.stopPropagation(); onDragOver(e, folder.id); }}
          onDragLeave={(e) => { e.stopPropagation(); onDragLeave(e); }}
          onDrop={(e) => { e.stopPropagation(); onDrop(e, folder.id); }}
        >
          <TreeLevel parentId={folder.id} {...commonProps} />
        </FolderRow>
      ))}

      {catsHere.map((cat) => {
        const movedBrands = new Set(brandOverrides.filter((b) => b.cat === cat).map((b) => b.marca));
        return (
          <CategoryRow
            key={cat}
            cat={cat}
            on={layers[cat]}
            count={counts[cat]}
            hidden={hiddenBrands[cat] ?? new Set()}
            isDragOver={dragOverId === cat}
            movedBrands={movedBrands}
            onToggle={() => onCategoryActivationToggle(cat)}
            onRawToggle={(active) => { if (layers[cat] !== active) onToggle(cat); }}
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
            onBrandDragStart={(e, marca) => onDragStart(e, { kind: "brand", cat, marca })}
          >
            {/* Carpetas hijas de esta categoría (TreeLevel devuelve null si no hay ninguna) */}
            <TreeLevel parentId={cat} {...commonProps} />
          </CategoryRow>
        );
      })}

      {brandsHere.map((b) => (
        <BrandLeafRow
          key={brandKey(b.cat, b.marca)}
          cat={b.cat}
          marca={b.marca}
          on={!(hiddenBrands[b.cat]?.has(b.marca))}
          isDragOver={dragOverId === brandKey(b.cat, b.marca)}
          onToggle={() => onBrandToggle(b.cat, b.marca)}
          onCtxMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCtxMenu(e, { kind: "brand", cat: b.cat, marca: b.marca }); }}
          onDragStart={(e) => { e.stopPropagation(); onDragStart(e, { kind: "brand", cat: b.cat, marca: b.marca }); }}
          onDragOver={(e) => { e.stopPropagation(); onDragOver(e, brandKey(b.cat, b.marca)); }}
          onDragLeave={(e) => { e.stopPropagation(); onDragLeave(e); }}
          onDrop={(e) => { e.stopPropagation(); onDrop(e, parentId); }}
        />
      ))}
    </>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────

export const ComercialPOISection = ({
  layers, counts, hiddenBrands, onToggle, onBrandToggle, onSetHiddenBrands,
  onManagedBrandsChange,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [ctxMenu, setCtxMenu]     = useState<CtxMenuState | null>(null);
  const [clipboard, setClipboard] = useState<ClipNode | null>(null);
  const [dragNode, setDragNode]   = useState<ClipNode | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const { tree, createFolder, renameFolder, deleteFolder, moveFolderTo, moveCatTo, moveBrandTo } = useComercialFolders();
  const activeCount = CATEGORY_ORDER.filter((c) => layers[c]).length;

  // Vista saneada: blinda el render contra estados corruptos (categorías nunca desaparecen)
  const safe = useMemo(() => sanitizeTree(tree.folders, tree.catOverrides, tree.brandOverrides), [tree]);
  

  // Marcas reubicadas en carpetas, agrupadas por categoría → se notifica al mapa
  const managedBrands = useMemo(() => {
    const m: Partial<Record<ComercialCategoria, Set<string>>> = {};
    for (const o of safe.brandOverrides) {
      (m[o.cat] ??= new Set<string>()).add(o.marca);
    }
    return m;
  }, [safe.brandOverrides]);

  useEffect(() => {
    onManagedBrandsChange?.(managedBrands);
  }, [managedBrands, onManagedBrandsChange]);

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
      moveFolderTo(node.id, newParentId);
    } else if (node.kind === "category") {
      // Evita el ciclo categoría→subcarpeta→categoría (que la haría desaparecer)
      if (newParentId && isFolderUnderCategory(newParentId, node.cat, tree.folders)) {
        toast.error("No puedes mover una categoría dentro de una de sus propias carpetas");
        return;
      }
      moveCatTo(node.cat, newParentId);
    } else {
      moveBrandTo(node.cat, node.marca, newParentId);
    }
  }, [moveFolderTo, moveCatTo, moveBrandTo, tree.folders]);

  // ── Activación jerárquica ───────────────────────────────────────────────────────

  // Aplica un estado on/off a un conjunto de hojas (categorías + marcas reubicadas)
  const setLeavesActive = useCallback((leaves: LeafSet, target: boolean) => {
    // Categorías (capas): encender/apagar layers[cat]
    leaves.cats.forEach((c) => { if (layers[c] !== target) onToggle(c); });
    // Marcas reubicadas: mostrar/ocultar (agrupadas por categoría para un solo setState)
    const byCat = new Map<ComercialCategoria, Set<string>>();
    leaves.brands.forEach((b) => { if (!byCat.has(b.cat)) byCat.set(b.cat, new Set(hiddenBrands[b.cat] ?? [])); });
    leaves.brands.forEach((b) => { const s = byCat.get(b.cat)!; if (target) s.delete(b.marca); else s.add(b.marca); });
    byCat.forEach((s, c) => onSetHiddenBrands(c, s));
  }, [layers, hiddenBrands, onToggle, onSetHiddenBrands]);

  // Carpeta: activar/desactivar TODO su contenido (subcarpetas, categorías y marcas)
  const handleFolderActivationToggle = useCallback((folderId: string) => {
    const leaves = descendantLeaves(folderId, safe.folders, safe.catOverrides, safe.brandOverrides);
    const state = folderActivation(leaves, layers, hiddenBrands);
    setLeavesActive(leaves, state !== "on"); // si está todo encendido → apagar; si no → encender todo
  }, [safe, layers, hiddenBrands, setLeavesActive]);

  // Categoría: activar/desactivar la capa.
  // Activar = capa on + mostrar TODAS sus marcas (limpia ocultas → "contenedor" muestra su contenido).
  // Desactivar = capa off + ocultar sus marcas reubicadas (las del listado dependen de la capa).
  const handleCategoryActivationToggle = useCallback((cat: ComercialCategoria) => {
    const moved = managedBrands[cat] ?? new Set<string>();
    const anyActive = layers[cat] || [...moved].some((m) => !(hiddenBrands[cat]?.has(m)));
    const target = !anyActive;
    if (layers[cat] !== target) onToggle(cat);
    if (target) {
      // mostrar todo: sin marcas ocultas
      if ((hiddenBrands[cat]?.size ?? 0) > 0) onSetHiddenBrands(cat, new Set());
    } else if (moved.size > 0) {
      // ocultar las marcas reubicadas (que se mostraban de forma independiente)
      const h = new Set(hiddenBrands[cat] ?? []);
      moved.forEach((m) => h.add(m));
      onSetHiddenBrands(cat, h);
    }
  }, [managedBrands, layers, hiddenBrands, onToggle, onSetHiddenBrands]);

  // ── Context menu ──────────────────────────────────────────────────────────────

  const openCtxMenu = useCallback((e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const doCreateFolder = useCallback((nombre: string) => {
    if (!ctxMenu) return;
    const parentId = ctxMenu.target.kind === "folder"   ? ctxMenu.target.id
                   : ctxMenu.target.kind === "category" ? ctxMenu.target.cat
                   : null;
    createFolder(nombre, parentId);
    setCtxMenu(null);
  }, [ctxMenu, createFolder]);

  const doRename = useCallback((nombre: string) => {
    if (!ctxMenu || ctxMenu.target.kind !== "folder") return;
    renameFolder(ctxMenu.target.id, nombre);
    setCtxMenu(null);
  }, [ctxMenu, renameFolder]);

  const doDelete = useCallback(() => {
    if (!ctxMenu || ctxMenu.target.kind !== "folder") return;
    deleteFolder(ctxMenu.target.id, ctxMenu.target.parentId);
    setCtxMenu(null);
  }, [ctxMenu, deleteFolder]);

  const doCut = useCallback(() => {
    if (!ctxMenu) return;
    const node: ClipNode | null =
      ctxMenu.target.kind === "folder"   ? { kind: "folder",   id: ctxMenu.target.id }
    : ctxMenu.target.kind === "category" ? { kind: "category", cat: ctxMenu.target.cat }
    : ctxMenu.target.kind === "brand"    ? { kind: "brand", cat: ctxMenu.target.cat, marca: ctxMenu.target.marca }
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
            folders={safe.folders}
            catOverrides={safe.catOverrides}
            brandOverrides={safe.brandOverrides}
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
            onFolderActivationToggle={handleFolderActivationToggle}
            onCategoryActivationToggle={handleCategoryActivationToggle}
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

          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <p className="text-[10px] text-text-muted">
              Fuente: OpenStreetMap · Click derecho para organizar
            </p>
          </div>

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
