/**
 * ComercialPOISection.tsx — v3
 * ─────────────────────────────
 * Cada categoría tiene chevron para desplegar lista de marcas con toggles individuales.
 * Click derecho sobre una categoría o marca → menú de exportación (CSV / KML).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, Globe, FileDown, Map, X } from "lucide-react";
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

// ── Tipos del menú contextual ─────────────────────────────────────────────────

interface CtxMenuState {
  x: number;
  y: number;
  cat: ComercialCategoria;
  marca?: string;   // undefined = toda la categoría
}

// ── Switch iOS ────────────────────────────────────────────────────────────────

const IOSSwitch = ({ on }: { on: boolean }) => (
  <div className={["relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors", on ? "bg-brand-green" : "bg-surface-3"].join(" ")}>
    <span className={["absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-apple-sm transition-all", on ? "left-[16px]" : "left-[2px]"].join(" ")} />
  </div>
);

// ── Props del componente principal ────────────────────────────────────────────

interface Props {
  layers:             ComercialLayerState;
  counts:             Partial<Record<ComercialCategoria, number>>;
  hiddenBrands:       Partial<Record<ComercialCategoria, Set<string>>>;
  onToggle:           (cat: ComercialCategoria) => void;
  onBrandToggle:      (cat: ComercialCategoria, brand: string) => void;
  onSetHiddenBrands:  (cat: ComercialCategoria, brands: Set<string>) => void;
}

const CATEGORY_ORDER: ComercialCategoria[] = [
  "supermercado", "farmacia", "combustible", "banco",
  "retail_departamental", "mejoramiento_hogar", "restaurante",
  "conveniencia", "centro_comercial",
];

// ── Fila por categoría ────────────────────────────────────────────────────────

interface CategoryRowProps {
  cat:               ComercialCategoria;
  on:                boolean;
  count?:            number;
  hidden:            Set<string>;
  onToggle:          () => void;
  onBrandToggle:     (brand: string) => void;
  onSetHiddenBrands: (brands: Set<string>) => void;
  /** Abre el menú de exportación para esta categoría o una de sus marcas. */
  onCtxMenu:         (e: React.MouseEvent, marca?: string) => void;
}

