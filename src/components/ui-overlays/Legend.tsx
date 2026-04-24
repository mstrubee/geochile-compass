import type { LayerState } from "@/types/layers";
import { COMMUNES, NSE_LABELS, NSE_COLOR_HSL, type NSE } from "@/data/communes";

interface LegendProps {
  shifted: boolean;
  layers: LayerState;
}

interface LegendItem {
  swatch: string; // either a tailwind class like "bg-..." OR an inline hsl() string
  inline?: boolean;
  label: string;
  meta?: string;
}

const computeNSEDistribution = (): Array<LegendItem & { nse: NSE; pct: number }> => {
  const counts: Record<NSE, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  COMMUNES.forEach((c) => {
    counts[c.nse] += 1;
  });
  const total = COMMUNES.length;
  // Display from ABC1 (5) down to E (1)
  return ([5, 4, 3, 2, 1] as NSE[]).map((nse) => {
    const pct = (counts[nse] / total) * 100;
    return {
      nse,
      pct,
      swatch: `hsl(${NSE_COLOR_HSL[nse]})`,
      inline: true,
      label: NSE_LABELS[nse],
      meta: `${counts[nse]} comunas · ${pct.toFixed(0)}%`,
    };
  });
};

const TRAFFIC_ITEMS: LegendItem[] = [
  { swatch: "hsl(142 71% 45%)", inline: true, label: "Fluido", meta: "< 50" },
  { swatch: "hsl(47 95% 53%)", inline: true, label: "Moderado", meta: "50 – 72" },
  { swatch: "hsl(0 84% 60%)", inline: true, label: "Alto", meta: "> 72" },
];

const DEFAULT_ITEMS: LegendItem[] = [
  { swatch: "bg-primary", label: "Demografía" },
  { swatch: "bg-brand-purple", label: "NSE" },
  { swatch: "bg-brand-orange", label: "Tráfico" },
  { swatch: "bg-brand-pink", label: "Densidad" },
];

const Swatch = ({ item }: { item: LegendItem }) =>
  item.inline ? (
    <span
      className="h-2 w-[18px] flex-shrink-0 rounded-sm"
      style={{ background: item.swatch }}
    />
  ) : (
    <span className={["h-2 w-[18px] flex-shrink-0 rounded-sm", item.swatch].join(" ")} />
  );

export const Legend = ({ shifted, layers }: LegendProps) => {
  // Determine context: NSE > Traffic > Default. Predominant single layer wins.
  const showNSE = layers.nse;
  const showTraffic = !showNSE && layers.traffic;

  let title = "Leyenda";
  let footer = "Activa una capa para ver detalle";
  let items: LegendItem[];
  let predominant: { label: string; pct: number } | null = null;

  if (showNSE) {
    title = "NSE — Distribución";
    const nseItems = computeNSEDistribution();
    items = nseItems;
    const top = [...nseItems].sort((a, b) => b.pct - a.pct)[0];
    predominant = { label: top.label, pct: top.pct };
    footer = `Predominante: ${top.label} · ${top.pct.toFixed(0)}%`;
  } else if (showTraffic) {
    title = "Tráfico Vehicular";
    items = TRAFFIC_ITEMS;
    footer = "Índice 0 – 100";
  } else {
    items = DEFAULT_ITEMS;
  }

  return (
    <div
      className={[
        "absolute bottom-[22px] z-[500] min-w-[180px] rounded-lg border border-border bg-surface/95 p-3 backdrop-blur transition-[right] duration-300",
        shifted ? "right-[374px]" : "right-3.5",
      ].join(" ")}
    >
      <div className="mb-2 font-mono text-[9px] uppercase tracking-[2px] text-text-muted">
        {title}
      </div>

      <div className="space-y-1">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Swatch item={i} />
            <span className="flex-1 text-foreground">{i.label}</span>
            {i.meta && (
              <span className="font-mono text-[9px] text-text-muted">{i.meta}</span>
            )}
            {showNSE && predominant?.label === i.label && (
              <span
                className="rounded-sm px-1 py-px font-mono text-[8px] uppercase"
                style={{
                  color: "hsl(var(--background))",
                  background: `hsl(${NSE_COLOR_HSL[(items as Array<{ nse: NSE }>)[items.findIndex((x) => x.label === i.label)].nse]})`,
                }}
              >
                top
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 border-t border-border pt-1.5 font-mono text-[9px] text-text-muted">
        {footer}
      </div>
    </div>
  );
};
