interface LegendProps {
  shifted: boolean;
}

export const Legend = ({ shifted }: LegendProps) => {
  return (
    <div
      className={[
        "absolute bottom-[22px] z-[500] min-w-[160px] rounded-lg border border-border bg-surface/93 p-3 backdrop-blur transition-[right] duration-300",
        shifted ? "right-[374px]" : "right-3.5",
      ].join(" ")}
    >
      <div className="mb-2 font-mono text-[9px] uppercase tracking-[2px] text-text-muted">Leyenda</div>
      <div className="space-y-1">
        {[
          { color: "bg-primary", label: "Demografía" },
          { color: "bg-brand-purple", label: "NSE" },
          { color: "bg-brand-orange", label: "Tráfico" },
          { color: "bg-brand-pink", label: "Densidad" },
        ].map((i) => (
          <div key={i.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className={["h-2 w-[18px] flex-shrink-0 rounded-sm", i.color].join(" ")} />
            {i.label}
          </div>
        ))}
      </div>
      <div className="mt-2 font-mono text-[9px] text-text-muted">Activa una capa para ver detalle</div>
    </div>
  );
};
