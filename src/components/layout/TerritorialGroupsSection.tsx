import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useTerritorialLayers } from "@/hooks/useTerritorialLayers";
import { useTerritorialVisibility } from "@/hooks/useTerritorialVisibility";
import type { TerritorialGroup, TerritorialLayer } from "@/types/territorial";

const STORAGE_KEY = "territorial_groups_expanded_v1";

const readMap = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

interface GroupBlockProps {
  group: TerritorialGroup;
  layers: TerritorialLayer[];
}

const GroupBlock = ({ group, layers }: GroupBlockProps) => {
  const { isVisible, toggleLayer, setLayers } = useTerritorialVisibility();
  const [expanded, setExpanded] = useState<boolean>(() => {
    const map = readMap();
    return typeof map[group.id] === "boolean" ? map[group.id] : false;
  });

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
  const indeterminate = visibleCount > 0 && visibleCount < layers.length;

  const toggleAll = () => {
    setLayers(
      layers.map((l) => l.id),
      !allOn,
    );
  };

  const accent = group.color || "#F59E0B";

  return (
    <div className="mb-1.5 rounded-lg bg-surface-2/40">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => updateExpanded(!expanded)}
          className="flex flex-1 items-center gap-1.5 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Wrench className="h-3.5 w-3.5" style={{ color: accent }} />
          <span className="text-[13px] font-medium text-foreground">{group.name}</span>
          <span className="ml-auto font-mono text-[10px] text-text-muted">
            {visibleCount}/{layers.length}
          </span>
        </button>
        <Checkbox
          checked={allOn ? true : indeterminate ? "indeterminate" : false}
          onCheckedChange={toggleAll}
          aria-label={`Encender/apagar todas las capas de ${group.name}`}
        />
      </div>
      {expanded && (
        <div className="px-2 pb-2">
          {layers.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-text-muted">
              Sin sub-capas. Cargá un archivo desde Admin.
            </p>
          )}
          {layers.map((l) => {
            const on = isVisible(l.id);
            const color = l.color || accent;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggleLayer(l.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-2/60"
              >
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span
                  className={[
                    "flex-1 text-[12px]",
                    on ? "text-foreground" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {l.name}
                </span>
                <span className="font-mono text-[10px] text-text-muted">
                  {l.feature_count}
                </span>
                <span onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={on}
                    onCheckedChange={() => toggleLayer(l.id)}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const TerritorialGroupsSection = () => {
  const { groups, layers, loading } = useTerritorialLayers();
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
      <label className="mb-1.5 flex items-center gap-2 rounded-lg bg-surface-2/40 px-2 py-1.5 cursor-pointer">
        <Checkbox
          checked={heatmapEnabled && hasVisibleLayers}
          disabled={!hasVisibleLayers}
          onCheckedChange={(v) => setHeatmapEnabled(v === true && hasVisibleLayers)}
          aria-label="Mostrar mapa de calor"
        />
        <span className="text-[12px] font-medium text-foreground">Mapa de calor</span>
        <span className="ml-auto text-[10px] text-text-muted">
          {hasVisibleLayers ? "azul → rojo" : "selecciona capas"}
        </span>
      </label>
      {groups.map((g) => (
        <GroupBlock key={g.id} group={g} layers={layers.filter((l) => l.group_id === g.id)} />
      ))}
    </>
  );
};
