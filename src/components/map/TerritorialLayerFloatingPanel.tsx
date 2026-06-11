/**
 * TerritorialLayerFloatingPanel
 * ─────────────────────────────
 * Panel flotante (esquina inferior izquierda del mapa) para todas las capas
 * que necesitan controles secundarios: Comunas de Chile, GSE por manzana,
 * Atractores comerciales, Gasto endógeno, Agroplanet y Competidores.
 *
 * Colapsable · scroll automático · búsqueda en sección Competidores.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { LayerState } from "@/types/layers";

// ── Agroplanet ────────────────────────────────────────────────────────────────
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

// ── Comunas de Chile ──────────────────────────────────────────────────────────
import { INE_VARIABLE_LABEL, type IneVariable } from "@/utils/ineScales";

// ── GSE por manzana ───────────────────────────────────────────────────────────
import { GSE_VARIABLE_LABEL } from "@/utils/gseScales";
import type { GseVariable } from "@/types/gse";

// ── Atractores comerciales ────────────────────────────────────────────────────
import { CATEGORY_META, type CommercialCategory } from "@/components/map/CommercialHeatLayer";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  layers: LayerState;
  // Agroplanet
  agroplanetScoreMode: AgroplanetScoreMode;
  onAgroplanetScoreModeChange: (m: AgroplanetScoreMode) => void;
  // Comunas de Chile
  chileCommunesVariable: IneVariable;
  onChileCommunesVariableChange: (v: IneVariable) => void;
  // GSE por manzana
  gseVariable: GseVariable;
  onGseVariableChange: (v: GseVariable) => void;
  gseCount: number;
  // Atractores comerciales
  activeCommercialCats: Set<CommercialCategory>;
  onCommercialToggle: (c: CommercialCategory) => void;
  // Gasto endógeno
  gastoView: "heat" | "manzana";
  onGastoViewChange: (v: "heat" | "manzana") => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Botones de selección de variable (segmented control). */
const VarSelector = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) => (
  <div className="flex flex-wrap gap-0.5 rounded-md bg-surface-2/60 p-0.5">
    {options.map(({ key, label }) => (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        className={[
          "rounded px-1.5 py-1 text-[10px] font-medium transition-all",
          value === key
            ? "bg-surface-3 text-foreground shadow-apple-sm"
            : "text-muted-foreground hover:text-foreground",
        ].join(" ")}
      >
        {label}
      </button>
    ))}
  </div>
);

/** Título de sección dentro del panel. */
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
    {children}
  </div>
);

/** Divisor entre secciones. */
const Divider = () => <div className="border-t border-border/35" />;

// ── Componente principal ──────────────────────────────────────────────────────

