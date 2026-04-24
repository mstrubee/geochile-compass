import { X, Download, FileJson, ClipboardCopy } from "lucide-react";
import { useState } from "react";

interface AnalysisPanelProps {
  open: boolean;
  onClose: () => void;
}

const METRICS = [
  { value: "—", label: "Personas" },
  { value: "—", label: "Hogares" },
  { value: "—", label: "Densidad hab/km²" },
  { value: "—", label: "Área km²" },
  { value: "—", label: "Ingreso prom." },
  { value: "—", label: "Pob. activa" },
];

const NSE_BARS = [
  { label: "ABC1", pct: 0, color: "bg-[hsl(224_76%_38%)]" },
  { label: "C2", pct: 0, color: "bg-[hsl(217_91%_55%)]" },
  { label: "C3", pct: 0, color: "bg-brand-yellow" },
  { label: "D", pct: 0, color: "bg-brand-orange" },
  { label: "E", pct: 0, color: "bg-brand-red" },
];

export const AnalysisPanel = ({ open, onClose }: AnalysisPanelProps) => {
  const [tab, setTab] = useState(0);
  const tabs = ["5 min", "10 min", "15 min"];

  return (
    <div
      className={[
        "absolute right-0 top-0 z-[600] flex h-full w-[380px] flex-col border-l border-border/60 bg-surface/85 backdrop-blur-2xl backdrop-saturate-150 transition-transform duration-300",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
    >
      {/* Header */}
      <div className="relative flex-shrink-0 border-b border-border/40 px-5 pb-3 pt-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          <span className="h-2 w-2 rounded-full bg-iso-1" />
          Análisis territorial
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Selecciona o crea una isócrona / microzona para ver datos.
        </p>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-surface-2/60 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          aria-label="Cerrar panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-6 pt-3">
        {/* Segmented tabs */}
        <div className="mb-3 flex gap-0.5 rounded-lg bg-surface-2/60 p-0.5">
          {tabs.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              className={[
                "flex-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-all",
                tab === i ? "bg-surface-3 text-foreground shadow-apple-sm" : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Metric cards */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          {METRICS.map((m) => (
            <div key={m.label} className="rounded-xl bg-surface-2/60 px-3 py-2.5">
              <div className="text-[18px] font-semibold leading-none tracking-tight text-foreground">{m.value}</div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">{m.label}</div>
            </div>
          ))}
        </div>

        {/* NSE distribution */}
        <div className="mb-3 rounded-xl bg-surface-2/60 p-3">
          <div className="mb-2.5 text-[11px] font-medium text-muted-foreground">Distribución NSE</div>
          {NSE_BARS.map((n) => (
            <div key={n.label} className="mb-1.5 flex items-center gap-2">
              <span className="w-9 flex-shrink-0 font-mono text-[11px] text-foreground">{n.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className={["h-full transition-all duration-500", n.color].join(" ")} style={{ width: `${n.pct}%` }} />
              </div>
              <span className="w-7 text-right font-mono text-[10px] text-text-muted">{n.pct}%</span>
            </div>
          ))}
          <div className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-text-muted">
            Ingreso promedio: $— /mes · Fuente: CASEN 2022
          </div>
        </div>

        <div className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">POIs en el área</div>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {[
            { icon: "🛒", n: 0, t: "Sup." },
            { icon: "💊", n: 0, t: "Far." },
            { icon: "⛽", n: 0, t: "Gas" },
          ].map((p) => (
            <div key={p.t} className="rounded-xl bg-surface-2/60 px-2 py-2.5 text-center">
              <div className="text-[18px]">{p.icon}</div>
              <div className="mt-0.5 text-[15px] font-semibold leading-none text-foreground">{p.n}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{p.t}</div>
            </div>
          ))}
        </div>

        <div className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">Comunas cubiertas</div>
        <div className="mb-3 overflow-hidden rounded-xl bg-surface-2/60">
          <div className="grid grid-cols-[1fr_70px_60px] border-b border-border/40">
            {["Comuna", "Población", "NSE"].map((h) => (
              <div key={h} className="px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">
                {h}
              </div>
            ))}
          </div>
          <div className="px-2 py-4 text-center text-[11px] text-text-muted">
            Sin datos. Genera una zona en el mapa.
          </div>
        </div>

        <div className="mb-2 mt-3 px-1 text-[11px] font-medium text-muted-foreground">Exportar</div>
        <div className="flex gap-1.5">
          <button className="flex-1 rounded-lg bg-surface-2/60 px-2 py-2 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3">
            <Download className="mr-1 inline h-3 w-3" /> CSV
          </button>
          <button className="flex-1 rounded-lg bg-surface-2/60 px-2 py-2 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3">
            <FileJson className="mr-1 inline h-3 w-3" /> JSON
          </button>
          <button className="flex-1 rounded-lg bg-surface-2/60 px-2 py-2 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3">
            <ClipboardCopy className="mr-1 inline h-3 w-3" /> Copiar
          </button>
        </div>
      </div>
    </div>
  );
};
