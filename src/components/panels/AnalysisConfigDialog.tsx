import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  AlertTriangle,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import type { PoiFolder } from "@/types/pois";
import { useAnalysisSettings, useUfMap, useComplementRules } from "@/hooks/useAnalysisConfig";

interface Props {
  open: boolean;
  onClose: () => void;
  folder: PoiFolder | null;
  /** Todas las carpetas POI disponibles, para el picker de competencia externa. */
  allFolders: PoiFolder[];
  /** Todas las capas personalizadas, para el picker de competencia externa. */
  allLayers: Array<{ id: string; name: string }>;
  /** Períodos para los que tienes datos de ventas (para reportar cobertura UF). */
  expectedPeriods?: string[];
}

export const AnalysisConfigDialog = ({
  open,
  onClose,
  folder,
  allFolders,
  allLayers,
  expectedPeriods = [],
}: Props) => {
  const { settings, loading: settingsLoading, save, bump } = useAnalysisSettings(folder?.id ?? null);
  const { ufMap, loading: ufLoading, syncing, sync, coverage } = useUfMap();
  const { rules, upsert, remove, refresh: refreshRules } = useComplementRules(folder?.id ?? null);

  const [tab, setTab] = useState<"general" | "rules">("general");
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Form state — general
  const [isoRm, setIsoRm] = useState(5);
  const [isoReg, setIsoReg] = useState(7);
  const [extFolderIds, setExtFolderIds] = useState<string[]>([]);
  const [extLayerIds, setExtLayerIds] = useState<string[]>([]);
  const [useFineCanni, setUseFineCanni] = useState(true);

  useEffect(() => {
    if (settings) {
      setIsoRm(settings.iso_minutes_rm);
      setIsoReg(settings.iso_minutes_regions);
      setExtFolderIds(settings.external_competition_folder_ids ?? []);
      setExtLayerIds(settings.external_competition_layer_ids ?? []);
      setUseFineCanni(settings.use_fine_cannibalization);
    } else if (folder) {
      // valores por defecto cuando es la primera vez
      setIsoRm(5);
      setIsoReg(7);
      setExtFolderIds([]);
      setExtLayerIds([]);
      setUseFineCanni(true);
    }
  }, [settings, folder]);

  // Cobertura UF
  const ufCoverage = useMemo(() => {
    if (!expectedPeriods.length) return null;
    return coverage(expectedPeriods);
  }, [coverage, expectedPeriods]);

  const handleSaveGeneral = async () => {
    if (!folder) return;
    setSavingGeneral(true);
    try {
      await save({
        iso_minutes_rm: isoRm,
        iso_minutes_regions: isoReg,
        external_competition_folder_ids: extFolderIds,
        external_competition_layer_ids: extLayerIds,
        use_fine_cannibalization: useFineCanni,
      });
      // Solo bump si los settings de cálculo cambiaron (los que invalidan cache).
      const changed =
        !settings ||
        settings.iso_minutes_rm !== isoRm ||
        settings.iso_minutes_regions !== isoReg ||
        settings.use_fine_cannibalization !== useFineCanni ||
        JSON.stringify(settings.external_competition_folder_ids) !== JSON.stringify(extFolderIds) ||
        JSON.stringify(settings.external_competition_layer_ids) !== JSON.stringify(extLayerIds);
      if (changed) await bump();
      toast.success("Configuración guardada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleSyncUf = async () => {
    try {
      const r = await sync(2019);
      toast.success(`UF sincronizadas: ${r.upserted} períodos`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al sincronizar UF");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/40 px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Settings2 className="h-4 w-4" />
            Configurar análisis · {folder?.name ?? ""}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Define cómo se cuantifica el entorno de cada local: tiempos de
            isócrona, competencia interna/externa y reglas de pesos para
            comercios complementarios.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="border-b border-border/40 px-5 pt-2">
          <div className="inline-flex rounded-lg bg-surface-2/60 p-0.5">
            {(["general", "rules"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={[
                  "rounded-md px-3 py-1 text-[11px] font-medium transition-all",
                  tab === t
                    ? "bg-surface-3 text-foreground shadow-apple-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {t === "general" ? "General" : `Pesos complementarios (${rules.length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="scrollbar-thin max-h-[calc(92vh-180px)] overflow-y-auto px-5 py-4">
          {tab === "general" ? (
            <div className="space-y-5">
              {/* Isócrona */}
              <section>
                <Label className="text-[11px]">Tiempo de isócrona (min, en auto)</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-surface-2/40 p-3">
                    <div className="text-[10px] text-muted-foreground">Comunas RM</div>
                    <Input
                      type="number"
                      min={3}
                      max={20}
                      value={isoRm}
                      onChange={(e) => setIsoRm(Math.max(3, Math.min(20, parseInt(e.target.value) || 5)))}
                      className="mt-1 h-8 text-[12px]"
                    />
                    <div className="mt-1 text-[10px] text-muted-foreground">Default: 5</div>
                  </div>
                  <div className="rounded-lg bg-surface-2/40 p-3">
                    <div className="text-[10px] text-muted-foreground">Comunas regiones</div>
                    <Input
                      type="number"
                      min={3}
                      max={20}
                      value={isoReg}
                      onChange={(e) => setIsoReg(Math.max(3, Math.min(20, parseInt(e.target.value) || 7)))}
                      className="mt-1 h-8 text-[12px]"
                    />
                    <div className="mt-1 text-[10px] text-muted-foreground">Default: 7</div>
                  </div>
                </div>
              </section>

              {/* Canibalización */}
              <section>
                <Label className="text-[11px]">Canibalización interna</Label>
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 rounded-lg bg-surface-2/40 p-3">
                  <input
                    type="checkbox"
                    checked={useFineCanni}
                    onChange={(e) => setUseFineCanni(e.target.checked)}
                  />
                  <div>
                    <div className="text-[12px] font-medium">Usar descuento fino por celda</div>
                    <div className="text-[10px] text-muted-foreground">
                      Cuando la isócrona de dos locales del chain se intersecta,
                      cada celda se divide entre los locales que la cubren. Si está
                      apagado, solo se cuenta el competidor sin descuento espacial.
                    </div>
                  </div>
                </label>
              </section>

              {/* Competencia externa: carpetas */}
              <section>
                <Label className="text-[11px]">Competencia externa · Carpetas POI</Label>
                <div className="mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-border/40 bg-surface-2/40 p-2">
                  <FolderTreePicker
                    folders={allFolders}
                    excludeId={folder?.id ?? null}
                    selected={extFolderIds}
                    onChange={setExtFolderIds}
                  />
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Al marcar una carpeta madre se seleccionan todas sus subcarpetas.
                </div>
              </section>

              {/* Competencia externa: capas personalizadas */}
              <section>
                <Label className="text-[11px]">Competencia externa · Capas personalizadas</Label>
                <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/40 bg-surface-2/40 p-2">
                  {allLayers.length === 0 ? (
                    <div className="px-2 py-1 text-[10px] text-muted-foreground">
                      Sin capas personalizadas.
                    </div>
                  ) : (
                    allLayers.map((l) => {
                      const checked = extLayerIds.includes(l.id);
                      return (
                        <label
                          key={l.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-surface-3/50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) setExtLayerIds([...extLayerIds, l.id]);
                              else setExtLayerIds(extLayerIds.filter((x) => x !== l.id));
                            }}
                          />
                          <span className="text-[11px]">{l.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Las capas no marcadas se considerarán complementarias y se
                  ponderarán según las reglas de la pestaña siguiente.
                </div>
              </section>

              {/* UF */}
              <section className="rounded-lg border border-border/40 bg-surface-2/40 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-[11px]">UF · Datos para análisis temporal</Label>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {ufLoading
                        ? "Cargando…"
                        : `${ufMap.size} períodos cargados`}
                      {ufCoverage && ufCoverage.missing.length > 0 && (
                        <span className="ml-1 text-amber-700 dark:text-amber-400">
                          · {ufCoverage.missing.length} faltantes
                        </span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleSyncUf} disabled={syncing}>
                    {syncing ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                    )}
                    Sincronizar UF (mindicador.cl)
                  </Button>
                </div>
                {ufCoverage && ufCoverage.missing.length > 0 && (
                  <div className="mt-2 flex items-start gap-2 rounded bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span>
                      Faltan UF para los meses:{" "}
                      {ufCoverage.missing.slice(0, 6).join(", ")}
                      {ufCoverage.missing.length > 6 && ` y ${ufCoverage.missing.length - 6} más`}.
                      Esos meses se omitirán del análisis temporal.
                    </span>
                  </div>
                )}
              </section>

              <div className="flex justify-end gap-2 border-t border-border/40 pt-3">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={handleSaveGeneral} disabled={savingGeneral || settingsLoading}>
                  {savingGeneral ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 h-3 w-3" />
                  )}
                  Guardar
                </Button>
              </div>
            </div>
          ) : (
            <RulesEditor
              rules={rules}
              folderId={folder?.id ?? null}
              onUpsert={async (r) => {
                await upsert(r);
                toast.success("Regla guardada");
              }}
              onRemove={async (id) => {
                if (!window.confirm("¿Eliminar regla?")) return;
                await remove(id);
                toast.success("Regla eliminada");
              }}
              onRefresh={refreshRules}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ----------------- Editor de reglas (subcomponente) ----------------- */

interface RulesEditorProps {
  rules: import("@/types/analysis").ComplementWeightRule[];
  folderId: string | null;
  onUpsert: (r: Partial<import("@/types/analysis").ComplementWeightRule> & { pattern: string; weight: number }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const RulesEditor = ({ rules, folderId, onUpsert, onRemove }: RulesEditorProps) => {
  const [draftPattern, setDraftPattern] = useState("");
  const [draftWeight, setDraftWeight] = useState("0.50");
  const [draftLabel, setDraftLabel] = useState("");
  const [testText, setTestText] = useState("");

  const handleAdd = async () => {
    if (!draftPattern.trim()) return;
    const w = parseFloat(draftWeight);
    if (!isFinite(w) || w < 0 || w > 1) {
      toast.error("Peso debe estar entre 0 y 1");
      return;
    }
    await onUpsert({
      folder_id: folderId,
      pattern: draftPattern.trim(),
      weight: w,
      label: draftLabel.trim() || null,
      priority: 100,
      enabled: true,
    });
    setDraftPattern("");
    setDraftWeight("0.50");
    setDraftLabel("");
  };

  // Test runner: muestra qué regla matchea contra el texto.
  const matched = useMemo(() => {
    if (!testText.trim()) return null;
    for (const r of rules) {
      try {
        const re = new RegExp(r.pattern, r.pattern.startsWith("(?") ? undefined : "i");
        if (re.test(testText)) return r;
      } catch { /* skip */ }
    }
    return null;
  }, [testText, rules]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-surface-2/40 p-3 text-[11px] text-muted-foreground">
        Las reglas se evalúan en orden de <b>prioridad</b> (menor primero).
        El primer regex que matchea define el peso del POI complementario.
        Sin match → peso default <b>0.30</b>.
      </div>

      {/* Test inline */}
      <div className="rounded-lg border border-border/40 bg-surface-2/40 p-3">
        <Label className="text-[11px]">Probar reglas</Label>
        <div className="mt-1.5 flex gap-2">
          <Input
            placeholder="ej. Hiper Líder Vespucio"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="h-8 text-[12px]"
          />
        </div>
        {testText.trim() && (
          <div className="mt-2 text-[11px]">
            {matched ? (
              <span className="text-brand-green">
                Match: <b>{matched.label ?? "(sin etiqueta)"}</b> · peso {matched.weight} ·{" "}
                <code className="rounded bg-surface-3 px-1 text-[10px]">{matched.pattern}</code>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Sin match → peso default 0.30 (Genérico)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Lista de reglas */}
      <div className="space-y-1">
        {rules.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[60px_1fr_80px_80px_28px] items-center gap-2 rounded-md border border-border/30 bg-surface-2/40 px-2 py-1.5"
          >
            <span className="text-[10px] text-muted-foreground">{r.priority}</span>
            <code className="truncate text-[10px] font-mono">{r.pattern}</code>
            <span className="text-[11px]">{r.label ?? "—"}</span>
            <span className="text-[11px] font-mono">{r.weight.toFixed(2)}</span>
            <button
              onClick={() => onRemove(r.id)}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div className="rounded-lg border border-border/40 bg-surface-2/40 p-3">
        <Label className="text-[11px]">Nueva regla</Label>
        <div className="mt-1.5 grid grid-cols-[1fr_120px_120px_auto] gap-2">
          <Input
            placeholder="Patrón regex (ej. hiper.*lider)"
            value={draftPattern}
            onChange={(e) => setDraftPattern(e.target.value)}
            className="h-8 text-[12px]"
          />
          <Input
            placeholder="Etiqueta"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            className="h-8 text-[12px]"
          />
          <Input
            type="number"
            step="0.05"
            min="0"
            max="1"
            placeholder="Peso 0-1"
            value={draftWeight}
            onChange={(e) => setDraftWeight(e.target.value)}
            className="h-8 text-[12px]"
          />
          <Button size="sm" onClick={handleAdd} disabled={!draftPattern.trim()}>
            <Plus className="mr-1 h-3 w-3" /> Agregar
          </Button>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Sin flag inline (?i) se asume case-insensitive.
        </div>
      </div>
    </div>
  );
};