export const TerritorialLayerFloatingPanel = ({
  layers,
  agroplanetScoreMode,
  onAgroplanetScoreModeChange,
  chileCommunesVariable,
  onChileCommunesVariableChange,
  gseVariable,
  onGseVariableChange,
  gseCount,
  activeCommercialCats,
  onCommercialToggle,
  gastoView,
  onGastoViewChange,
}: Props) => {
  const [collapsed, setCollapsed]       = useState(false);
  const [editingBrand, setEditingBrand] = useState<string | null>(null);
  const [brandSearch, setBrandSearch]   = useState("");

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

  const filteredBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    if (!q) return brandGroups;
    return brandGroups.filter(({ brand }) => brand.toLowerCase().includes(q));
  }, [brandGroups, brandSearch]);

  // ── Qué secciones están activas ────────────────────────────────────────────
  const hasComunas     = !!layers.communesGeo;
  const hasGse         = !!layers.nse;
  const hasComercial   = !!layers.commercial;
  const hasGasto       = !!layers.gasto;
  const hasAgroplanet  = !!layers.agroplanet;
  const hasCompetitors = !!layers.agroplanet_competitors;

  // Nada que mostrar → no renderizar
  if (!hasComunas && !hasGse && !hasComercial && !hasGasto && !hasAgroplanet && !hasCompetitors) {
    return null;
  }

  // ── Título dinámico ────────────────────────────────────────────────────────
  const SECTION_META = [
    { active: hasComunas,     emoji: "🗺️",  name: "Comunas de Chile"        },
    { active: hasGse,         emoji: "📊",  name: "GSE por manzana"          },
    { active: hasComercial,   emoji: "🏪",  name: "Atractores comerciales"   },
    { active: hasGasto,       emoji: "💸",  name: "Gasto endógeno"           },
    { active: hasAgroplanet,  emoji: "🌱",  name: "Agroplanet"               },
    { active: hasCompetitors, emoji: "🚜",  name: "Competidores maquinaria"  },
  ].filter((s) => s.active);

  const panelTitle =
    SECTION_META.length === 1
      ? `${SECTION_META[0].emoji} ${SECTION_META[0].name}`
      : SECTION_META.length === 2
      ? `${SECTION_META[0].emoji} ${SECTION_META[0].name.split(" ")[0]} · ${SECTION_META[1].emoji} ${SECTION_META[1].name.split(" ")[0]}`
      : `⚙️ Controles de capas (${SECTION_META.length})`;

  return (
    <>
      {/* ─── Panel flotante ──────────────────────────────────────────────── */}
      <div className="absolute bottom-10 left-4 z-[550] w-[268px] overflow-hidden rounded-xl border border-border/55 bg-surface/92 shadow-apple backdrop-blur-2xl backdrop-saturate-150">

        {/* Header colapsable */}
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
          {hasCompetitors && brandGroups.length > 0 && !collapsed && (
            <span className="font-mono text-[9px] text-text-muted">
              {filteredBrands.length}/{brandGroups.length}
            </span>
          )}
        </button>

        {/* ── Cuerpo con scroll ────────────────────────────────────────────── */}
        {!collapsed && (
          <div className="max-h-[460px] overflow-y-auto border-t border-border/40">
            <div className="px-3 pb-3 pt-2.5 space-y-3">

              {/* ── 1. Comunas de Chile ────────────────────────────────── */}
              {hasComunas && (
                <div className="space-y-1.5">
                  <SectionLabel>Variable INE · 346 comunas</SectionLabel>
                  <VarSelector
                    options={(Object.keys(INE_VARIABLE_LABEL) as IneVariable[]).map((v) => ({
                      key: v,
                      label: INE_VARIABLE_LABEL[v],
                    }))}
                    value={chileCommunesVariable}
                    onChange={onChileCommunesVariableChange}
                  />
                  <p className="text-[9.5px] leading-relaxed text-text-muted">
                    Sin CSV INE, solo 52 comunas RM tienen datos. Sube <code>/ine_communes.csv</code> para cobertura nacional.
                  </p>
                </div>
              )}

              {hasComunas && (hasGse || hasComercial || hasGasto || hasAgroplanet || hasCompetitors) && <Divider />}

              {/* ── 2. GSE por manzana ─────────────────────────────────── */}
              {hasGse && (
                <div className="space-y-1.5">
                  <SectionLabel>Variable GSE · {gseCount.toLocaleString("es-CL")} manzanas</SectionLabel>
                  <VarSelector
                    options={(Object.keys(GSE_VARIABLE_LABEL) as GseVariable[]).map((v) => ({
                      key: v,
                      label: GSE_VARIABLE_LABEL[v],
                    }))}
                    value={gseVariable}
                    onChange={onGseVariableChange}
                  />
                  <p className="text-[9.5px] leading-relaxed text-text-muted">
                    Censo 2012 — comunas sin datos muestran círculo estimado.
                  </p>
                </div>
              )}

              {hasGse && (hasComercial || hasGasto || hasAgroplanet || hasCompetitors) && <Divider />}

              {/* ── 3. Atractores comerciales ───────────────────────────── */}
              {hasComercial && (
                <div className="space-y-1">
                  <SectionLabel>
                    Categoría{" "}
                    <span className="normal-case font-normal">(clic para filtrar)</span>
                  </SectionLabel>
                  {(Object.keys(CATEGORY_META) as CommercialCategory[]).map((cat) => {
                    const { icon, label, color } = CATEGORY_META[cat];
                    const on = activeCommercialCats.has(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => onCommercialToggle(cat)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 transition-all hover:bg-surface-2/60"
                        style={{ opacity: on ? 1 : 0.35 }}
                      >
                        <span className="text-[13px]">{icon}</span>
                        <span className={["flex-1 text-[11px]", on ? "text-foreground font-medium" : "text-muted-foreground"].join(" ")}>
                          {label}
                        </span>
                        {on
                          ? <div className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
                          : <span className="text-[9px] text-muted-foreground/50">oculto</span>
                        }
                      </button>
                    );
                  })}
                  <div className="h-1.5 rounded-full mt-1" style={{ background: "linear-gradient(to right,#1565c0,#00897b,#c0ca33,#e64a19,#b71c1c)" }} />
                  <div className="flex justify-between text-[9px] text-muted-foreground/60">
                    <span>Disperso</span><span>Concentrado</span>
                  </div>
                </div>
              )}

              {hasComercial && (hasGasto || hasAgroplanet || hasCompetitors) && <Divider />}

              {/* ── 4. Gasto endógeno hogares ───────────────────────────── */}
              {hasGasto && (
                <div className="space-y-2">
                  <SectionLabel>Vista</SectionLabel>
                  <div className="flex gap-1 rounded-md bg-surface-2/60 p-0.5">
                    {([
                      { key: "heat"    as const, label: "🌡️ Heatmap",  desc: "Comunas ponderadas por hogares × EPF" },
                      { key: "manzana" as const, label: "🗺️ Manzanas", desc: "Coeficiente EPF por clase GSE"         },
                    ]).map(({ key, label, desc }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onGastoViewChange(key)}
                        title={desc}
                        className={[
                          "flex-1 rounded px-2 py-1.5 text-[11px] font-medium transition-all text-center",
                          gastoView === key
                            ? "bg-surface-3 text-foreground shadow-apple-sm"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: "linear-gradient(to right,#fee5d9,#fcae91,#fb6a4a,#de2d26,#a50f15)" }} />
                  <div className="flex justify-between text-[9px] text-muted-foreground/60">
                    <span>Bajo gasto</span><span>Alto gasto</span>
                  </div>
                  <p className="text-[9.5px] leading-relaxed text-text-muted">
                    EPF Autoplanet: ABC1 $49k · C2 $25k · C3 $13k · D $4k.
                  </p>
                </div>
              )}

              {hasGasto && (hasAgroplanet || hasCompetitors) && <Divider />}

              {/* ── 5. Agroplanet ──────────────────────────────────────── */}
              {hasAgroplanet && (
                <div className="space-y-2">
                  {/* Score */}
                  <div>
                    <SectionLabel>Score</SectionLabel>
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
                    <SectionLabel>Cultivos</SectionLabel>
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

              {hasAgroplanet && hasCompetitors && brandGroups.length > 0 && <Divider />}

              {/* ── 6. Competidores maquinaria ────────────────────────── */}
              {hasCompetitors && brandGroups.length > 0 && (
                <div className="space-y-1.5">
                  <SectionLabel>
                    Por marca{" "}
                    <span className="normal-case font-normal">(clic derecho para editar)</span>
                  </SectionLabel>

                  {/* Buscador */}
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                    <input
                      type="text"
                      value={brandSearch}
                      onChange={(e) => setBrandSearch(e.target.value)}
                      placeholder="Buscar marca…"
                      className="w-full rounded-md border border-border/50 bg-surface-2/70 py-1 pl-6 pr-6 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/60 focus:bg-surface-2"
                    />
                    {brandSearch && (
                      <button
                        type="button"
                        onClick={() => setBrandSearch("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded text-muted-foreground/50 transition-colors hover:text-foreground"
                        aria-label="Limpiar búsqueda"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Lista filtrada — scroll propio para que el buscador quede fijo */}
                  <div className="max-h-[240px] overflow-y-auto space-y-0.5 pr-0.5">
                    {filteredBrands.length === 0 ? (
                      <p className="px-1 py-2 text-center text-[11px] text-muted-foreground/60">
                        Sin resultados para &ldquo;{brandSearch}&rdquo;
                      </p>
                    ) : (
                      filteredBrands.map(({ brand, count }) => {
                        const style = getStyle(brand);
                        return (
                          <ContextMenu key={brand}>
                            <ContextMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={() => setBrandStyle(brand, { visible: !style.visible })}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
                                style={{ opacity: style.visible ? 1 : 0.42 }}
                              >
                                <span
                                  className="h-3 w-3 flex-shrink-0 rounded-full border border-white/30"
                                  style={{
                                    backgroundColor: style.color,
                                    boxShadow: style.visible ? `0 0 0 1.5px ${style.color}55` : "none",
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
                                    style.visible ? "text-foreground" : "text-muted-foreground",
                                  ].join(" ")}
                                >
                                  {brand}
                                </span>
                                <span className="font-mono text-[10px] text-text-muted">{count}</span>
                                <IOSSwitch on={style.visible} />
                              </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="z-[1200] w-52">
                              <ContextMenuItem onSelect={() => setEditingBrand(brand)}>
                                ✏️ Editar estilo (color, ícono, tamaño)
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onSelect={() => setBrandStyle(brand, { visible: !style.visible })}
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
                      })
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </div>

      {/* Editor de estilo por marca */}
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
