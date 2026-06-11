/**
 * ComercialPOISection.tsx
 * ─────────────────────────
 * Sección colapsable en el Sidebar para activar/desactivar capas
 * de la Red Comercial Nacional (POIs OSM).
 *
 * Renderiza un bloque por categoría con:
 *  • Toggle on/off
 *  • Conteo de registros cargados
 *  • Chip de estado (cargando / total)
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Globe } from "lucide-react";
import type { ComercialCategoria, ComercialLayerState } from "@/types/comercial";
import { COMERCIAL_LAYER_META } from "@/types/comercial";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

const IOSSwitch = ({ on }: { on: boolean }) => (
  <div
    className={[
      "relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors",
      on ? "bg-brand-green" : "bg-surface-3",
    ].join(" ")}
  >
    <span
      className={[
        "absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-apple-sm transition-all",
        on ? "left-[16px]" : "left-[2px]",
      ].join(" ")}
    />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  layers:        ComercialLayerState;
  counts:        Partial<Record<ComercialCategoria, number>>;
  onToggle:      (cat: ComercialCategoria) => void;
}

// Orden de presentación
const CATEGORY_ORDER: ComercialCategoria[] = [
  "supermercado",
  "farmacia",
  "combustible",
  "banco",
  "retail_departamental",
  "mejoramiento_hogar",
  "restaurante",
  "conveniencia",
  "centro_comercial",
];

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export const ComercialPOISection = ({ layers, counts, onToggle }: Props) => {
  const [open, setOpen] = useState(false);

  const activeCount = CATEGORY_ORDER.filter((c) => layers[c]).length;

  return (
    <div className="mt-0.5 border-t border-border/30 pt-1">
      {/* ── Header colapsable ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        )}
        <Globe className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
        <span
          className={[
            "flex-1 text-[13px] leading-tight",
            activeCount > 0 ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          Red Comercial Nacional
        </span>
        {activeCount > 0 && (
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            {activeCount}
          </span>
        )}
        <span className="font-mono text-[9px] text-text-muted">OSM</span>
      </button>

      {/* ── Lista de categorías ────────────────────────────────────────── */}
      {open && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {CATEGORY_ORDER.map((cat) => {
            const meta   = COMERCIAL_LAYER_META[cat];
            const on     = layers[cat];
            const count  = counts[cat];

            return (
              <button
                key={cat}
                type="button"
                onClick={() => onToggle(cat)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
                aria-pressed={on}
              >
                {/* Dot de color */}
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />

                {/* Emoji */}
                <span className="flex-shrink-0 text-[13px] leading-none">
                  {meta.icon}
                </span>

                {/* Nombre */}
                <span
                  className={[
                    "flex-1 text-[13px] leading-tight",
                    on ? "text-foreground" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {meta.label}
                </span>

                {/* Conteo */}
                {on && count !== undefined && (
                  <span className="font-mono text-[10px] text-text-muted">
                    {count.toLocaleString()}
                  </span>
                )}
                {on && count === undefined && (
                  <span className="font-mono text-[10px] text-text-muted animate-pulse">
                    …
                  </span>
                )}

                <IOSSwitch on={on} />
              </button>
            );
          })}

          {/* ── Nota fuente ─────────────────────────────────────────────── */}
          <p className="px-2 py-1 text-[10px] text-text-muted">
            Fuente: OpenStreetMap · Actualización semanal automática
          </p>
        </div>
      )}
    </div>
  );
};
