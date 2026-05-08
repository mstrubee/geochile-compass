import { X, Download, FileJson } from "lucide-react";
import { useMemo, useState } from "react";
import type { Isochrone } from "@/types/isochrones";
import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import { useIsochroneAnalysis } from "@/hooks/useIsochroneAnalysis";
import type { ManzanaFeatureCollection } from "@/types/manzanas";

interface AnalysisPanelProps {
  open: boolean;
  onClose: () => void;
  isochrone: Isochrone | null;
  manzanas?: ManzanaFeatureCollection | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const fmtCLP = (n: number) => `$${fmt(n)}`;

const NSE_COLORS: Record<string, string> = {
  ABC1: "bg-[hsl(224_76%_38%)]",
  C2: "bg-[hsl(217_91%_55%)]",
  C3: "bg-brand-yellow",
  D: "bg-brand-orange",
  E: "bg-brand-red",
};

const exportJson = (a: IsochroneAnalysis) => {
  const blob = new Blob([JSON.stringify(a, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement("a");
  a2.href = url;
  a2.download = `isocrona-${a.isoId}-${a.bandMinutes}min.json`;
  a2.click();
  URL.revokeObjectURL(url);
};

const exportCsv = (a: IsochroneAnalysis) => {
  const lines: string[] = [];
  lines.push("seccion,clave,valor");
  lines.push(`totales,banda_min,${a.bandMinutes}`);
  lines.push(`totales,area_km2,${a.area_km2.toFixed(3)}`);
  lines.push(`totales,personas,${a.totals.pop}`);
  lines.push(`totales,hogares,${a.totals.hh}`);
  lines.push(`totales,ingreso_total_clp,${a.totals.incomeTotal}`);
  lines.push(`totales,ingreso_promedio_hogar_clp,${a.totals.incomeAvgPerHh}`);
  lines.push(`totales,fuente,${a.totals.source}`);
  lines.push(`puntos,total,${a.territorialPoints.total}`);
  for (const g of a.territorialPoints.groups) {
    lines.push(`puntos_grupo,${g.groupName},${g.count}`);
    for (const l of g.layers) {
      lines.push(`puntos_capa,${g.groupName} > ${l.layerName},${l.count}`);
    }
  }
  for (const c of a.communes) {
    lines.push(
      `comuna,${c.name},pob=${Math.round(c.popInIso)};hh=${Math.round(c.hhInIso)};ingreso=${Math.round(c.incomeInIso)};share=${(c.areaShareInIso * 100).toFixed(1)}%`,
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement("a");
  a2.href = url;
  a2.download = `isocrona-${a.isoId}-${a.bandMinutes}min.csv`;
  a2.click();
  URL.revokeObjectURL(url);
};

export const AnalysisPanel = ({ open, onClose, isochrone, manzanas = null }: AnalysisPanelProps) => {
  const minutesAvailable = useMemo(
    () => (isochrone ? [...isochrone.minutes].sort((a, b) => a - b) : []),
    [isochrone],
  );
  const [tab, setTab] = useState(0);
  const selectedMin = minutesAvailable[Math.min(tab, minutesAvailable.length - 1)] ?? null;
  const bandSeconds = selectedMin != null ? selectedMin * 60 : undefined;

  const analysis = useIsochroneAnalysis({ isochrone, bandSeconds, manzanas });

  const nseDist = useMemo(() => {
    if (!analysis) return [] as { label: string; pct: number; color: string }[];
    if (analysis.manzanas && Object.keys(analysis.manzanas.nseDistribution).length > 0) {
      const total = Object.values(analysis.manzanas.nseDistribution).reduce(
        (s, v) => s + (v ?? 0),
        0,
      );
      if (total <= 0) return [];
      const labelMap: Record<number, string> = { 1: "E", 2: "D", 3: "C3", 4: "C2", 5: "ABC1" };
      return (["ABC1", "C2", "C3", "D", "E"] as const).map((label) => {
        const numKey = Object.entries(labelMap).find(([, v]) => v === label)?.[0];
        const v = numKey ? analysis.manzanas!.nseDistribution[Number(numKey) as 1 | 2 | 3 | 4 | 5] ?? 0 : 0;
        return { label, pct: Math.round((v / total) * 100), color: NSE_COLORS[label] };
      });
    }
    // Fallback: distribución comunal ponderada por hogares
    const counts: Record<string, number> = {};
    let total = 0;
    for (const c of analysis.communes) {
      if (!c.nse) continue;
      counts[c.nse] = (counts[c.nse] ?? 0) + c.hhInIso;
      total += c.hhInIso;
    }
    if (total <= 0) return [];
    return (["ABC1", "C2", "C3", "D", "E"] as const).map((label) => ({
      label,
      pct: Math.round(((counts[label] ?? 0) / total) * 100),
      color: NSE_COLORS[label],
    }));
  }, [analysis]);

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
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: isochrone?.color ?? "hsl(var(--iso-1))" }}
          />
          Análisis territorial
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {isochrone
            ? `Isócrona ${isochrone.mode === "driving-car" ? "vehículo" : isochrone.mode === "foot-walking" ? "caminata" : "bici"} · ${minutesAvailable.join(" / ")} min`
            : "Crea o selecciona una isócrona para ver datos."}
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
        {!isochrone && (
          <div className="rounded-xl bg-surface-2/60 px-4 py-6 text-center text-[12px] text-muted-foreground">
            Activa el modo Isócrona y haz click en el mapa para generar una.
          </div>
        )}

        {isochrone && minutesAvailable.length > 0 && (
          <div className="mb-3 flex gap-0.5 rounded-lg bg-surface-2/60 p-0.5">
            {minutesAvailable.map((m, i) => (
              <button
                key={m}
                onClick={() => setTab(i)}
                className={[
                  "flex-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-all",
                  tab === i ? "bg-surface-3 text-foreground shadow-apple-sm" : "text-muted-foreground hover:text-foreground",
                ].join(" "),
                ].join(" ")}
              >
                {m} min
              </button>
            ))}
          </div>
        )}

        {analysis && (
          <>
            {/* Metric cards */}
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Metric value={fmt(analysis.totals.pop)} label="Personas" />
              <Metric value={fmt(analysis.totals.hh)} label="Hogares" />
              <Metric value={fmtCLP(analysis.totals.incomeTotal)} label="Ingreso total/mes" />
              <Metric value={fmtCLP(analysis.totals.incomeAvgPerHh)} label="Ingreso prom./hogar" />
              <Metric value={analysis.area_km2.toFixed(2)} label="Área km²" />
              <Metric
                value={
                  analysis.area_km2 > 0
                    ? fmt(analysis.totals.pop / analysis.area_km2)
                    : "—"
                }
                label="Densidad hab/km²"
              />
            </div>

            <div className="mb-3 rounded-md bg-surface-2/40 px-3 py-1.5 text-[10px] text-muted-foreground">
              Fuente población:{" "}
              <span className="font-medium text-foreground">
                {analysis.totals.source === "manzanas"
                  ? "Manzanas (Censo)"
                  : "Estimado por comuna (proporcional al área)"}
              </span>
              {analysis.totals.source !== "manzanas" && (
                <div className="mt-1">
                  Activa la capa "Manzanas" para mayor precisión.
                </div>
              )}
            </div>

            {/* Capas territoriales */}
            <div className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">
              Capas territoriales · {analysis.territorialPoints.total} puntos
            </div>
            <div className="mb-3 overflow-hidden rounded-xl bg-surface-2/60">
              {analysis.territorialPoints.groups.length === 0 ? (
                <div className="px-3 py-3 text-center text-[11px] text-text-muted">
                  Sin puntos territoriales en el área.
                </div>
              ) : (
                analysis.territorialPoints.groups.map((g) => (
                  <div key={g.groupId} className="border-b border-border/30 px-3 py-2 last:border-b-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: g.color ?? "#888" }}
                        />
                        <span className="text-[12px] font-medium text-foreground">{g.groupName}</span>
                      </div>
                      <span className="font-mono text-[12px] text-foreground">{g.count}</span>
                    </div>
                    {g.layers.length > 0 && (
                      <div className="mt-1 ml-4 space-y-0.5">
                        {g.layers.map((l) => (
                          <div key={l.layerId} className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="truncate">{l.layerName}</span>
                            <span className="ml-2 font-mono">{l.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* NSE distribution */}
            {nseDist.length > 0 && (
              <div className="mb-3 rounded-xl bg-surface-2/60 p-3">
                <div className="mb-2.5 text-[11px] font-medium text-muted-foreground">
                  Distribución NSE {analysis.totals.source === "manzanas" ? "(manzanas)" : "(comunal)"}
                </div>
                {nseDist.map((n) => (
                  <div key={n.label} className="mb-1.5 flex items-center gap-2">
                    <span className="w-9 flex-shrink-0 font-mono text-[11px] text-foreground">{n.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div className={["h-full transition-all duration-500", n.color].join(" ")} style={{ width: `${n.pct}%` }} />
                    </div>
                    <span className="w-7 text-right font-mono text-[10px] text-text-muted">{n.pct}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* Comunas cubiertas */}
            <div className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">
              Comunas cubiertas
            </div>
            <div className="mb-3 overflow-hidden rounded-xl bg-surface-2/60">
              <div className="grid grid-cols-[1fr_55px_55px_55px] border-b border-border/40 text-[10px] font-medium text-muted-foreground">
                <div className="px-2 py-1.5">Comuna</div>
                <div className="px-2 py-1.5 text-right">% iso</div>
                <div className="px-2 py-1.5 text-right">Pob.</div>
                <div className="px-2 py-1.5 text-right">NSE</div>
              </div>
              {analysis.communes.length === 0 ? (
                <div className="px-2 py-3 text-center text-[11px] text-text-muted">
                  Sin comunas cubiertas.
                </div>
              ) : (
                analysis.communes.map((c) => (
                  <div
                    key={c.name}
                    className="grid grid-cols-[1fr_55px_55px_55px] border-b border-border/30 text-[11px] last:border-b-0"
                  >
                    <div className="truncate px-2 py-1.5 text-foreground">{c.name}</div>
                    <div className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                      {(c.areaShareInIso * 100).toFixed(0)}%
                    </div>
                    <div className="px-2 py-1.5 text-right font-mono text-foreground">
                      {fmt(c.popInIso)}
                    </div>
                    <div className="px-2 py-1.5 text-right text-muted-foreground">
                      {c.nse ?? "—"}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Export */}
            <div className="mb-2 mt-3 px-1 text-[11px] font-medium text-muted-foreground">
              Exportar
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => exportCsv(analysis)}
                className="flex-1 rounded-lg bg-surface-2/60 px-2 py-2 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3"
              >
                <Download className="mr-1 inline h-3 w-3" /> CSV
              </button>
              <button
                onClick={() => exportJson(analysis)}
                className="flex-1 rounded-lg bg-surface-2/60 px-2 py-2 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3"
              >
                <FileJson className="mr-1 inline h-3 w-3" /> JSON
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const Metric = ({ value, label }: { value: string; label: string }) => (
  <div className="rounded-xl bg-surface-2/60 px-3 py-2.5">
    <div className="text-[16px] font-semibold leading-none tracking-tight text-foreground">
      {value}
    </div>
    <div className="mt-1.5 text-[11px] text-muted-foreground">{label}</div>
  </div>
);
