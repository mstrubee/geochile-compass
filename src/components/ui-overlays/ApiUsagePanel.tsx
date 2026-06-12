/**
 * ApiUsagePanel — Collapsible overlay (top-left) showing Google Maps API consumption,
 * provider selector, and usage bars. Mirrors the AnalysisPanel collapse pattern.
 */
import { useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Map, TriangleAlert } from "lucide-react";
import type { MapProvider } from "@/hooks/useMapProvider";
import { PROVIDER_LIMITS, THRESHOLD_WARN, THRESHOLD_CRITICAL } from "@/hooks/useMapProvider";

interface UsageStat {
  count: number;
  limit: number;
  pct: number;
}

interface Props {
  provider: MapProvider;
  onProviderChange: (p: MapProvider) => void;
  usage: {
    sessions: UsageStat;
    tiles: UsageStat;
    geocoding: UsageStat;
    places: UsageStat;
    cycleStart: Date;
  };
  hasGoogleKey: boolean;
  isLimitReached: (s: keyof typeof PROVIDER_LIMITS) => boolean;
}

const fmt = (n: number) => n.toLocaleString("es-CL");

const pctColor = (pct: number): string => {
  if (pct >= THRESHOLD_CRITICAL) return "bg-destructive";
  if (pct >= THRESHOLD_WARN) return "bg-brand-yellow";
  return "bg-brand-green";
};

const pctTextColor = (pct: number): string => {
  if (pct >= THRESHOLD_CRITICAL) return "text-destructive";
  if (pct >= THRESHOLD_WARN) return "text-brand-yellow";
  return "text-brand-green";
};

const UsageBar = ({ label, stat }: { label: string; stat: UsageStat }) => (
  <div className="space-y-0.5">
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-text-muted">{label}</span>
      <span className={pctTextColor(stat.pct)}>
        {fmt(stat.count)} / {fmt(stat.limit)}
        <span className="ml-1 font-medium">({Math.round(stat.pct * 100)}%)</span>
      </span>
    </div>
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div
        className={`h-full rounded-full transition-all ${pctColor(stat.pct)}`}
        style={{ width: `${Math.round(stat.pct * 100)}%` }}
      />
    </div>
  </div>
);

