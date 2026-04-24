import { X, Download, FileJson, ClipboardCopy } from "lucide-react";
import { useState } from "react";

interface AnalysisPanelProps {
  open: boolean;
  onClose: () => void;
}

const METRICS = [
  { variant: "a1", value: "—", label: "Personas" },
  { variant: "a2", value: "—", label: "Hogares" },
  { variant: "a3", value: "—", label: "Densidad hab/km²" },
  { variant: "a4", value: "—", label: "Área km²" },
  { variant: "a5", value: "—", label: "Ingreso prom." },
  { variant: "a6", value: "—", label: "Pob. activa" },
] as const;

const ACCENT_CLASSES: Record<string, { border: string; text: string }> = {
  a1: { border: "before:bg-primary", text: "text-primary" },
  a2: { border: "before:bg-[hsl(232_82%_75%)]", text: "text-[hsl(232_82%_75%)]" },
  a3: { border: "before:bg-brand-purple", text: "text-brand-purple" },
  a4: { border: "before:bg-brand-green", text: "text-brand-green" },
  a5: { border: "before:bg-brand-orange", text: "text-brand-orange" },
  a6: { border: "before:bg-text-muted", text: "text-muted-foreground" },
};

const NSE_BARS = [
  { label: "ABC1", pct: 0, color: "bg-[hsl(224_76%_38%)]" },
  { label: "C2", pct: 0, color: "bg-[hsl(217_91%_55%)]" },
  { label: "C3", pct: 0, color: "bg-brand-yellow" },
  { label: "D", pct: 0, color: "bg-brand-orange" },
  { label: "E", pct: 0, color: "bg-brand-red" },
];

export const AnalysisPanel = ({ open, onClose }: AnalysisPanelProps) => {
  const [tab, setTab] = useState(0);
  const tabs: Array<{ label: string; active: string; idle: string }> = [
    { label: "5 min", active: "border-iso-1 bg-iso-1/10 text-iso-1", idle: "border-border bg-surface-2 text-text-muted" },
    { label: "10 min", active: "border-iso-2 bg-iso-2/10 text-iso-2", idle: "border-border bg-surface-2 text-text-muted" },
    { label: "15 min", active: "border-iso-3 bg-iso-3/10 text-iso-3", idle: "border-border bg-surface-2 text-text-muted" },
  ];

  return (
    <div
      className={[
        "absolute right-0 top-0 z-[600] flex h-full w-[360px] flex-col border-l border-border bg-background/97 backdrop-blur-md transition-transform duration-300",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      style={{ background: "hsl(var(--background) / 0.97)" }}
    >
      {/* Header */}
      <div className="relative flex-shrink-0 border-b border-border px-4 pb-2.5 pt-3.5">
        <h2 className="flex items-center gap-1.5 font-display text-[15px] font-bold">
          <span className="h-2 w-2 rounded-full bg-iso-1" />
          Análisis Territorial
        </h2>
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-text-muted">
          Selecciona o crea una isócrona / microzona para ver datos.
        </p>
        <button
          onClick={onClose}
          className="absolute right-2.5 top-2.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Cerrar panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-6 pt-2.5">
        {/* Tabs */}
        <div className="mb-2.5 flex gap-1">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTab(i)}
              className={[
                "flex-1 rounded border px-1 py-1.5 text-center font-mono text-[10px] transition-colors",
                tab === i ? t.active : t.idle,
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Metric grid */}
        <div className="mb-2.5 grid grid-cols-2 gap-1.5">
          {METRICS.map((m) => {
            const cls = ACCENT_CLASSES[m.variant];
            return (
              <div
                key={m.label}
                className={[
                  "relative overflow-hidden rounded-md border border-border bg-surface-2 px-2.5 py-2",
                  "before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:content-['']",
                  cls.border,
                ].join(" ")}
              >
                <div className={["font-display text-[15px] font-bold leading-none", cls.text].join(" ")}>
                  {m.value}
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-wide text-text-muted">{m.label}</div>
              </div>
            );
          })}
        </div>

        {/* NSE distribution */}
        <div className="mb-2.5 rounded-md border border-border bg-surface-2 p-2.5">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wide text-text-muted">
            Distribución NSE
          </div>
          {NSE_BARS.map((n) => (
            <div key={n.label} className="mb-1 flex items-center gap-1.5">
              <span className="w-9 flex-shrink-0 font-mono text-[10px]">{n.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-border">
                <div className={["h-full transition-all duration-500", n.color].join(" ")} style={{ width: `${n.pct}%` }} />
              </div>
              <span className="w-6 text-right font-mono text-[9px] text-text-muted">{n.pct}%</span>
            </div>
          ))}
          <div className="mt-1.5 border-t border-border pt-1 font-mono text-[9px] leading-relaxed text-text-muted">
            Ingreso promedio: $— /mes · Fuente: CASEN 2022
          </div>
        </div>

        {/* POIs */}
        <div className="mb-2 font-mono text-[9px] uppercase tracking-[1.5px] text-text-muted">POIs en el área</div>
        <div className="mb-2.5 grid grid-cols-3 gap-1">
          {[
            { icon: "🛒", n: 0, t: "Sup." },
            { icon: "💊", n: 0, t: "Far." },
            { icon: "⛽", n: 0, t: "Gas" },
          ].map((p) => (
            <div key={p.t} className="rounded border border-border bg-surface-2 px-1 py-2 text-center">
              <div className="text-[16px]">{p.icon}</div>
              <div className="font-display text-[14px] font-bold leading-none">{p.n}</div>
              <div className="mt-1 font-mono text-[9px] text-text-muted">{p.t}</div>
            </div>
          ))}
        </div>

        {/* Communes */}
        <div className="mb-2 font-mono text-[9px] uppercase tracking-[1.5px] text-text-muted">Comunas Cubiertas</div>
        <div className="mb-2.5 overflow-hidden rounded-md border border-border bg-surface-2">
          <div className="grid grid-cols-[1fr_70px_60px] border-b border-border bg-surface-3">
            {["Comuna", "Población", "NSE"].map((h) => (
              <div key={h} className="px-2 py-1.5 font-mono text-[9px] uppercase text-text-muted">
                {h}
              </div>
            ))}
          </div>
          <div className="px-2 py-3 text-center font-mono text-[10px] text-text-muted">
            Sin datos. Genera una zona en el mapa.
          </div>
        </div>

        {/* Export */}
        <div className="mb-1 mt-2 font-mono text-[9px] uppercase tracking-[1.5px] text-text-muted">Exportar</div>
        <div className="flex gap-1">
          <button className="flex-1 rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-[10px] text-text-muted transition-colors hover:border-primary hover:text-primary">
            <Download className="mr-1 inline h-3 w-3" /> CSV
          </button>
          <button className="flex-1 rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-[10px] text-text-muted transition-colors hover:border-primary hover:text-primary">
            <FileJson className="mr-1 inline h-3 w-3" /> JSON
          </button>
          <button className="flex-1 rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-[10px] text-text-muted transition-colors hover:border-primary hover:text-primary">
            <ClipboardCopy className="mr-1 inline h-3 w-3" /> Copiar
          </button>
        </div>
      </div>
    </div>
  );
};
