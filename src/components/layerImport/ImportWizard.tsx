import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ClipboardCopy, FileUp, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useImportWizard } from "@/hooks/useImportWizard";
import type { ImportMode, ImportResult } from "@/services/layerImport";
import type { LayerNode } from "@/types/layerNodes";
import { cn } from "@/lib/utils";
import { analyzeTree, resolveToggle, type TreeRow } from "@/utils/layerTree";
import { allFoldersOpen, destinationOptions, docToTreeRows, groupIssues, includedLayerKeys, previewItems } from "@/utils/importWizard";
import { collectLayerIds } from "@/utils/layerTree";
import { LayerTree } from "@/components/layerTree/LayerTree";
import { copyText } from "@/utils/clipboard";
import { buildErrorReport, issuesText } from "@/utils/importErrorReport";
import { importFormatOf } from "@/utils/importParser";
import { ImportErrorPanel } from "./ImportErrorPanel";
import { DestinationPicker } from "./DestinationPicker";
import { ImportDiffPanel } from "./ImportDiffPanel";
import { ImportPreviewMap } from "./ImportPreviewMap";

interface Props {
  file: File;
  initialMode?: ImportMode;
  /** Carpeta (importación nueva) o capa (reemplazar/agregar) sobre la que se soltó el archivo. */
  initialTargetId?: string | null;
  /** Todos los nodos del árbol (para elegir destino). */
  nodes: readonly LayerNode[];
  onClose: () => void;
  /** Ya se escribió en la base: hay que refrescar el árbol y el mapa. */
  onImported: (result: ImportResult) => void;
}

const MODES: { id: ImportMode; title: string; hint: string }[] = [
  { id: "new", title: "Nueva capa", hint: "Crea las carpetas y capas del archivo, en el mismo orden." },
  { id: "replace", title: "Reemplazar una capa", hint: "Deja la capa igual al archivo; antes muestra qué se agrega, se elimina y se modifica." },
  { id: "append", title: "Agregar a una capa", hint: "Suma lo nuevo y actualiza lo que cambió; nunca elimina nada." },
];

const n = (v: number) => v.toLocaleString("es-CL");
const noop = () => undefined;

/**
 * Asistente de importación: lee el archivo en el navegador, muestra su árbol de carpetas (con
 * casillas para excluir partes) y un mapa de vista previa, deja elegir cómo y dónde importar y,
 * si se actualiza una capa existente, muestra el diff antes de confirmar. Lo escribe todo en
 * una sola transacción y deja deshacerlo.
 */
