import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
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

  const toggleAll = () => {
    setLayers(
      layers.map((l) => l.id),
      !allOn,
    );
  };

  const accent = group.color || "#F59E0B";

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
            const on = isVisible(l.id);
            const color = l.color || accent;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggleLayer(l.id)}
                className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60"
                aria-pressed={on}
              >
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
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
            );
          })}
        </div>
      )}
    </div>
  );
};

export const TerritorialGroupsSection = () => {
  const { groups: allGroups, layers, loading } = useTerritorialLayers();
  // Ocultamos el grupo "Parque Automotriz" porque ya está representado por el
  // toggle dedicado "Parque automotor" (heatmap canvas).
  const groups = allGroups.filter(
    (g) => g.name.trim().toLowerCase() !== "parque automotriz",
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
      <button
        type="button"
        onClick={() => setHeatmapEnabled(!(heatmapEnabled && hasVisibleLayers) && hasVisibleLayers)}
        disabled={!hasVisibleLayers}
        className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60 disabled:cursor-not-allowed disabled:opacity-50"
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
      {groups.map((g) => (
        <GroupBlock key={g.id} group={g} layers={layers.filter((l) => l.group_id === g.id)} />
      ))}
    </>
  );
};
