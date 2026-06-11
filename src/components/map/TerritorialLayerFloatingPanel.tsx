/**
 * TerritorialLayerFloatingPanel
 * ─────────────────────────────
 * Panel flotante en la esquina inferior izquierda del mapa.
 * Se activa cuando hay capas territoriales con controles asociados
 * (Agroplanet, Competidores) y desaparece al apagarlas.
 * Colapsable con el mismo patrón que AnalysisPanel.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LayerState } from "@/types/layers";
import type { AgroplanetScoreMode } from "@/components/map/AgroplanetComunasLayer";
import { AGRO_IS_SCORE } from "@/components/map/AgroplanetComunasLayer";
import { useAgroplanetCompetitors } from "@/hooks/useAgroplanetCompetitors";
import { useBrandStyles, getBrandKey } from "@/hooks/useBrandStyles";
import { BrandStyleEditorDialog } from "@/components/panels/BrandStyleEditorDialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  layers: LayerState;
  agroplanetScoreMode: AgroplanetScoreMode;
  onAgroplanetScoreModeChange: (m: AgroplanetScoreMode) => void;
}

// ── IOSSwitch compacto ────────────────────────────────────────────────────────

const IOSSwitch = ({ on }: { on: boolean }) => (
  <div
    className={[
      "relative h-[18px] w-[30px] flex-shrink-0 rounded-full transition-colors",
      on ? "bg-brand-green" : "bg-surface-3",
    ].join(" ")}
  >
    <span
      className={[
        "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-apple-sm transition-all",
        on ? "left-[14px]" : "left-[2px]",
      ].join(" ")}
    />
  </div>
);

// ── Componente principal ──────────────────────────────────────────────────────

export const TerritorialLayerFloatingPanel = ({
  layers,
  agroplanetScoreMode,
  onAgroplanetScoreModeChange,
}: Props) => {
  const [collapsed, setCollapsed]     = useState(false);
  const [editingBrand, setEditingBrand] = useState<string | null>(null);

  const { getStyle, setBrandStyle, resetBrandStyle } = useBrandStyles();
  const { data: compData } = useAgroplanetCompetitors(
    layers.agroplanet_competitors ?? false,
  );

  const brandGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of compData) {
      const brand = getBrandKey(c);
      counts.set(brand, (counts.get(brand) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count);
  }, [compData]);

  const hasAgroplanet  = !!layers.agroplanet;
  const hasCompetitors = !!layers.agroplanet_competitors;

  // Nada que mostrar → no renderizar
  if (!hasAgroplanet && !hasCompetitors) return null;

  const panelTitle =
    hasAgroplanet && hasCompetitors
      ? "🌱 Agroplanet · 🚜 Competidores"
      : hasAgroplanet
      ? "🌱 Agroplanet"
      : "🚜 Competidores maquinaria";

  return (
    <>
      {/* ─── Panel flotante ─────────────────────────────────────────────── */}
      <div className="absolute bottom-10 left-4 z-[550] w-[258px] overflow-hidden rounded-xl border border-border/55 bg-surface/92 shadow-apple backdrop-blur-2xl backdrop-saturate-150">

        {/* Header colapsable (mismo patrón que AnalysisPanel Section) */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-2/50"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="flex-1 truncate text-[11px] font-semibold text-foreground">
            {panelTitle}
          </span>
        </button>

        {/* Cuerpo colapsable */}
        {!collapsed && (
          <div className="border-t border-border/40 px-3 pb-3 pt-2.5 space-y-3">

            {/* ── Bloque Agroplanet ──────────────────────────────────────── */}
            {hasAgroplanet && (
              <div className="space-y-2">
                {/* Score */}
                <div>
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                    Score
                  </div>
                  <div className="flex gap-1 rounded-md bg-surface-2/60 p-0.5">
                    {([
                      { key: "combined" as const, label: "🌱 Combinado" },
                      { key: "grandes"  as const, label: "🏭 Grandes"   },
                      { key: "indap"    as const, label: "🌾 INDAP"      },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onAgroplanetScoreModeChange(key)}
                        className={[
                          "flex-1 rounded px-1.5 py-1.5 text-[10px] font-medium transition-all text-center",
                          agroplanetScoreMode === key
                            ? "bg-surface-3 text-foreground shadow-apple-sm"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cultivos */}
                <div>
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                    Cultivos
                  </div>
                  <div className="flex flex-wrap gap-1 rounded-md bg-surface-2/60 p-0.5">
                    {([
                      { key: "frutales"   as const, label: "🍇 Frutales"  },
                      { key: "cereales"   as const, label: "🌾 Cereales"   },
                      { key: "vinas"      as const, label: "🍷 Viñas"      },
                      { key: "forrajeras" as const, label: "🌿 Forraje"    },
                      { key: "diversidad" as const, label: "🔬 Diversidad" },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onAgroplanetScoreModeChange(key)}
                        className={[
                          "rounded px-1.5 py-1 text-[10px] font-medium transition-all text-center",
                          agroplanetScoreMode === key
                            ? "bg-surface-3 text-foreground shadow-apple-sm"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Leyenda dinámica */}
                {AGRO_IS_SCORE(agroplanetScoreMode) ? (
                  <div className="flex items-center gap-1.5">
                    {[
                      { color: "#d1fae5", label: "Q1" },
                      { color: "#6ee7b7", label: "Q2" },
                      { color: "#f59e0b", label: "Q3" },
                      { color: "#f97316", label: "Q4" },
                      { color: "#15803d", label: "Q5" },
                    ].map(({ color, label }) => (
                      <div key={label} className="flex flex-col items-center gap-0.5">
                        <div className="h-2.5 w-8 rounded-sm" style={{ background: color }} />
                        <span className="text-[9px] text-muted-foreground/60">{label}</span>
                      </div>
                    ))}
                  </div>
                ) : agroplanetScoreMode === "diversidad" ? (
                  <div className="flex items-center gap-1.5">
                    {[
                      { color: "#f1f5f9", label: "0"   },
                      { color: "#d1fae5", label: "Q1"  },
                      { color: "#34d399", label: "Q2"  },
                      { color: "#059669", label: "Q3"  },
                      { color: "#4338ca", label: "Q4+" },
                    ].map(({ color, label }) => (
                      <div key={label} className="flex flex-col items-center gap-0.5">
                        <div className="h-2.5 w-8 rounded-sm" style={{ background: color }} />
                        <span className="text-[9px] text-muted-foreground/60">{label}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    {[
                      { color: "#f1f5f9", label: "0 ha" },
                      { color: "#bfdbfe", label: "Q1"   },
                      { color: "#60a5fa", label: "Q2"   },
                      { color: "#2563eb", label: "Q3"   },
                      { color: "#1e3a8a", label: "Q4+"  },
                    ].map(({ color, label }) => (
                      <div key={label} className="flex flex-col items-center gap-0.5">
                        <div className="h-2.5 w-8 rounded-sm" style={{ background: color }} />
                        <span className="text-[9px] text-muted-foreground/60">{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Separador entre secciones */}
            {hasAgroplanet && hasCompetitors && brandGroups.length > 0 && (
              <div className="border-t border-border/35" />
            )}

            {/* ── Bloque Competidores ────────────────────────────────────── */}
            {hasCompetitors && brandGroups.length > 0 && (
              <div className="space-y-0.5">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                  Por marca{" "}
                  <span className="normal-case font-normal">
                    (clic derecho para editar)
                  </span>
                </div>
                {brandGroups.map(({ brand, count }) => {
                  const style = getStyle(brand);
                  return (
                    <ContextMenu key={brand}>
                      <ContextMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={() =>
                            setBrandStyle(brand, { visible: !style.visible })
                          }
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
                          style={{ opacity: style.visible ? 1 : 0.42 }}
                        >
                          <span
                            className="h-3 w-3 flex-shrink-0 rounded-full border border-white/30"
                            style={{
                              backgroundColor: style.color,
                              boxShadow: style.visible
                                ? `0 0 0 1.5px ${style.color}55`
                                : "none",
                            }}
                          />
                          {style.icon &&
                            !style.icon.startsWith("http") &&
                            !style.icon.startsWith("data:") &&
                            !style.icon.startsWith("/") && (
                              <span className="flex-shrink-0 text-[12px] leading-none">
                                {style.icon}
                              </span>
                            )}
                          <span
                            className={[
                              "flex-1 truncate text-[11px]",
                              style.visible
                                ? "text-foreground"
                                : "text-muted-foreground",
                            ].join(" ")}
                          >
                            {brand}
                          </span>
                          <span className="font-mono text-[10px] text-text-muted">
                            {count}
                          </span>
                          <IOSSwitch on={style.visible} />
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="z-[1200] w-52">
                        <ContextMenuItem
                          onSelect={() => setEditingBrand(brand)}
                        >
                          ✏️ Editar estilo (color, ícono, tamaño)
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onSelect={() =>
                            setBrandStyle(brand, { visible: !style.visible })
                          }
                        >
                          {style.visible ? "🙈 Ocultar en mapa" : "👁 Mostrar en mapa"}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onSelect={() => resetBrandStyle(brand)}
                          className="text-muted-foreground"
                        >
                          ↩ Restaurar estilo por defecto
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            )}

          </div>
        )}
      </div>

      {/* Editor de estilo por marca (dialog separado del panel) */}
      <BrandStyleEditorDialog
        brand={editingBrand}
        currentStyle={editingBrand ? getStyle(editingBrand) : null}
        onSave={(brand, style) => setBrandStyle(brand, style)}
        onReset={(brand) => resetBrandStyle(brand)}
        onClose={() => setEditingBrand(null)}
      />
    </>
  );
};