export const ImportWizard = ({ file, initialMode = "new", initialTargetId = null, nodes, onClose, onImported }: Props) => {
  const w = useImportWizard({ file, initialMode, initialTargetId, onCommitted: onImported });
  const { doc } = w;
  const [confirmRevert, setConfirmRevert] = useState(false);
  const diffRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => (doc ? docToTreeRows(doc) : []), [doc]);
  const included = useMemo(() => (doc ? includedLayerKeys(doc, w.excluded) : new Set<string>()), [doc, w.excluded]);
  const analysis = useMemo(() => analyzeTree(rows, included), [rows, included]);
  const openState = useMemo(() => (doc ? allFoldersOpen(doc) : {}), [doc]);
  const items = useMemo(() => (doc ? previewItems(doc, w.excluded) : { items: [], total: 0 }), [doc, w.excluded]);
  const issueGroups = useMemo(() => (doc ? groupIssues(doc.issues) : []), [doc]);
  const options = useMemo(() => destinationOptions(nodes, w.mode === "new" ? "folder" : "layer"), [nodes, w.mode]);
  const targetName = options.find((o) => o.id === w.target)?.name;
  const [issuesCopied, setIssuesCopied] = useState(false);

  // Todo fallo se explica: paso, causa, solución y un mensaje listo para pegar en el chat.
  const report = useMemo(
    () =>
      w.failure
        ? buildErrorReport(w.failure.error, {
            stage: w.failure.stage,
            filename: file.name,
            format: doc?.format ?? importFormatOf(file.name),
            mode: w.failure.stage === "read" ? null : w.mode,
            targetName,
            counts: doc?.counts ?? null,
            included: w.localSummary ? { layers: w.localSummary.layers, features: w.localSummary.features } : null,
            maxRows: w.maxRows,
            rowsToWrite: w.rowsToWrite,
            batchId: w.batchId,
          })
        : null,
    [w.failure, w.mode, w.localSummary, w.maxRows, w.rowsToWrite, w.batchId, doc, file, targetName],
  );

  const onToggle = (row: TreeRow) => {
    const res = resolveToggle(row, analysis.states.get(row.id) ?? "unchecked", included);
    w.toggleLayers(res.ids.length ? res.ids : collectLayerIds(row), res.visible);
  };

  // El diff es lo que hay que revisar antes de confirmar: cuando llega, se lleva a la vista.
  useEffect(() => {
    if (w.preview) diffRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [w.preview]);

  const busy = w.phase === "working";
  const done = w.phase === "done" && w.result;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="z-[1300] flex max-h-[90vh] max-w-5xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <FileUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate">Importar “{file.name}”</span>
          </DialogTitle>
          <DialogDescription>
            {doc
              ? `${n(doc.counts.folders)} carpetas · ${n(doc.counts.layers)} capas · ${n(doc.counts.features)} puntos`
              : "Leyendo el archivo…"}
          </DialogDescription>
        </DialogHeader>

        {w.phase === "parsing" && (
          <p className="flex items-center gap-2 py-10 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Leyendo el archivo…
          </p>
        )}

        {w.phase === "error" && !doc && (
          <div className="space-y-3 py-4">
            {report && <ImportErrorPanel report={report} />}
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        )}

        {doc && done && (
          <div className="space-y-4 py-4" data-testid="import-done">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-400" />
              <div className="space-y-1 text-[13px]">
                {w.reverted ? (
                  <p className="font-medium">La importación se deshizo.</p>
                ) : w.result!.mode === "new" ? (
                  <>
                    <p className="font-medium">Listo: se crearon {n(w.result!.layers ?? 0)} capas en {n(w.result!.folders ?? 0)} carpetas.</p>
                    <p className="text-muted-foreground">{n(w.result!.features)} puntos importados. Ya están en el árbol de capas.</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Listo: “{targetName ?? "la capa"}” quedó con {n(w.result!.features)} puntos.</p>
                    <p className="text-muted-foreground">
                      {n(w.result!.added ?? 0)} agregados · {n(w.result!.modified ?? 0)} modificados
                      {w.mode === "replace" ? ` · ${n(w.result!.removed ?? 0)} eliminados` : ""} · {n(w.result!.unchanged ?? 0)} sin cambio.
                    </p>
                  </>
                )}
              </div>
            </div>
            {report && <ImportErrorPanel report={report} />}
            <div className="flex gap-2">
              {!w.reverted &&
                (confirmRevert ? (
                  <>
                    <Button variant="destructive" size="sm" onClick={async () => (await w.undo()) && setConfirmRevert(false)}>
                      Sí, deshacer la importación
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRevert(false)}>
                      No
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setConfirmRevert(true)}>
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Deshacer importación
                  </Button>
                ))}
              <Button size="sm" onClick={onClose} className="ml-auto">
                Cerrar
              </Button>
            </div>
          </div>
        )}

        {doc && !done && (
          <>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[320px_1fr]">
              {/* Izquierda: lo que trae el archivo */}
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">Contenido del archivo</p>
                  <p className="mb-1 text-[11px] text-muted-foreground">Desmarca lo que no quieras importar.</p>
                  <div className="rounded-lg border border-border/60 p-1">
                    <LayerTree
                      roots={rows}
                      analysis={analysis}
                      searchTerm=""
                      initialOpenState={openState}
                      onToggleCheck={onToggle}
                      onOpenPoi={noop}
                      onLoadMore={noop}
                      onEditStyle={noop}
                      onResetStyle={noop}
                      hideMenu
                    />
                  </div>
                </div>

                {issueGroups.length > 0 && (
                  <div className="space-y-1" data-testid="import-issues">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-wide text-text-muted">Avisos del archivo</p>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={async () => {
                          setIssuesCopied(await copyText(issuesText(doc.filename, doc.issues)));
                          setTimeout(() => setIssuesCopied(false), 2500);
                        }}
                      >
                        <ClipboardCopy className="h-3 w-3" />
                        {issuesCopied ? "Copiado" : "Copiar avisos"}
                      </button>
                    </div>
                    {issueGroups.map((g) => (
                      <details key={g.kind} className="rounded-lg border border-border/60 px-2 py-1 text-[11px]" open={g.kind === "invalid-geometry"}>
                        <summary className={cn("flex cursor-pointer items-center gap-1", g.kind === "invalid-geometry" ? "text-amber-300" : "text-muted-foreground")}>
                          <ChevronDown className="h-3 w-3" /> {g.title} · {n(g.count)}
                        </summary>
                        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pl-4 text-text-muted">
                          {g.items.slice(0, 50).map((i, idx) => (
                            <li key={idx}>
                              {i.name ? <b className="text-muted-foreground">{i.name}</b> : null}
                              {i.name ? " — " : ""}
                              {i.reason}
                              {i.path.length ? <span className="text-[10px]"> ({i.path.join(" › ")})</span> : null}
                            </li>
                          ))}
                          {g.items.length > 50 && <li>… y {n(g.items.length - 50)} más</li>}
                        </ul>
                      </details>
                    ))}
                  </div>
                )}
              </div>

              {/* Derecha: mapa, modo y destino */}
              <div className="min-w-0 space-y-3">
                <div className="h-44 overflow-hidden rounded-lg border border-border/60" aria-label="Vista previa en el mapa">
                  <ImportPreviewMap items={items.items} />
                </div>
                {items.total > items.items.length && (
                  <p className="-mt-2 text-[10px] text-text-muted">Vista previa con una muestra de {n(items.items.length)} de {n(items.total)} puntos.</p>
                )}

                <fieldset disabled={busy}>
                  <legend className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">Cómo importar</legend>
                  <div className="grid grid-cols-3 gap-1.5">
                    {MODES.map((m) => (
                      <label
                        key={m.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12px] font-medium",
                          w.mode === m.id ? "border-primary bg-primary/10" : "border-border/60 hover:bg-surface-2/60",
                        )}
                      >
                        <input type="radio" name="import-mode" checked={w.mode === m.id} onChange={() => w.setMode(m.id)} />
                        {m.title}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{MODES.find((m) => m.id === w.mode)?.hint}</p>
                </fieldset>

                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">
                    {w.mode === "new" ? "Dentro de la carpeta" : w.mode === "replace" ? "Capa a reemplazar" : "Capa a la que agregar"}
                  </p>
                  <DestinationPicker
                    options={options}
                    value={w.target}
                    onChange={w.setTarget}
                    rootLabel={w.mode === "new" ? "En la raíz (se crea una carpeta con el nombre del archivo)" : undefined}
                    placeholder={w.mode === "new" ? "Buscar carpeta…" : "Buscar capa…"}
                  />
                </div>

                <div ref={diffRef}>
                <ImportDiffPanel
                  mode={w.mode}
                  local={w.localSummary}
                  preview={w.preview}
                  previewing={w.previewing}
                  rowsToWrite={w.rowsToWrite}
                  maxRows={w.maxRows}
                  needsTarget={w.mode !== "new" && !w.target}
                />
                </div>
              </div>
            </div>

            {w.progress && (
              <div className="space-y-1" role="status">
                <Progress value={(w.progress.done / Math.max(1, w.progress.total)) * 100} />
                <p className="text-[11px] text-muted-foreground">
                  Subiendo {n(w.progress.done)} de {n(w.progress.total)} puntos…
                </p>
              </div>
            )}
            {w.limitsWarning && <p className="text-[11px] text-amber-300">{w.limitsWarning}</p>}
            {report && <ImportErrorPanel report={report} />}

            <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={() => void w.confirm()} disabled={!w.canConfirm || busy}>
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Importando…
                  </>
                ) : w.mode === "new" ? (
                  "Importar"
                ) : w.mode === "replace" ? (
                  "Reemplazar capa"
                ) : (
                  "Agregar a la capa"
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
