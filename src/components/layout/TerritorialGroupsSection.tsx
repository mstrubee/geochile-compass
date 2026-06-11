import { ChevronDown, ChevronRight, Wrench, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTerritorialLayers } from "@/hooks/useTerritorialLayers";
import { useTerritorialVisibility } from "@/hooks/useTerritorialVisibility";
import { useLayerStyles } from "@/hooks/useLayerStyles";
import type { TerritorialGroup, TerritorialLayer } from "@/types/territorial";
import { TerritorialLayerManagerDialog } from "@/components/panels/TerritorialLayerManagerDialog";
import { BrandStyleEditorDialog } from "@/components/panels/BrandStyleEditorDialog";
import type { BrandStyle } from "@/hooks/useBrandStyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const STORAGE_KEY = "territorial_groups_expanded_v1";

const readMap = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

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

const isUrlLike = (s: string | null) =>
  !!s && (s.startsWith("http") || s.startsWith("/") || s.startsWith("data:"));

interface GroupBlockProps {
  group:  TerritorialGroup;
  layers: TerritorialLayer[];
}

const GroupBlock = ({ group, layers }: GroupBlockProps) => {
  const { isVisible, toggleLayer, setLayers } = useTerritorialVisibility();
  const { getStyle, setLayerStyle, resetLayerStyle } = useLayerStyles();
  const [expanded, setExpanded] = useState<boolean>(() => {
    const map = readMap();
    return typeof map[group.id] === "boolean" ? map[group.id] : false;
  });
  // Capa que se está editando actualmente (null = ninguna / dialog cerrado)
  const [editingLayer, setEditingLayer] = useState<TerritorialLayer | null>(null);

  const updateExpanded = (next: boolean) => {
    setExpanded(next);
    try {
      const m = readMap();
      m[group.id] = next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
    } catch {
      // ignore
    }
  };

  const visibleCount = layers.filter((l) => isVisible(l.id)).length;
  const allOn = layers.length > 0 && visibleCount === layers.length;

  const toggleAll = () => {
    setLayers(
      layers.map((l) => l.id),
      !allOn,
    );
  };

  const accent = group.color || "#F59E0B";

  // Preparar el BrandStyle para el dialog a partir del LayerStyle efectivo
  const editingStyle: BrandStyle | null = editingLayer
    ? (() => {
        const s = getStyle(editingLayer.id, editingLayer.color, editingLayer.icon);
        return {
          color:    s.color    ?? accent,
          icon:     s.icon,
          iconSize: s.iconSize,
          visible:  true,
        };
      })()
    : null;

  return (
    <div className="mb-0.5">
      <div className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2/60">
        <button
          type="button"
          onClick={() => updateExpanded(!expanded)}
          aria-label={expanded ? "Colapsar" : "Expandir"}
          className="flex-shrink-0"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <Wrench className="h-3.5 w-3.5 flex-shrink-0" style={{ color: accent }} />
        <button
          type="button"
          onClick={toggleAll}
          className={[
            "flex-1 text-left text-[13px] leading-tight",
            allOn ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          {group.name}
        </button>
        <span className="font-mono text-[10px] text-text-muted">
          {visibleCount}/{layers.length}
        </span>
        <button type="button" onClick={toggleAll} aria-label={`Encender/apagar ${group.name}`}>
          <IOSSwitch on={allOn} />
        </button>
      </div>

      {expanded && (
        <div className="ml-5">
          {layers.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-text-muted">
              Sin sub-capas. Cargá un archivo desde Admin.
            </p>
          )}
          {layers.map((l) => {
            const on  = isVisible(l.id);
            const eff = getStyle(l.id, l.color, l.icon);
            const color    = eff.color ?? accent;
            const hasEmoji = !!eff.icon && !isUrlLike(eff.icon);

            return (
              <ContextMenu key={l.id}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => toggleLayer(l.id)}
                    className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
                    aria-pressed={on}
                  >
                    {/* Dot de color (o imagen si es URL) */}
                    {eff.icon && isUrlLike(eff.icon) ? (
                      <img
                        src={eff.icon}
                        alt=""
                        className="h-4 w-4 flex-shrink-0 rounded-full object-cover"
                        style={{ border: `1.5px solid ${color}` }}
                      />
                    ) : (
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    )}

                    {/* Emoji ícono si aplica */}
                    {hasEmoji && (
                      <span className="flex-shrink-0 text-[12px] leading-none">
                        {eff.icon}
                      </span>
                    )}

                    <span
                      className={[
                        "flex-1 text-[13px] leading-tight",
                        on ? "text-foreground" : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {l.name}
                    </span>
                    <span className="font-mono text-[10px] text-text-muted">
                      {l.feature_count}
                    </span>
                    <IOSSwitch on={on} />
                  </button>
                </ContextMenuTrigger>

                <ContextMenuContent className="z-[1200] w-52">
                  <ContextMenuItem onSelect={() => setEditingLayer(l)}>
                    ✏️ Editar estilo (color, ícono, tamaño)
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => resetLayerStyle(l.id)}
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

      {/* Dialog de edición (portal al body, no afecta el layout) */}
      <BrandStyleEditorDialog
        brand={editingLayer?.name ?? null}
        currentStyle={editingStyle}
        onSave={(_, style) => {
          if (!editingLayer) return;
          setLayerStyle(editingLayer.id, {
            color:    style.color,
            icon:     style.icon,
            iconSize: style.iconSize,
          });
        }}
        onReset={() => {
          if (!editingLayer) return;
          resetLayerStyle(editingLayer.id);
        }}
        onClose={() => setEditingLayer(null)}
      />
    </div>
  );
};

/** Palabras clave que identifican grupos que van primero (case-insensitive). */
const PINNED_FIRST = ["serv. automotrices", "serv automotrices", "servautomotrices", "automotrices"];

const sortGroups = (groups: TerritorialGroup[]): TerritorialGroup[] => {
  return [...groups].sort((a, b) => {
    const aPin = PINNED_FIRST.some(k => a.name.toLowerCase().includes(k));
    const bPin = PINNED_FIRST.some(k => b.name.toLowerCase().includes(k));
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    return 0;
  });
};

export const TerritorialGroupsSection = ({ isAdmin = false }: { isAdmin?: boolean }) => {
  const { groups: allGroups, layers, loading } = useTerritorialLayers();
  const [managerOpen, setManagerOpen] = useState(false);
  // Ocultamos el grupo "Parque Automotriz" porque ya está en CollapsibleCustomLayers.
  const groups = sortGroups(
    allGroups.filter(
      (g) => g.name.trim().toLowerCase() !== "parque automotriz",
    )
  );
  const { visibleLayerIds, heatmapEnabled, setHeatmapEnabled } = useTerritorialVisibility();
  const hasVisibleLayers = layers.some((layer) => visibleLayerIds.has(layer.id));

  useEffect(() => {
    if (!hasVisibleLayers && heatmapEnabled) setHeatmapEnabled(false);
  }, [hasVisibleLayers, heatmapEnabled, setHeatmapEnabled]);

  if (loading) {
    return <p className="px-2 py-1 text-[11px] text-text-muted">Cargando capas…</p>;
  }
  if (!groups.length) {
    return <p className="px-2 py-1 text-[11px] text-text-muted">No hay grupos.</p>;
  }
  return (
    <>
      {/* Fila heatmap + botón admin (solo visible para admins) */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setHeatmapEnabled(!(heatmapEnabled && hasVisibleLayers) && hasVisibleLayers)}
          disabled={!hasVisibleLayers}
          className="mb-0.5 flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60 disabled:cursor-not-allowed disabled:opacity-50"
          aria-pressed={heatmapEnabled && hasVisibleLayers}
        >
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand-orange" />
          <span
            className={[
              "flex-1 text-[13px] leading-tight",
              heatmapEnabled && hasVisibleLayers ? "text-foreground" : "text-muted-foreground",
            ].join(" ")}
          >
            Mapa de calor
          </span>
          <span className="font-mono text-[10px] text-text-muted">
            {hasVisibleLayers ? "azul→rojo" : "—"}
          </span>
          <IOSSwitch on={heatmapEnabled && hasVisibleLayers} />
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
      {groups.map((g) => (
        <GroupBlock key={g.id} group={g} layers={layers.filter((l) => l.group_id === g.id)} />
      ))}
      {isAdmin && (
        <TerritorialLayerManagerDialog
          open={managerOpen}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </>
  );
};
