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
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Search,
  X,
} from "lucide-react";
import type { SavedPoi, PoiFolder } from "@/types/pois";
import type { PoiFolderSchema } from "@/types/poiMetrics";
import { usePoiImport } from "@/hooks/usePoiImport";

interface Props {
  open: boolean;
  onClose: () => void;
  folder: PoiFolder | null;
  schema: PoiFolderSchema | null;
  folderPois: SavedPoi[];
  /** Activa el modo "elegir POI en el mapa" para una fila concreta. */
  onPickPoiOnMap: (
    rowIndex: number,
    candidates: Array<{ poiId: string; name: string; distanceMeters: number }>,
  ) => void;
  /** El poi elegido externamente para una fila (si el padre lo proveyó). */
  externalManualSelection: { rowIndex: number; poiId: string } | null;
  onConsumeExternalSelection: () => void;
  /** Notifica al padre que el commit fue exitoso para refrescar datos. */
  onCommitSuccess?: () => void;
  /** Oculta visualmente el modal sin resetear su estado (p.ej. mientras se elige POI en el mapa). */
  hidden?: boolean;
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");

export const PoiImportDialog = ({
  open,
  onClose,
  folder,
  schema,
  folderPois,
  onPickPoiOnMap,
  externalManualSelection,
  onConsumeExternalSelection,
  onCommitSuccess,
  hidden = false,
}: Props) => {
  const imp = usePoiImport({
    schema,
    folderId: folder?.id ?? null,
    folderPois,
  });
  const [filter, setFilter] = useState<"all" | "ok" | "review">("all");

  // Reset al cerrar (no al ocultar temporalmente)
  useEffect(() => {
    if (!open) imp.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Aplica selección externa cuando llega
  useEffect(() => {
    if (externalManualSelection) {
      imp.assignManual(externalManualSelection.rowIndex, externalManualSelection.poiId);
      onConsumeExternalSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalManualSelection]);

  useEffect(() => {
    if (imp.phase === "done") onCommitSuccess?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp.phase]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await imp.parse(f);
  };

  const visibleMatches = useMemo(() => {
    if (!imp.parsed) return [];
    return imp.matches.filter((m) => {
      if (filter === "all") return true;
      const isOk =
        m.status === "auto_matched" ||
        m.status === "alias_matched" ||
        !!imp.manualAssignments[m.rowIndex];
      return filter === "ok" ? isOk : !isOk;
    });
  }, [imp.matches, imp.parsed, imp.manualAssignments, filter]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border/40 px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <FileSpreadsheet className="h-4 w-4" />
            Importar Excel · {folder?.name ?? "Carpeta"}
          </DialogTitle>
          {schema && (
            <DialogDescription className="text-[11px] text-muted-foreground">
              Esquema: {schema.schema_type} · Métricas:{" "}
              {schema.metric_definitions.map((m) => m.label).join(", ")}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex max-h-[calc(92vh-110px)] flex-col">
          {/* IDLE / PARSING / ERROR */}
          {imp.phase === "idle" || imp.phase === "parsing" || imp.phase === "error" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10">
              {imp.phase === "parsing" ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="text-[12px] text-muted-foreground">Leyendo planilla…</div>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50" />
                  <div className="max-w-md text-center text-[12px] text-muted-foreground">
                    Sube un archivo Excel con las ventas históricas.
                    {schema && (
                      <div className="mt-2">
                        Se esperan las columnas:{" "}
                        <span className="font-mono text-foreground">
                          {schema.identity_columns.join(", ")}
                        </span>{" "}
                        y columnas mensuales (fechas) con los valores de{" "}
                        <span className="text-foreground">
                          {schema.metric_definitions[0]?.label}
                        </span>
                        .
                      </div>
                    )}
                  </div>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFile}
                      className="hidden"
                    />
                    <span className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
                      Seleccionar archivo
                    </span>
                  </label>
                  {imp.error && (
                    <div className="mt-2 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                      {imp.error}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}

          {/* PARSED — pantalla previa al matching */}
          {imp.phase === "parsed" && imp.parsed && (
            <div className="flex flex-1 flex-col">
              <div className="px-5 py-4">
                <div className="grid grid-cols-3 gap-2">
                  <Stat value={imp.parsed.rows.length.toString()} label="Filas detectadas" />
                  <Stat
                    value={imp.parsed.periods.length.toString()}
                    label="Períodos mensuales"
                  />
                  <Stat
                    value={imp.parsed.metricKeys.join(", ")}
                    label="Métricas"
                  />
                </div>
                {imp.parsed.unknownColumns.length > 0 && (
                  <div className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                    Columnas desconocidas (se ignorarán):{" "}
                    {imp.parsed.unknownColumns.join(", ")}
                  </div>
                )}
                <div className="mt-4 rounded-md bg-surface-2/40 px-3 py-3 text-[11px] text-muted-foreground">
                  El siguiente paso geocodifica cada dirección con Nominatim
                  (OpenStreetMap). Toma aproximadamente <strong>1 segundo por
                  dirección</strong>, así que con {imp.parsed.rows.length} filas
                  tomará ~{Math.ceil(imp.parsed.rows.length * 1.1)}s. Las direcciones
                  se cachean entre intentos.
                </div>
              </div>
              <div className="mt-auto flex justify-end gap-2 border-t border-border/40 bg-surface-2/40 px-5 py-3">
                <Button variant="outline" size="sm" onClick={imp.reset}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => imp.runMatching()}>
                  Iniciar matching
                </Button>
              </div>
            </div>
          )}

          {/* MATCHING / COMMITTING — progreso */}
          {(imp.phase === "matching" || imp.phase === "committing") && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-[12px] text-muted-foreground">{imp.progressMsg}</div>
              <div className="h-1.5 w-72 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round(imp.progressFrac * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* REVIEW — tabla con filtros */}
          {imp.phase === "review" && imp.parsed && (
            <div className="flex flex-1 flex-col">
              <div className="border-b border-border/40 px-5 py-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Stat
                    value={(imp.stats.auto + imp.stats.alias + imp.stats.manualAssigned).toString()}
                    label="Listas para guardar"
                    color="green"
                  />
                  <Stat value={imp.stats.auto.toString()} label="Auto-matched" />
                  <Stat value={imp.stats.alias.toString()} label="Por alias" />
                  <Stat
                    value={imp.stats.pending.toString()}
                    label="Pendientes"
                    color="amber"
                  />
                  <Stat value={imp.stats.skipped.toString()} label="Omitidas" />
                </div>
                <div className="mt-3 inline-flex rounded-lg bg-surface-2/60 p-0.5">
                  {(["all", "ok", "review"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={[
                        "rounded-md px-3 py-1 text-[11px] font-medium transition-all",
                        filter === f
                          ? "bg-surface-3 text-foreground shadow-apple-sm"
                          : "text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      {f === "all" ? "Todas" : f === "ok" ? "Resueltas" : "Por resolver"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="scrollbar-thin flex-1 overflow-y-auto">
                {visibleMatches.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-[11px] text-muted-foreground">
                    No hay filas en este filtro.
                  </div>
                ) : (
                  <div className="divide-y divide-border/30">
                    {visibleMatches.map((m) => {
                      const row = imp.parsed!.rows.find((r) => r.rowIndex === m.rowIndex);
                      if (!row) return null;
                      const manualPoi = imp.manualAssignments[m.rowIndex];
                      const isResolved =
                        !!manualPoi ||
                        m.status === "auto_matched" ||
                        m.status === "alias_matched";
                      const skipped = imp.skippedRows.has(m.rowIndex);

                      return (
                        <RowItem
                          key={m.rowIndex}
                          rowName={row.identity["Nombre Local"] ?? row.identity["Local"] ?? "Sin nombre"}
                          rowAddress={`${row.rawAddress}${row.comuna ? ` · ${row.comuna}` : ""}`}
                          status={m.status}
                          assignedName={
                            manualPoi
                              ? folderPois.find((p) => p.id === manualPoi)?.name ?? "—"
                              : m.assignedPoiId
                                ? folderPois.find((p) => p.id === m.assignedPoiId)?.name ?? "—"
                                : null
                          }
                          distance={m.distanceMeters}
                          metricsPreview={`${row.metrics.length} períodos`}
                          isResolved={isResolved}
                          skipped={skipped}
                          isManual={!!manualPoi}
                          onPick={() => onPickPoiOnMap(m.rowIndex, m.candidates)}
                          onClearManual={() => imp.clearManual(m.rowIndex)}
                          onToggleSkip={() => imp.toggleSkip(m.rowIndex)}
                          candidates={m.candidates}
                          onChooseCandidate={(poiId) => imp.assignManual(m.rowIndex, poiId)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border/40 bg-surface-2/40 px-5 py-3">
                <div className="text-[11px] text-muted-foreground">
                  {imp.stats.pending > 0
                    ? `Quedan ${imp.stats.pending} pendientes (puedes igual continuar y omitirlas).`
                    : "Todas las filas resueltas."}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={imp.reset}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={imp.commit}
                    disabled={imp.stats.auto + imp.stats.alias + imp.stats.manualAssigned === 0}
                  >
                    Guardar {imp.stats.auto + imp.stats.alias + imp.stats.manualAssigned} filas
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* DONE */}
          {imp.phase === "done" && imp.commitResult && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10">
              <CheckCircle2 className="h-12 w-12 text-brand-green" />
              <div className="text-[14px] font-medium">Importación completada</div>
              <div className="grid grid-cols-3 gap-2">
                <Stat value={fmt(imp.commitResult.metricsInserted)} label="Métricas guardadas" />
                <Stat value={fmt(imp.commitResult.attributesUpserted)} label="Atributos actualizados" />
                <Stat value={fmt(imp.commitResult.aliasesCreated)} label="Aliases nuevos" />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {imp.commitResult.rowsCommitted} filas comprometidas ·{" "}
                {imp.commitResult.rowsSkipped} omitidas
              </div>
              <Button size="sm" onClick={onClose}>
                Cerrar
              </Button>
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

interface RowItemProps {
  rowName: string;
  rowAddress: string;
  status: string;
  assignedName: string | null;
  distance: number | null;
  metricsPreview: string;
  isResolved: boolean;
  skipped: boolean;
  isManual: boolean;
  candidates: Array<{ poiId: string; name: string; distanceMeters: number }>;
  onPick: () => void;
  onClearManual: () => void;
  onToggleSkip: () => void;
  onChooseCandidate: (poiId: string) => void;
}

const STATUS_TAG: Record<string, { label: string; cls: string }> = {
  auto_matched: { label: "Auto", cls: "bg-brand-green/15 text-brand-green" },
  alias_matched: { label: "Alias", cls: "bg-primary/15 text-primary" },
  needs_review: { label: "Revisar", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  no_geocode: { label: "Sin geo", cls: "bg-destructive/15 text-destructive" },
  manual_assigned: { label: "Manual", cls: "bg-primary/15 text-primary" },
};

const RowItem = ({
  rowName,
  rowAddress,
  status,
  assignedName,
  distance,
  metricsPreview,
  isResolved,
  skipped,
  isManual,
  candidates,
  onPick,
  onClearManual,
  onToggleSkip,
  onChooseCandidate,
}: RowItemProps) => {
  const tag = STATUS_TAG[isManual ? "manual_assigned" : status] ?? STATUS_TAG.needs_review;
  return (
    <div
      className={[
        "px-5 py-3 transition-opacity",
        skipped ? "opacity-50" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-medium">{rowName}</span>
            <span
              className={`inline-flex h-4 items-center rounded px-1.5 text-[9px] font-medium uppercase tracking-wide ${tag.cls}`}
            >
              {tag.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {rowAddress}
          </div>
          {assignedName && (
            <div className="mt-1 flex items-center gap-1 text-[11px]">
              <MapPin className="h-3 w-3 text-primary" />
              <span className="truncate">→ {assignedName}</span>
              {distance != null && distance < Infinity && (
                <span className="text-muted-foreground">
                  · {Math.round(distance)} m
                </span>
              )}
            </div>
          )}
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {metricsPreview}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {!isResolved && !skipped && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={onPick}
            >
              <MapPin className="mr-1 h-3 w-3" />
              Elegir en mapa
            </Button>
          )}
          {isManual && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={onClearManual}
            >
              Deshacer
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={onToggleSkip}
          >
            <X className="mr-1 h-3 w-3" />
            {skipped ? "Restaurar" : "Omitir"}
          </Button>
        </div>
      </div>
      {/* Sugerencias inline si las hay y no está resuelta */}
      {!isResolved && !skipped && candidates.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {candidates.slice(0, 3).map((c) => (
            <button
              key={c.poiId}
              onClick={() => onChooseCandidate(c.poiId)}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border/40 bg-surface-3/50 px-2 text-[10px] text-muted-foreground hover:bg-primary/10 hover:text-primary"
            >
              <Search className="h-2.5 w-2.5" />
              <span className="max-w-[160px] truncate">{c.name}</span>
              {c.distanceMeters < Infinity && (
                <span className="font-mono text-[9px]">{Math.round(c.distanceMeters)}m</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
