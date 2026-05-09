import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Map as MapIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { PoiFolder, SavedPoi } from "@/types/pois";
import type { AnalysisSettings } from "@/types/analysis";
import { useAnalysisSettings, useComplementRules } from "@/hooks/useAnalysisConfig";
import { usePoiFeaturesBatch } from "@/hooks/usePoiFeaturesBatch";

interface Props {
  open: boolean;
  onClose: () => void;
  folder: PoiFolder | null;
  /** POIs de esta carpeta. */
  pois: SavedPoi[];
  /** POIs de carpetas marcadas como competencia externa (resuelto en Index). */
  externalCompetitors: SavedPoi[];
  /** POIs en otras carpetas (= candidatos a complementario). */
  otherPois: SavedPoi[];
  /** Capas personalizadas competencia. */
  externalCompetitorLayerFeatures: Array<{ id: string; lng: number; lat: number; name: string; category?: string }>;
  /** Capas personalizadas complementarias. */
  complementaryLayerFeatures: Array<{ id: string; lng: number; lat: number; name: string; category?: string }>;
}

export const ComputeFeaturesDialog = ({
  open,
  onClose,
  folder,
  pois,
  externalCompetitors,
  otherPois,
  externalCompetitorLayerFeatures,
  complementaryLayerFeatures,
}: Props) => {
  const { settings } = useAnalysisSettings(folder?.id ?? null);
  const { rules } = useComplementRules(folder?.id ?? null);
  const batch = usePoiFeaturesBatch();
  const [skipCached, setSkipCached] = useState(true);
  const [forceFineCanni, setForceFineCanni] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) batch.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Computar settings efectivos
  const effectiveSettings: AnalysisSettings | null = useMemo(() => {
    if (!settings) return null;
    if (forceFineCanni == null) return settings;
    return { ...settings, use_fine_cannibalization: forceFineCanni };
  }, [settings, forceFineCanni]);

  // Estimación de tiempo
  const estimateMinutes = useMemo(() => {
    const useCanni = effectiveSettings?.use_fine_cannibalization ?? false;
    // Sin canibalización: 1 isócrona / POI = ~1.5s + overhead.
    // Con canibalización: 1 + N peers cercanos por POI ≈ media ~3-5 isos/POI.
    const isosPerPoi = useCanni ? 4 : 1;
    const totalIsos = pois.length * isosPerPoi;
    return Math.ceil((totalIsos * 1.7) / 60);
  }, [pois.length, effectiveSettings]);

  const handleRun = async () => {
    if (!folder || !effectiveSettings) return;
    await batch.run({
      folder,
      pois,
      settings: effectiveSettings,
      rules,
      externalCompetitors,
      otherPois,
      externalCompetitorLayerFeatures,
      complementaryLayerFeatures,
      skipCached,
    });
    if (batch.phase === "done") {
      toast.success(`Features calculadas para ${pois.length} POIs`);
    }
  };

  // Stats
  const rowsArr = Object.values(batch.rows);
  const okCount = rowsArr.filter((r) => r.status === "ok").length;
  const errCount = rowsArr.filter((r) => r.status === "error").length;
  const skippedCount = rowsArr.filter((r) => r.status === "skipped").length;
  const runningCount = rowsArr.filter((r) => r.status === "running").length;

  const isRunning = batch.phase === "running";
  const isDone = batch.phase === "done" || batch.phase === "cancelled";

  const noSettings = !settings;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isRunning && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/40 px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <MapIcon className="h-4 w-4" />
            Calcular features territoriales · {folder?.name ?? ""}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Para cada POI: calcula isócrona ({settings?.iso_minutes_rm ?? 5} min RM /
            {" "}{settings?.iso_minutes_regions ?? 7} min regiones) y extrae features
            (población, NSE, competencia, complementarios) usando manzanas Censo y
            polígonos GSE.
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin max-h-[calc(92vh-180px)] overflow-y-auto px-5 py-4">
          {noSettings ? (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              Esta carpeta no tiene configuración de análisis. Antes de
              calcular, abre <b>Configurar análisis…</b> y guarda al menos
              una vez.
            </div>
          ) : batch.phase === "idle" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <Stat value={String(pois.length)} label="POIs a calcular" />
                <Stat value={String(externalCompetitors.length)} label="Competidores externos" />
                <Stat
                  value={String(otherPois.length + complementaryLayerFeatures.length)}
                  label="Candidatos complementarios"
                />
              </div>

              <div className="rounded-lg bg-surface-2/40 p-3">
                <Label className="text-[11px]">Opciones</Label>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={skipCached}
                    onChange={(e) => setSkipCached(e.target.checked)}
                  />
                  Saltar POIs con caché válido (misma versión de configuración)
                </label>

                <div className="mt-3">
                  <Label className="text-[11px]">Canibalización fina (override)</Label>
                  <div className="mt-1 inline-flex rounded-lg bg-surface-3/50 p-0.5 text-[11px]">
                    {(
                      [
                        { id: null, label: "Usar config" },
                        { id: true, label: "Forzar ON" },
                        { id: false, label: "Forzar OFF" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={String(opt.id)}
                        onClick={() => setForceFineCanni(opt.id)}
                        className={[
                          "rounded-md px-2 py-0.5",
                          forceFineCanni === opt.id
                            ? "bg-surface-1 shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {effectiveSettings?.use_fine_cannibalization
                      ? "ON: pide isócronas de los peers internos cercanos para descontar área compartida (más preciso, ~3-4× más lento)."
                      : "OFF: cuenta competidores binariamente sin descuento espacial (más rápido)."}
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-surface-2/40 p-3 text-[11px] text-muted-foreground">
                <div>
                  <b>Tiempo estimado:</b> ~{estimateMinutes} min ({pois.length} POIs).
                  El throttle de OpenRouteService es ~40 req/min.
                </div>
                <div className="mt-1">
                  Puedes cerrar y volver: los POIs ya completados quedan en
                  caché. Si activas "Saltar caché", la próxima corrida solo
                  procesa los pendientes y los con configuración cambiada.
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border/40 pt-3">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={handleRun} disabled={!effectiveSettings || pois.length === 0}>
                  <Play className="mr-1.5 h-3 w-3" />
                  Iniciar
                </Button>
              </div>
            </div>
          ) : (
            // running / done / cancelled
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <Stat value={`${batch.progress.done}/${batch.progress.total}`} label="Progreso" />
                <Stat value={String(okCount)} label="Completados" color="green" />
                <Stat value={String(errCount)} label="Errores" color={errCount > 0 ? "red" : undefined} />
                <Stat value={String(skippedCount)} label="Saltados" />
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${
                      batch.progress.total
                        ? Math.round((batch.progress.done / batch.progress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-border/30">
                {rowsArr.map((r) => (
                  <RowItem key={r.poiId} row={r} />
                ))}
              </div>

              <div className="flex justify-between border-t border-border/40 pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => batch.reset()}
                  disabled={isRunning}
                >
                  <RotateCcw className="mr-1.5 h-3 w-3" />
                  Reiniciar
                </Button>
                <div className="flex gap-2">
                  {isRunning && (
                    <Button size="sm" variant="outline" onClick={batch.cancel}>
                      <Pause className="mr-1.5 h-3 w-3" />
                      Pausar
                    </Button>
                  )}
                  {isDone && (
                    <Button size="sm" onClick={onClose}>
                      Cerrar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Stat = ({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color?: "green" | "amber" | "red";
}) => {
  const colorClass =
    color === "green"
      ? "text-brand-green"
      : color === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : color === "red"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-xl bg-surface-2/60 px-3 py-2.5">
      <div className={`text-[16px] font-semibold leading-none tracking-tight ${colorClass}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
};

const Label = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`text-[11px] font-medium text-muted-foreground ${className}`}>{children}</div>
);

const RowItem = ({ row }: { row: ReturnType<typeof usePoiFeaturesBatch>["rows"][string] }) => {
  const StatusIcon = (() => {
    switch (row.status) {
      case "ok":
        return <CheckCircle2 className="h-3.5 w-3.5 text-brand-green" />;
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "running":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
      case "skipped":
        return <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <div className="h-3.5 w-3.5 rounded-full border border-border" />;
    }
  })();
  const isError = row.status === "error";
  const f = row.features;
  return (
    <div
      className={[
        "grid grid-cols-[20px_1fr_auto] items-start gap-2 border-b border-border/30 px-3 py-1.5 last:border-b-0",
        isError ? "bg-destructive/5" : "",
      ].join(" ")}
    >
      <div className="flex h-4 items-center">{StatusIcon}</div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium">{row.poiName}</div>
        {isError && row.message && (
          <div className="truncate text-[10px] text-destructive">{row.message}</div>
        )}
        {row.status === "ok" && f && (
          <div className="text-[10px] text-muted-foreground">
            pop {f.pop_total?.toLocaleString("es-CL")} · NSE alto {Math.round((f.nse_high_pct ?? 0) * 100)}% ·{" "}
            comp {f.n_competition_int}+{f.n_competition_ext} · ancla {f.n_anchors}
          </div>
        )}
      </div>
      {row.durationMs != null && (
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {(row.durationMs / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
};
