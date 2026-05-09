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
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  History,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { SavedPoi, PoiFolder } from "@/types/pois";
import type { PoiFolderSchema, PoiImportJob, PoiAddressAlias } from "@/types/poiMetrics";
import { usePoiImport } from "@/hooks/usePoiImport";
import { supabase } from "@/integrations/supabase/client";
import { fetchAliasesForPois } from "@/hooks/usePoiMetrics";

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
  const [filter, setFilter] = useState<
    "all" | "ok" | "review" | "auto" | "alias" | "skipped"
  >("all");
  const [history, setHistory] = useState<PoiImportJob[]>([]);
  const [assignedAliases, setAssignedAliases] = useState<PoiAddressAlias[]>([]);
  const [poisWithMetrics, setPoisWithMetrics] = useState<Set<string>>(new Set());
  const [showAssigned, setShowAssigned] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Reset al cerrar (no al ocultar temporalmente)
  useEffect(() => {
    if (!open) imp.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Carga historial + asignaciones existentes al abrir / cuando termina un import
  useEffect(() => {
    if (!open || !folder?.id) return;
    let cancel = false;
    setLoadingSummary(true);
    (async () => {
      const [jobsRes, metricsRes, aliasList] = await Promise.all([
        supabase
          .from("poi_import_jobs")
          .select("*")
          .eq("folder_id", folder.id)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("poi_metrics")
          .select("poi_id")
          .in("poi_id", folderPois.map((p) => p.id).length ? folderPois.map((p) => p.id) : ["00000000-0000-0000-0000-000000000000"]),
        fetchAliasesForPois(folderPois.map((p) => p.id)),
      ]);
      if (cancel) return;
      setHistory(((jobsRes.data ?? []) as unknown) as PoiImportJob[]);
      const set = new Set<string>();
      for (const r of (metricsRes.data ?? []) as Array<{ poi_id: string }>) set.add(r.poi_id);
      setPoisWithMetrics(set);
      setAssignedAliases(aliasList);
      setLoadingSummary(false);
    })();
    return () => {
      cancel = true;
    };
  }, [open, folder?.id, folderPois, imp.phase]);

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
    e.target.value = "";
  };

  const handleDeleteJob = async (job: PoiImportJob) => {
    if (
      !confirm(
        `¿Eliminar el import "${job.filename}"?\n\nSe borrarán las métricas y atributos guardados por este archivo (no se borran POIs ni aliases).`,
      )
    )
      return;
    const { error: mErr } = await supabase
      .from("poi_metrics")
      .delete()
      .eq("source_import_id", job.id);
    if (mErr) {
      alert(`Error eliminando métricas: ${mErr.message}`);
      return;
    }
    const { error: aErr } = await supabase
      .from("poi_attributes")
      .delete()
      .eq("source_import_id", job.id);
    if (aErr) {
      alert(`Error eliminando atributos: ${aErr.message}`);
      return;
    }
    const { error: jErr } = await supabase.from("poi_import_jobs").delete().eq("id", job.id);
    if (jErr) {
      alert(`Error eliminando el job: ${jErr.message}`);
      return;
    }
    // Refrescar resumen
    setHistory((prev) => prev.filter((j) => j.id !== job.id));
    onCommitSuccess?.();
  };

  const visibleMatches = useMemo(() => {
    if (!imp.parsed) return [];
    return imp.matches.filter((m) => {
      const isManual = !!imp.manualAssignments[m.rowIndex];
      const isSkipped = imp.skippedRows.has(m.rowIndex);
      const isOk = m.status === "auto_matched" || m.status === "alias_matched" || isManual;
      switch (filter) {
        case "all":
          return true;
        case "ok":
          return isOk && !isSkipped;
        case "review":
          return !isOk && !isSkipped;
        case "auto":
          return m.status === "auto_matched" && !isManual && !isSkipped;
        case "alias":
          return m.status === "alias_matched" && !isManual && !isSkipped;
        case "skipped":
          return isSkipped;
        default:
          return true;
      }
    });
  }, [imp.matches, imp.parsed, imp.manualAssignments, imp.skippedRows, filter]);

  return (
    <Dialog open={open && !hidden} onOpenChange={(o) => !o && !hidden && onClose()}>
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

        <div className="flex max-h-[calc(92vh-110px)] min-h-0 flex-col">
          {/* IDLE / PARSING / ERROR */}
          {imp.phase === "idle" || imp.phase === "parsing" || imp.phase === "error" ? (
            <div className="scrollbar-thin flex flex-1 flex-col overflow-y-auto">
              {imp.phase === "parsing" ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="text-[12px] text-muted-foreground">Leyendo planilla…</div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-center gap-3 px-6 py-8">
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
                  </div>

                  {/* Ya importado */}
                  <div className="border-t border-border/40 bg-surface-2/30 px-5 py-4">
                    <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <History className="h-3.5 w-3.5" />
                      Ya importado en esta carpeta
                    </div>

                    {loadingSummary ? (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Cargando resumen…
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <Stat value={poisWithMetrics.size.toString()} label="POIs con datos" />
                          <Stat value={assignedAliases.length.toString()} label="Direcciones asignadas" />
                          <Stat value={history.length.toString()} label="Imports previos" />
                        </div>

                        {history.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {history.map((j) => (
                              <div
                                key={j.id}
                                className="flex items-center justify-between gap-2 rounded-md bg-surface-3/40 px-2.5 py-1.5 text-[11px]"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium text-foreground">
                                    {j.filename}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {new Date(j.created_at).toLocaleString("es-CL")} ·{" "}
                                    {j.rows_total} filas · {j.rows_matched_auto + j.rows_matched_manual} ok
                                    {j.rows_unmatched > 0 ? ` · ${j.rows_unmatched} sin asignar` : ""}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={[
                                      "inline-flex h-4 items-center rounded px-1.5 text-[9px] font-medium uppercase tracking-wide",
                                      j.status === "completed"
                                        ? "bg-brand-green/15 text-brand-green"
                                        : j.status === "failed"
                                          ? "bg-destructive/15 text-destructive"
                                          : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                                    ].join(" ")}
                                  >
                                    {j.status}
                                  </span>
                                  <label
                                    className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border/40 bg-surface-2/60 px-1.5 text-[10px] text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                    title={
                                      j.rows_unmatched > 0
                                        ? `Re-subir el archivo para asignar las ${j.rows_unmatched} filas pendientes (las ya matcheadas se resuelven solas vía aliases)`
                                        : "Re-subir el archivo para continuar editando"
                                    }
                                  >
                                    <input
                                      type="file"
                                      accept=".xlsx,.xls"
                                      onChange={handleFile}
                                      className="hidden"
                                    />
                                    <RefreshCw className="h-2.5 w-2.5" />
                                    Continuar
                                  </label>
                                  <button
                                    onClick={() => handleDeleteJob(j)}
                                    className="inline-flex h-6 items-center gap-1 rounded-md border border-border/40 bg-surface-2/60 px-1.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                    title="Eliminar este import (borra sus métricas y atributos)"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {poisWithMetrics.size > 0 && (
                          <button
                            onClick={() => setShowAssigned((v) => !v)}
                            className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                          >
                            {showAssigned ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            {showAssigned ? "Ocultar" : "Ver"} POIs ya asignados ({poisWithMetrics.size})
                          </button>
                        )}

                        {showAssigned && poisWithMetrics.size > 0 && (
                          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/30 bg-surface-2/40 p-2">
                            {folderPois
                              .filter((p) => poisWithMetrics.has(p.id))
                              .map((p) => {
                                const aliases = assignedAliases.filter((a) => a.poi_id === p.id);
                                return (
                                  <div
                                    key={p.id}
                                    className="rounded px-2 py-1.5 text-[11px] hover:bg-surface-3/40"
                                  >
                                    <div className="flex items-center gap-1 font-medium">
                                      <MapPin className="h-3 w-3 text-primary" />
                                      <span className="truncate">{p.name}</span>
                                    </div>
                                    {aliases.length > 0 && (
                                      <div className="mt-0.5 pl-4 text-[10px] text-muted-foreground">
                                        {aliases.length} dirección{aliases.length === 1 ? "" : "es"}:{" "}
                                        {aliases.slice(0, 2).map((a) => a.raw_address ?? a.normalized_address).join(" · ")}
                                        {aliases.length > 2 ? ` · +${aliases.length - 2}` : ""}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        )}

                        {history.length === 0 && poisWithMetrics.size === 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            Aún no se ha importado ningún archivo en esta carpeta.
                          </div>
                        )}
                      </>
                    )}
                  </div>
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
            <div className="flex min-h-0 flex-1 flex-col">
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
