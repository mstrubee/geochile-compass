import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SavedPoi } from "@/types/pois";
import type { PoiPerformanceAnalysis, TemporalState, DriverContribution } from "@/types/analysis";
import { usePoiPerformance } from "@/hooks/usePoiPerformance";

/**
 * Panel "Análisis" del POI. Muestra:
 *  1. Header con predicción vs real y residuo (sobrerendimiento o brecha).
 *  2. Drivers territoriales (top contribuciones del Ridge).
 *  3. Descomposición temporal en UF (regímenes detectados).
 *  4. Peers similares (5 más cercanos en feature space).
 *
 * Si no hay datos cacheados, muestra CTA para que el admin recompute.
 */

interface Props {
  poi: SavedPoi;
  /** Lista completa de POIs del chain para resolver nombres de peers. */
  chainPois: SavedPoi[];
  /** True si el usuario es admin (muestra botón de recompute). */
  isAdmin: boolean;
  /** Trigger del batch de recompute. Si null, no se muestra el botón. */
  onRecompute?: () => void;
  /** Si el batch está corriendo. */
  recomputing?: boolean;
}

const STATE_CONFIG: Record<TemporalState, { label: string; cls: string; icon: typeof TrendingUp }> = {
  recovered_growing: { label: "Recuperado y creciendo", cls: "bg-brand-green/15 text-brand-green", icon: TrendingUp },
  stable: { label: "Estable", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400", icon: Minus },
  decelerating: { label: "Desacelerando", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400", icon: TrendingDown },
  not_recovered: { label: "No recuperado", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400", icon: TrendingDown },
  at_risk: { label: "En riesgo", cls: "bg-destructive/15 text-destructive", icon: TrendingDown },
  insufficient_data: { label: "Datos insuficientes", cls: "bg-muted text-muted-foreground", icon: Info },
};

const REGIME_LABEL: Record<string, string> = {
  pre_shock: "Pre-shock (estable inicial)",
  crisis: "Crisis",
  recovery: "Recuperación",
  ttm: "Últimos 12 meses (TTM)",
};

const fmtUf = (n: number | null | undefined): string =>
  n == null ? "—" : `${Math.round(n).toLocaleString("es-CL")} UF`;
const fmtClp = (n: number | null | undefined): string =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`;
const fmtPct = (n: number | null | undefined, sign = false): string => {
  if (n == null) return "—";
  const s = sign && n > 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
};

const fmtPeriod = (period: string): string => {
  const [y, m] = period.split("-");
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${months[parseInt(m, 10) - 1] ?? m} ${y}`;
};

export const PoiAnalysisPanel = ({ poi, chainPois, isAdmin, onRecompute, recomputing = false }: Props) => {
  const { perf, loading, reload } = usePoiPerformance(poi.id);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Cuando termine un recompute externo, recargar
  useEffect(() => {
    if (!recomputing) void reload();
  }, [recomputing, reload]);

  const peerRows = useMemo(() => {
    if (!perf?.peer_poi_ids) return [];
    return perf.peer_poi_ids
      .map((pid) => {
        const found = chainPois.find((p) => p.id === pid);
        return found ? { id: pid, name: found.name } : null;
      })
      .filter((p): p is { id: string; name: string } => p != null);
  }, [perf, chainPois]);

  const generateNarrative = async () => {
    if (!perf) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = {
        poi: { id: poi.id, name: poi.name, lat: poi.lat, lng: poi.lng },
        analysis: {
          target_year: perf.target_year,
          actual_monthly_uf: perf.actual_monthly_uf,
          predicted_monthly_uf: perf.predicted_monthly_uf,
          residual_pct: perf.residual_pct,
          temporal_state: perf.temporal_state,
          temporal_decomposition: perf.temporal_decomposition,
          top_drivers: perf.top_drivers,
        },
        peers: peerRows.map((p) => p.name),
      };
      const { data, error } = await supabase.functions.invoke("poi-insights", {
        body: payload,
      });
      if (error) throw error;
      const summary = (data as { summary?: string })?.summary;
      if (summary) setAiSummary(summary);
      else setAiError("Sin respuesta del modelo");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  };

  if (loading || recomputing) {
    return (
      <div className="flex h-72 items-center justify-center text-[12px] text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {recomputing ? "Recomputando análisis…" : "Cargando análisis…"}
      </div>
    );
  }

  if (!perf) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3 px-4 text-center">
        <Info className="h-10 w-10 text-muted-foreground/50" />
        <div className="text-[12px] text-muted-foreground">
          Aún no hay análisis calculado para este POI.
        </div>
        <div className="max-w-sm text-[11px] text-muted-foreground">
          El análisis se computa para toda la carpeta a la vez.{" "}
          {isAdmin
            ? "Como admin, ejecuta 'Recalcular análisis' desde el menú contextual de la carpeta."
            : "Pide a un admin que ejecute el cálculo."}
        </div>
      </div>
    );
  }

  const isInsufficient = perf.temporal_state === "insufficient_data" || perf.actual_monthly_uf == null;
  const stateCfg = STATE_CONFIG[(perf.temporal_state as TemporalState) ?? "stable"];

  return (
    <div className="space-y-4 px-5 py-4">
      {/* Header summary */}
      <div className="rounded-xl border border-border/30 bg-surface-2/40 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Año cerrado {perf.target_year}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              Predicción del modelo basada en el entorno territorial vs realidad observada
            </div>
          </div>
          {perf.computed_at && (
            <div className="text-[10px] text-muted-foreground">
              {new Date(perf.computed_at).toLocaleDateString("es-CL")}
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <KpiCard label="Predicho mensual" valueUf={perf.predicted_monthly_uf} valueClp={perf.predicted_monthly_clp} />
          <KpiCard
            label="Real mensual"
            valueUf={perf.actual_monthly_uf}
            valueClp={perf.actual_monthly_clp}
            muted={isInsufficient}
          />
          <ResidualCard residualPct={perf.residual_pct} residualClp={perf.residual_clp} />
        </div>

        {isInsufficient && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>
              Local nuevo o sin datos completos del año {perf.target_year}. La predicción se
              basa solo en el entorno territorial; el residuo no se puede calcular.
            </span>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${stateCfg.cls}`}>
            <stateCfg.icon className="h-3 w-3" />
            {stateCfg.label}
          </span>
          {isAdmin && onRecompute && (
            <button
              onClick={onRecompute}
              disabled={recomputing}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/40 bg-surface-3/50 px-2 py-1 text-[10px] hover:bg-surface-3"
            >
              <RefreshCw className="h-3 w-3" />
              Recalcular para todo el chain
            </button>
          )}
        </div>
      </div>

      {/* Drivers */}
      <Section title="Drivers territoriales (top 5)" subtitle="Contribución de cada feature al nivel de ventas mensual respecto al promedio del chain">
        {perf.top_drivers.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">Sin drivers calculados.</div>
        ) : (
          <div className="space-y-1.5">
            {perf.top_drivers.map((d, i) => (
              <DriverRow key={i} driver={d} />
            ))}
          </div>
        )}
      </Section>

      {/* Temporal decomposition */}
      <Section title="Descomposición temporal" subtitle="Promedios mensuales en UF (deflactado por la UF de cada mes)">
        <TemporalDecomposition perf={perf} />
      </Section>

      {/* Peers */}
      <Section title="Locales similares (peer benchmark)" subtitle="Los 5 locales más parecidos en el feature space (entorno territorial similar)">
        {peerRows.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">Sin peers calculados.</div>
        ) : (
          <div className="space-y-1">
            {peerRows.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md bg-surface-2/40 px-3 py-2 text-[12px]">
                <span className="truncate">{p.name}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* AI narrative */}
      <Section title="Resumen ejecutivo (IA)" subtitle="Narrativa generada con los números calculados, no inventa cifras">
        {aiSummary ? (
          <div className="prose prose-sm max-w-none rounded-lg bg-surface-2/40 px-4 py-3 text-[12px] leading-relaxed">
            <SimpleMarkdown markdown={aiSummary} />
            <div className="mt-3 flex">
              <button
                onClick={generateNarrative}
                disabled={aiLoading}
                className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-surface-3/50 px-2 py-1 text-[10px] hover:bg-surface-3"
              >
                <RefreshCw className={`h-3 w-3 ${aiLoading ? "animate-spin" : ""}`} />
                Regenerar
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-surface-2/40 px-4 py-3 text-[11px]">
            <button
              onClick={generateNarrative}
              disabled={aiLoading}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Generar resumen ejecutivo
            </button>
            {aiError && (
              <div className="mt-2 text-[10px] text-destructive">{aiError}</div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
};

/* ------------ Sub-components ------------ */

const Section = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <div>
    <div className="mb-1.5">
      <div className="text-[12px] font-medium">{title}</div>
      {subtitle && <div className="text-[10px] text-muted-foreground">{subtitle}</div>}
    </div>
    {children}
  </div>
);

const KpiCard = ({
  label,
  valueUf,
  valueClp,
  muted,
}: {
  label: string;
  valueUf: number | null | undefined;
  valueClp: number | null | undefined;
  muted?: boolean;
}) => (
  <div className={`rounded-lg bg-surface-2/60 px-3 py-2.5 ${muted ? "opacity-50" : ""}`}>
    <div className="text-[10px] text-muted-foreground">{label}</div>
    <div className="mt-1 text-[15px] font-semibold leading-tight">{fmtUf(valueUf)}</div>
    <div className="text-[10px] text-muted-foreground">{fmtClp(valueClp)}</div>
  </div>
);

const ResidualCard = ({
  residualPct,
  residualClp,
}: {
  residualPct: number | null;
  residualClp: number | null;
}) => {
  if (residualPct == null) {
    return (
      <div className="rounded-lg bg-surface-2/60 px-3 py-2.5 opacity-50">
        <div className="text-[10px] text-muted-foreground">Brecha</div>
        <div className="mt-1 text-[15px] font-semibold leading-tight">—</div>
      </div>
    );
  }
  const positive = residualPct >= 0;
  const cls = positive ? "text-brand-green" : "text-destructive";
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <div className="rounded-lg bg-surface-2/60 px-3 py-2.5">
      <div className="text-[10px] text-muted-foreground">{positive ? "Sobrerendimiento" : "Brecha"}</div>
      <div className={`mt-1 flex items-center gap-1 text-[15px] font-semibold leading-tight ${cls}`}>
        <Icon className="h-3.5 w-3.5" />
        {fmtPct(residualPct, true)}
      </div>
      <div className="text-[10px] text-muted-foreground">{fmtClp(residualClp)}</div>
    </div>
  );
};

const DriverRow = ({ driver }: { driver: DriverContribution }) => {
  const positive = driver.contribution_uf >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const cls = positive ? "text-brand-green" : "text-destructive";
  // Ancho de la barra relativo al máximo |contribution| del top
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md bg-surface-2/40 px-3 py-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <Icon className={`h-3 w-3 ${cls}`} />
          {driver.label}
        </div>
        <div className="text-[10px] text-muted-foreground">
          z = {driver.z?.toFixed(2) ?? "—"}
        </div>
      </div>
      <div className={`text-right text-[11px] font-mono font-medium ${cls}`}>
        {positive ? "+" : ""}
        {Math.round(driver.contribution_uf)} UF
      </div>
    </div>
  );
};

const TemporalDecomposition = ({ perf }: { perf: PoiPerformanceAnalysis }) => {
  const decomp = perf.temporal_decomposition as {
    regimes?: Array<{ kind: string; from: string; to: string; uf_mean: number; clp_mean: number }>;
    recovery_ratio?: number | null;
    short_term_acceleration?: number | null;
  } | null;

  const regimes = decomp?.regimes ?? [];
  if (regimes.length === 0) {
    return <div className="text-[11px] text-muted-foreground">Sin datos de descomposición temporal.</div>;
  }

  const preMean = regimes.find((r) => r.kind === "pre_shock")?.uf_mean ?? 0;

  return (
    <div className="space-y-1">
      {regimes.map((r, i) => {
        const pctVsPre = preMean > 0 && r.kind !== "pre_shock"
          ? ((r.uf_mean - preMean) / preMean) * 100
          : null;
        const positive = pctVsPre != null && pctVsPre >= 0;
        return (
          <div key={i} className="grid grid-cols-[140px_1fr_auto] items-center gap-3 rounded-md bg-surface-2/40 px-3 py-2 text-[11px]">
            <div>
              <div className="font-medium">{REGIME_LABEL[r.kind] ?? r.kind}</div>
              <div className="text-[9px] text-muted-foreground">
                {fmtPeriod(r.from)} → {fmtPeriod(r.to)}
              </div>
            </div>
            <div className="font-mono">{Math.round(r.uf_mean)} UF/mes</div>
            <div className={pctVsPre == null ? "text-muted-foreground" : positive ? "text-brand-green" : "text-destructive"}>
              {pctVsPre != null ? fmtPct(pctVsPre, true) : "—"}
            </div>
          </div>
        );
      })}
      {decomp?.recovery_ratio != null && (
        <div className="mt-2 rounded-md bg-surface-2/30 px-3 py-2 text-[10px] text-muted-foreground">
          <span className="font-medium">Ratio recuperación / pre-shock:</span>{" "}
          {decomp.recovery_ratio.toFixed(2)}{" "}
          {decomp.recovery_ratio >= 1 ? "(superado)" : "(no recuperado)"}
          {decomp.short_term_acceleration != null && (
            <>
              {" · "}
              <span className="font-medium">Aceleración corta:</span>{" "}
              {fmtPct(decomp.short_term_acceleration * 100, true)}
            </>
          )}
        </div>
      )}
    </div>
  );
};

/** Render mínimo de markdown — bold (**) y bullets (-/*). */
const SimpleMarkdown = ({ markdown }: { markdown: string }) => {
  const lines = markdown.split("\n");
  const renderInline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
    );
  };
  return (
    <div>
      {lines.map((ln, i) => {
        const t = ln.trim();
        if (!t) return <div key={i} className="h-2" />;
        if (t.startsWith("- ") || t.startsWith("* ")) {
          return (
            <div key={i} className="ml-3 flex gap-1.5">
              <span className="text-primary">•</span>
              <span>{renderInline(t.slice(2))}</span>
            </div>
          );
        }
        if (/^#{1,6} /.test(t)) {
          return (
            <div key={i} className="mt-1 font-semibold">
              {renderInline(t.replace(/^#{1,6}\s+/, ""))}
            </div>
          );
        }
        return <div key={i}>{renderInline(t)}</div>;
      })}
    </div>
  );
};
