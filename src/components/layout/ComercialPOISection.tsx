/**
 * ComercialPOISection.tsx — v2
 * ─────────────────────────────
 * Cada categoría tiene chevron para desplegar lista de marcas con toggles individuales.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Globe } from "lucide-react";
import type { ComercialCategoria, ComercialLayerState } from "@/types/comercial";
import { COMERCIAL_LAYER_META } from "@/types/comercial";
import { useComercialMarcas } from "@/hooks/useComercialPOI";

const IOSSwitch = ({ on }: { on: boolean }) => (
  <div className={["relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors", on ? "bg-brand-green" : "bg-surface-3"].join(" ")}>
    <span className={["absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-apple-sm transition-all", on ? "left-[16px]" : "left-[2px]"].join(" ")} />
  </div>
);

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
}

const CategoryRow = ({ cat, on, count, hidden, onToggle, onBrandToggle, onSetHiddenBrands }: CategoryRowProps) => {
  const [brandOpen, setBrandOpen] = useState(false);
  const meta = COMERCIAL_LAYER_META[cat];
  const { marcas, loading } = useComercialMarcas(cat, on && brandOpen);

  const allVisible   = hidden.size === 0;
  const visibleCount = marcas.filter((m) => !hidden.has(m.marca_estandar)).length;
  const someHidden   = hidden.size > 0 && marcas.length > 0 && visibleCount < marcas.length;

  return (
    <div>
      {/* Fila principal */}
      <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2/60">
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
                return (
                  <button
                    key={m.marca_estandar}
                    type="button"
                    onClick={() => onBrandToggle(m.marca_estandar)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-all hover:bg-surface-2/60"
                    aria-pressed={brandOn}
                  >
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: meta.color, opacity: brandOn ? 1 : 0.25 }} />
                    <span className={["flex-1 text-[12px] leading-tight truncate text-left", brandOn ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                      {m.marca_estandar}
                    </span>
                    <span className="font-mono text-[10px] text-text-muted flex-shrink-0">{m.n.toLocaleString()}</span>
                    <IOSSwitch on={brandOn} />
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

// ── Componente principal ──────────────────────────────────────────────────────

export const ComercialPOISection = ({ layers, counts, hiddenBrands, onToggle, onBrandToggle, onSetHiddenBrands }: Props) => {
  const [open, setOpen] = useState(false);
  const activeCount = CATEGORY_ORDER.filter((c) => layers[c]).length;

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
            />
          ))}
          <p className="px-2 py-1 text-[10px] text-text-muted">
            Fuente: OpenStreetMap · Actualización semanal automática
          </p>
        </div>
      )}
    </div>
  );
};
