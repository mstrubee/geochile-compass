import type { LayerState } from "@/types/layers";
import { COMMUNES, NSE_LABELS, NSE_COLOR_HSL, type NSE } from "@/data/communes";
import { TRAFFIC_LEVELS, trafficLevelOf, type TrafficLevel } from "@/utils/traffic";
import type { ManzanaSource, ManzanaVariable } from "@/types/manzanas";
import { scaleForVariable, VARIABLE_LABEL } from "@/utils/colorScales";

interface LegendProps {
  shifted: boolean;
  layers: LayerState;
  nseFilter: NSE | null;
  onNseFilterChange: (n: NSE | null) => void;
  trafficFilter: TrafficLevel | null;
  onTrafficFilterChange: (t: TrafficLevel | null) => void;
  manzanaVariable: ManzanaVariable;
  manzanaSource: ManzanaSource | null;
  manzanaError: string | null;
}

interface NSERow {
  nse: NSE;
  label: string;
  hsl: string;
  count: number;
  pct: number;
}

interface TrafficRow {
  level: TrafficLevel;
  label: string;
  hsl: string;
  range: string;
  count: number;
}

const computeNSERows = (): NSERow[] => {
  const counts: Record<NSE, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  COMMUNES.forEach((c) => {
    counts[c.nse] += 1;
  });
  const total = COMMUNES.length;
  return ([5, 4, 3, 2, 1] as NSE[]).map((nse) => ({
    nse,
    label: NSE_LABELS[nse],
    hsl: `hsl(${NSE_COLOR_HSL[nse]})`,
    count: counts[nse],
    pct: (counts[nse] / total) * 100,
  }));
};

const computeTrafficRows = (): TrafficRow[] => {
  const counts: Record<TrafficLevel, number> = { low: 0, mid: 0, high: 0 };
  COMMUNES.forEach((c) => {
    counts[trafficLevelOf(c.traffic)] += 1;
  });
  return (["low", "mid", "high"] as TrafficLevel[]).map((level) => {
    const t = TRAFFIC_LEVELS[level];
    return {
      level,
      label: t.label,
      hsl: t.hsl,
      range: level === "low" ? "< 50" : level === "mid" ? "50 – 72" : "> 72",
      count: counts[level],
    };
  });
};

const SectionTitle = ({
  title,
  hasFilter,
  onClear,
}: {
  title: string;
  hasFilter: boolean;
  onClear: () => void;
}) => (
  <div className="mb-1.5 mt-1 flex items-center gap-2">
    <div className="flex-1 font-mono text-[9px] uppercase tracking-[2px] text-text-muted">{title}</div>
    {hasFilter && (
      <button
        onClick={onClear}
        className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[8px] uppercase text-text-muted transition-colors hover:border-brand-red hover:text-brand-red"
      >
        Limpiar
      </button>
    )}
  </div>
);

const FilterRow = ({
  hsl,
  label,
  meta,
  selected,
  dim,
  onClick,
}: {
  hsl: string;
  label: string;
  meta: string;
  selected: boolean;
  dim: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected || undefined}
    className={[
      "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] transition-all hover:bg-surface-2",
      selected && "bg-surface-2 ring-1 ring-inset ring-primary/40",
      dim && "opacity-40",
    ]
      .filter(Boolean)
      .join(" ")}
  >
    <span className="h-2 w-[18px] flex-shrink-0 rounded-sm" style={{ background: hsl }} />
    <span className="flex-1 text-foreground">{label}</span>
    <span className="font-mono text-[9px] text-text-muted">{meta}</span>
  </button>
);

export const Legend = ({
  shifted,
  layers,
  nseFilter,
  onNseFilterChange,
  trafficFilter,
  onTrafficFilterChange,
  manzanaVariable,
  manzanaSource,
  manzanaError,
}: LegendProps) => {
  const showNSE = layers.nse;
  const showTraffic = layers.traffic;
  const showManzanas = layers.manzanas;
  const showAny = showNSE || showTraffic || showManzanas;

  // Count combined matches when both filters could apply
  const matched = COMMUNES.filter(
    (c) =>
      (nseFilter === null || c.nse === nseFilter) &&
      (trafficFilter === null || trafficLevelOf(c.traffic) === trafficFilter)
  ).length;

  const manzanaScale = showManzanas ? scaleForVariable(manzanaVariable) : [];

  return (
    <div
      className={[
        "absolute bottom-[22px] z-[500] w-[230px] rounded-lg border border-border bg-surface/95 p-3 backdrop-blur transition-[right] duration-300",
        shifted ? "right-[374px]" : "right-3.5",
      ].join(" ")}
    >
      {!showAny && (
        <>
          <div className="mb-2 font-mono text-[9px] uppercase tracking-[2px] text-text-muted">Leyenda</div>
          <div className="space-y-1">
            {[
              { swatch: "bg-primary", label: "Demografía" },
              { swatch: "bg-brand-purple", label: "NSE" },
              { swatch: "bg-brand-orange", label: "Tráfico" },
              { swatch: "bg-brand-pink", label: "Densidad" },
            ].map((i) => (
              <div key={i.label} className="flex items-center gap-2 text-[11px] text-foreground">
                <span className={["h-2 w-[18px] flex-shrink-0 rounded-sm", i.swatch].join(" ")} />
                {i.label}
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-border pt-1.5 font-mono text-[9px] text-text-muted">
            Activa una capa para filtrar
          </div>
        </>
      )}

      {showNSE && (
        <>
          <SectionTitle title="NSE" hasFilter={nseFilter !== null} onClear={() => onNseFilterChange(null)} />
          <div className="space-y-0.5">
            {computeNSERows().map((r) => {
              const selected = nseFilter === r.nse;
              const dim = nseFilter !== null && !selected;
              return (
                <FilterRow
                  key={r.nse}
                  hsl={r.hsl}
                  label={r.label}
                  meta={`${r.count} · ${r.pct.toFixed(0)}%`}
                  selected={selected}
                  dim={dim}
                  onClick={() => onNseFilterChange(selected ? null : r.nse)}
                />
              );
            })}
          </div>
        </>
      )}

      {showTraffic && (
        <>
          <SectionTitle
            title="Tráfico"
            hasFilter={trafficFilter !== null}
            onClear={() => onTrafficFilterChange(null)}
          />
          <div className="space-y-0.5">
            {computeTrafficRows().map((r) => {
              const selected = trafficFilter === r.level;
              const dim = trafficFilter !== null && !selected;
              return (
                <FilterRow
                  key={r.level}
                  hsl={r.hsl}
                  label={r.label}
                  meta={`${r.range} · ${r.count}`}
                  selected={selected}
                  dim={dim}
                  onClick={() => onTrafficFilterChange(selected ? null : r.level)}
                />
              );
            })}
          </div>
        </>
      )}

      {showAny && (
        <div className="mt-2 border-t border-border pt-1.5 font-mono text-[9px] leading-relaxed text-text-muted">
          {nseFilter === null && trafficFilter === null ? (
            <>Clic en cualquier fila para filtrar el mapa</>
          ) : (
            <>
              <span className="text-foreground">{matched}</span> de {COMMUNES.length} comunas coinciden
              {nseFilter !== null && (
                <>
                  {" "}· NSE <span style={{ color: `hsl(${NSE_COLOR_HSL[nseFilter]})` }}>{NSE_LABELS[nseFilter]}</span>
                </>
              )}
              {trafficFilter !== null && (
                <>
                  {" "}· Tráfico{" "}
                  <span style={{ color: TRAFFIC_LEVELS[trafficFilter].hsl }}>
                    {TRAFFIC_LEVELS[trafficFilter].label}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