const CategoryRow = ({
  cat, on, count, hidden, onToggle, onBrandToggle, onSetHiddenBrands, onCtxMenu,
}: CategoryRowProps) => {
  const [brandOpen, setBrandOpen] = useState(false);
  const meta = COMERCIAL_LAYER_META[cat];
  const { marcas, loading } = useComercialMarcas(cat, on && brandOpen);

  const allVisible   = hidden.size === 0;
  const visibleCount = marcas.filter((m) => !hidden.has(m.marca_estandar)).length;
  const someHidden   = hidden.size > 0 && marcas.length > 0 && visibleCount < marcas.length;

  return (
    <div>
      {/* Fila principal — click derecho exporta toda la categoría */}
      <div
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2/60"
        onContextMenu={(e) => onCtxMenu(e)}
      >
        {/* Chevron */}
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

        {/* Nombre (activa/desactiva) */}
        <button type="button" onClick={onToggle} className="flex flex-1 items-center text-left" aria-pressed={on}>
          <span className={["flex-1 text-[13px] leading-tight", on ? "text-foreground" : "text-muted-foreground"].join(" ")}>
            {meta.label}
          </span>
        </button>

        {/* Conteo + badge marcas parciales */}
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

      {/* Lista de marcas */}
      {on && brandOpen && (
        <div className="ml-8 mt-0.5 mb-1 space-y-0.5">
          {loading && <p className="px-2 text-[11px] text-text-muted animate-pulse">Cargando marcas…</p>}
          {!loading && marcas.length === 0 && <p className="px-2 text-[11px] text-text-muted">Sin marcas registradas</p>}

          {!loading && marcas.length > 0 && (
            <>
              {/* Master toggle */}
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

              {/* Marcas con cadena (todo excepto "Otros"), ordenadas por count */}
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

              {/* "Otros" siempre al final, si existe */}
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

// ── Menú contextual de exportación ───────────────────────────────────────────

interface ExportMenuProps {
  ctx: CtxMenuState;
  onExport: (format: "csv" | "kml") => void;
  onClose: () => void;
}

const ExportMenu = ({ ctx, onExport, onClose }: ExportMenuProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const label = ctx.marca ?? COMERCIAL_LAYER_META[ctx.cat].label;

  // Ajustar posición para no salirse del viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 196;
  const menuH = 110;
  const x = Math.min(ctx.x, vw - menuW - 8);
  const y = Math.min(ctx.y, vh - menuH - 8);

  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Cerrar al click fuera
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Pequeño delay para no capturar el mismo click que abrió el menú
    const id = setTimeout(() => window.addEventListener("mousedown", onOutside), 50);
    return () => { clearTimeout(id); window.removeEventListener("mousedown", onOutside); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[196px] rounded-xl border border-border bg-background shadow-xl overflow-hidden"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/50 bg-surface-2/40 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
            {ctx.marca ? "Marca" : "Categoría"}
          </p>
          <p className="text-[13px] font-semibold text-foreground truncate max-w-[148px]">
            {label}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
          title="Cerrar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Opciones */}
      <button
        type="button"
        onClick={() => onExport("csv")}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-[13px] text-foreground hover:bg-surface-2/60 transition-colors"
      >
        <FileDown className="h-4 w-4 text-green-600 flex-shrink-0" />
        <span>Exportar CSV</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Excel</span>
      </button>

      <button
        type="button"
        onClick={() => onExport("kml")}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-[13px] text-foreground hover:bg-surface-2/60 transition-colors"
      >
        <Map className="h-4 w-4 text-blue-500 flex-shrink-0" />
        <span>Exportar KML</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Google Earth</span>
      </button>
    </div>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────

export const ComercialPOISection = ({ layers, counts, hiddenBrands, onToggle, onBrandToggle, onSetHiddenBrands }: Props) => {
  const [open, setOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const activeCount = CATEGORY_ORDER.filter((c) => layers[c]).length;

  // Abrir menú contextual
  const openCtxMenu = useCallback((e: React.MouseEvent, cat: ComercialCategoria, marca?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, cat, marca });
  }, []);

  // Ejecutar exportación
  const doExport = useCallback(async (format: "csv" | "kml") => {
    if (!ctxMenu) return;
    const { cat, marca } = ctxMenu;
    setCtxMenu(null);

    const label = marca ?? COMERCIAL_LAYER_META[cat].label;
    const toastId = toast.loading(`Exportando ${label}…`);

    try {
      const pois = await fetchPOIsForExport(cat, marca);
      const date = new Date().toISOString().slice(0, 10);
      const slug = toSlug(marca ?? COMERCIAL_LAYER_META[cat].label);
      const base = `geochile_${toSlug(cat)}${marca ? `_${slug}` : ""}_${date}`;

      if (format === "csv") {
        downloadCSV(pois, `${base}.csv`);
      } else {
        downloadKML(pois, label, `${base}.kml`);
      }

      toast.success(`${pois.length.toLocaleString()} POIs exportados`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Error al exportar. Intenta de nuevo.", { id: toastId });
    }
  }, [ctxMenu]);

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
        <span className="font-mono text-[9px] text-text-muted">OSM</span>
      </button>

      {open && (
        <div className="ml-3 mt-0.5 space-y-0">
          {CATEGORY_ORDER.map((cat) => (
            <CategoryRow
              key={cat}
              cat={cat}
              on={layers[cat]}
              count={counts[cat]}
              hidden={hiddenBrands[cat] ?? new Set()}
              onToggle={() => onToggle(cat)}
              onBrandToggle={(brand) => onBrandToggle(cat, brand)}
              onSetHiddenBrands={(brands) => onSetHiddenBrands(cat, brands)}
              onCtxMenu={(e, marca) => openCtxMenu(e, cat, marca)}
            />
          ))}
          <p className="px-2 py-1 text-[10px] text-text-muted">
            Fuente: OpenStreetMap · Actualización semanal automática
          </p>
        </div>
      )}

      {/* Menú contextual de exportación */}
      {ctxMenu && (
        <ExportMenu
          ctx={ctxMenu}
          onExport={doExport}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
};