export const ApiUsagePanel = ({
  provider,
  onProviderChange,
  usage,
  hasGoogleKey,
  isLimitReached,
}: Props) => {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("api_usage_panel_v1") !== "closed"; } catch { return true; }
  });

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem("api_usage_panel_v1", next ? "open" : "closed"); } catch { /* ignore */ }
      return next;
    });
  };

  const cycleEnd = new Date(usage.cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);
  const daysLeft = Math.max(
    0,
    Math.ceil((cycleEnd.getTime() - Date.now()) / 86_400_000),
  );

  const sessionLimitReached = isLimitReached("sessions");
  const anyWarning = usage.sessions.pct >= THRESHOLD_WARN;

  return (
    <div className="pointer-events-none absolute left-0 top-[120px] z-[500] flex items-start">
      {/* Tab handle */}
      <button
        type="button"
        onClick={toggle}
        className={[
          "pointer-events-auto flex h-9 w-5 items-center justify-center rounded-r-lg border border-l-0 border-border/60 shadow-apple-sm transition-colors",
          anyWarning
            ? "bg-brand-yellow/20 border-brand-yellow/40 text-brand-yellow"
            : "bg-surface/80 text-text-muted hover:bg-surface-2 hover:text-foreground",
          "backdrop-blur-2xl",
        ].join(" ")}
        aria-label={open ? "Colapsar panel de consumo" : "Expandir panel de consumo"}
      >
        {open ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {/* Panel body */}
      {open && (
        <div className="pointer-events-auto ml-0 w-[240px] rounded-r-2xl border border-l-0 border-border/60 bg-surface/90 p-3 shadow-apple backdrop-blur-2xl backdrop-saturate-150">
          {/* Header */}
          <div className="mb-2 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-semibold text-foreground">Consumo APIs</span>
            {anyWarning && (
              <TriangleAlert className="ml-auto h-3.5 w-3.5 text-brand-yellow" />
            )}
          </div>

          {/* Provider selector */}
          <div className="mb-3 flex gap-1.5">
            <button
              type="button"
              disabled={!hasGoogleKey || sessionLimitReached}
              onClick={() => onProviderChange("google")}
              title={
                !hasGoogleKey
                  ? "Configura VITE_GOOGLE_MAPS_KEY para activar Google Maps"
                  : sessionLimitReached
                    ? "Límite mensual alcanzado"
                    : undefined
              }
              className={[
                "flex flex-1 items-center justify-center gap-1 rounded-lg border py-1 text-[10px] font-medium transition-all",
                provider === "google"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/60 bg-surface-2/60 text-text-muted hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
              ].join(" ")}
            >
              <Map className="h-3 w-3" />
              Google Maps
            </button>
            <button
              type="button"
              onClick={() => onProviderChange("osm")}
              className={[
                "flex flex-1 items-center justify-center gap-1 rounded-lg border py-1 text-[10px] font-medium transition-all",
                provider === "osm"
                  ? "border-brand-green/60 bg-brand-green/10 text-brand-green"
                  : "border-border/60 bg-surface-2/60 text-text-muted hover:bg-surface-3 hover:text-foreground",
              ].join(" ")}
            >
              <Map className="h-3 w-3" />
              OpenStreetMap
            </button>
          </div>

          {/* Provider status */}
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-surface-2/60 px-2 py-1">
            <span
              className={`h-1.5 w-1.5 animate-blink rounded-full ${provider === "google" ? "bg-primary" : "bg-brand-green"}`}
            />
            <span className="text-[10px] text-muted-foreground">
              Activo:{" "}
              <span className="font-medium text-foreground">
                {provider === "google" ? "Google Maps" : "OpenStreetMap"}
              </span>
            </span>
          </div>

          {provider === "google" && (
            <>
              <div className="mb-2 space-y-2">
                <UsageBar label="Sesiones de mapa" stat={usage.sessions} />
                <UsageBar label="Tiles cargados" stat={usage.tiles} />
                <UsageBar label="Geocodificación" stat={usage.geocoding} />
                <UsageBar label="Places / Autocomplete" stat={usage.places} />
              </div>

              {/* Cycle info */}
              <div className="border-t border-border/40 pt-2 text-[10px] text-text-muted">
                <div className="flex justify-between">
                  <span>Ciclo desde</span>
                  <span className="text-foreground">
                    {usage.cycleStart.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Días restantes</span>
                  <span className="text-foreground">{daysLeft}</span>
                </div>
              </div>

              {/* Alerts */}
              {sessionLimitReached && (
                <div className="mt-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
                  Límite de sesiones alcanzado. Cambiando a OpenStreetMap automáticamente.
                </div>
              )}
              {!sessionLimitReached && usage.sessions.pct >= THRESHOLD_CRITICAL && (
                <div className="mt-2 rounded-lg bg-brand-yellow/10 px-2 py-1.5 text-[10px] text-brand-yellow">
                  El consumo de Google Maps ha alcanzado el{" "}
                  {Math.round(usage.sessions.pct * 100)}% del límite mensual.
                </div>
              )}
              {!sessionLimitReached && usage.sessions.pct >= THRESHOLD_WARN && usage.sessions.pct < THRESHOLD_CRITICAL && (
                <div className="mt-2 rounded-lg bg-primary/10 px-2 py-1.5 text-[10px] text-primary">
                  Consumo de Google Maps al {Math.round(usage.sessions.pct * 100)}% del límite.
                </div>
              )}
            </>
          )}

          {provider === "osm" && (
            <p className="text-[10px] text-text-muted">
              OpenStreetMap activo — sin límites de consumo.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
