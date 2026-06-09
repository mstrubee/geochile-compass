/**
 * SalesProjectionPanel.tsx
 * ========================
 * Panel de proyección de potencial de ventas para una isócrona.
 * Se activa desde el sidebar (botón en cada isócrona guardada).
 *
 * Método: comparable stores — los K=5 locales existentes más similares
 * por perfil territorial, promedio ponderado de sus ventas reales.
 */

import { useState, useCallback } from "react";
import { X, TrendingUp, Store, AlertCircle, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import type { SavedIsochrone } from "@/types/savedIsochrones";
import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import type { ParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";
import {
  computeSalesProjection,
  type ProjectionResult,
  type ComparableStore,
} from "@/services/salesProjectionService";

// ── Helpers de formato ────────────────────────────────────────────────────────

const fmtUF   = (v: number) => `${v.toFixed(1)} UF`;
const fmtCLP  = (v: number) => `$${new Intl.NumberFormat("es-CL").format(Math.round(v / 1_000_000))}M`;
const fmtPct  = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

// ── Subcomponentes ────────────────────────────────────────────────────────────

const Divider = () => <div className="border-t border-border/30 my-3" />;

function ComparableCard({ comp }: { comp: ComparableStore }) {
  const [expanded, setExpanded] = useState(false);
  const sim = Math.round((1 - comp.distanceScore) * 100);

  return (
    <div className="rounded-lg border border-border/30 bg-surface-2/30 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2/60"
      >
        <span className="flex-1 truncate text-[12px] font-medium text-foreground">{comp.name}</span>
        <span className="text-[11px] font-mono text-green-400">{fmtUF(comp.ufPerMonth)}/mes</span>
        <span className="text-[10px] text-muted-foreground ml-1">{sim}% sim.</span>
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        }
      </button>

      {expanded && comp.keyDiffs.length > 0 && (
        <div className="px-3 pb-2.5 space-y-1">
          <div className="text-[10px] text-muted-foreground mb-1.5">Diferencias vs este comparable:</div>
          {comp.keyDiffs.map((d) => (
            <div key={d.feature} className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{d.label}</span>
              <span className={[
                "font-mono",
                d.delta > 0 ? "text-green-400" : "text-red-400",
              ].join(" ")}>{fmtPct(d.delta)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  isochrone:   SavedIsochrone;
  folderId:    string;
  folderName:  string;
  isoAnalysis: IsochroneAnalysis | null;
  parque:      ParqueIsochroneStats | null;
  onClose:     () => void;
}

export const SalesProjectionPanel = ({
  isochrone,
  folderId,
  folderName,
  isoAnalysis,
  parque,
  onClose,
}: Props) => {
  const [result,  setResult]  = useState<ProjectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!isoAnalysis) {
      setError("Esperando datos del análisis territorial… Activa la isócrona en el mapa primero.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await computeSalesProjection({ folderId, isoAnalysis, parque });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [folderId, isoAnalysis, parque]);

  return (
    <div className="flex flex-col bg-background border border-border/40 rounded-xl shadow-xl overflow-hidden"
      style={{ width: 360, maxHeight: "80vh" }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-surface-1/60">
        <TrendingUp className="h-4 w-4 text-green-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-foreground truncate">
            Proyección de Potencial de Venta
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {folderName} · {isochrone.name}
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin space-y-3">

        {/* Estado inicial — botón de proyectar */}
        {!result && !loading && (
          <div className="space-y-3">
            <div className="rounded-lg bg-surface-2/40 p-3 text-[11px] text-muted-foreground space-y-1.5">
              <div className="font-medium text-foreground">Método: Comparables de la red</div>
              <div>Encuentra los {Math.min(5, 10)} locales {folderName} más similares por perfil territorial y promedia sus ventas reales.</div>
              <div className="flex gap-2 flex-wrap mt-1.5">
                {["Población", "NSE", "Ingresos", "Parque vehicular", "Atractores"].map(f => (
                  <span key={f} className="rounded bg-surface-3/60 px-1.5 py-0.5 text-[9px]">{f}</span>
                ))}
              </div>
            </div>

            {!isoAnalysis && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                Activa la isócrona en el mapa para cargar los datos territoriales.
              </div>
            )}

            <button
              onClick={run}
              disabled={!isoAnalysis || loading}
              className={[
                "w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[12px] font-semibold transition-all",
                isoAnalysis
                  ? "bg-green-600 hover:bg-green-500 text-white shadow-sm"
                  : "bg-surface-2/60 text-muted-foreground cursor-not-allowed",
              ].join(" ")}
            >
              <TrendingUp className="h-4 w-4" />
              Proyectar potencial de venta
            </button>
          </div>
        )}

        {/* Cargando */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-green-400" />
            <div className="text-[12px] text-muted-foreground text-center">
              Analizando comparables…<br />
              <span className="text-[10px]">Comparando con locales de la red</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2.5 text-[11px] text-red-400">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Resultado */}
        {result && !loading && (
          <div className="space-y-3">

            {/* KPIs principales */}
            <div className="rounded-xl bg-gradient-to-br from-green-900/20 to-emerald-900/10 border border-green-500/20 p-3">
              <div className="text-[10px] text-green-400/70 uppercase tracking-wider mb-1">
                Potencial de venta estimado · {result.currentYear}
              </div>
              <div className="text-[26px] font-bold text-green-400 leading-none">
                {fmtUF(result.estimatedUf)}
                <span className="text-[14px] font-normal text-green-400/70 ml-1">/mes</span>
              </div>
              <div className="text-[12px] text-muted-foreground mt-0.5">
                {fmtCLP(result.estimatedClp)}/mes
              </div>
              <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                <span>Rango:</span>
                <span className="text-foreground">{fmtUF(result.lowUf)}</span>
                <span>—</span>
                <span className="text-foreground">{fmtUF(result.highUf)}</span>
                <span className="text-[9px] ml-1">(p25–p75 de comparables)</span>
              </div>
            </div>

            {/* Factores clave */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Factores clave
              </div>
              <div className="space-y-1">
                {result.keyFactors.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className={[
                      "mt-0.5 h-2 w-2 rounded-full flex-shrink-0",
                      f.impact === "positive" ? "bg-green-400" :
                      f.impact === "negative" ? "bg-red-400" : "bg-muted-foreground",
                    ].join(" ")} />
                    <span className="text-foreground">{f.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <Divider />

            {/* Comparables */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Store className="h-3 w-3 inline mr-1" />
                  Comparables usados ({result.comparables.length} de {result.nWithSales} con ventas)
                </div>
              </div>
              <div className="space-y-1.5">
                {result.comparables.map((c) => (
                  <ComparableCard key={c.poiId} comp={c} />
                ))}
              </div>
            </div>

            <Divider />

            {/* Nota metodológica */}
            <div className="text-[9px] text-muted-foreground/60 leading-relaxed">
              Proyección basada en {result.comparables.length} locales {result.folderName} similares
              por perfil territorial (población, NSE, parque vehicular, atractores).
              No incluye factores de gestión, marketing ni estacionalidad.
              Año base: {result.baseYear}.
            </div>

            {/* Recalcular */}
            <button
              onClick={() => { setResult(null); setError(null); }}
              className="w-full text-[11px] text-muted-foreground hover:text-foreground py-1 transition-colors"
            >
              ↺ Nueva proyección
            </button>

          </div>
        )}
      </div>
    </div>
  );
};
