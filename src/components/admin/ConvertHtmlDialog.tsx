import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileJson, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { htmlToGeoJson } from "@/utils/htmlToGeoJson";
import type { TerritorialSourceFile } from "@/types/territorial";

type Phase = "confirm" | "conflict" | "processing" | "success";
type Mode = "replace" | "new";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  file: TerritorialSourceFile | null;
  onDone: () => void;
}

const formatSize = (b?: number | null) =>
  !b ? "—" : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;

export const ConvertHtmlDialog = ({ open, onOpenChange, file, onDone }: Props) => {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [progressMsg, setProgressMsg] = useState("");
  const [targetName, setTargetName] = useState("");
  const [mode, setMode] = useState<Mode>("replace");
  const [newName, setNewName] = useState("");
  const [existing, setExisting] = useState<{ id: string; storage_path: string | null } | null>(null);
  const [parsed, setParsed] = useState<{ features: number; groups: string[]; size: number } | null>(null);

  useEffect(() => {
    if (!open || !file) return;
    const baseName = file.original_filename.replace(/\.[^.]+$/, "");
    const t = `${baseName}.geojson`;
    setTargetName(t);
    setNewName(`${baseName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.geojson`);
    setPhase("confirm");
    setMode("replace");
    setExisting(null);
    setParsed(null);
    setProgressMsg("");
  }, [open, file]);

  const close = () => {
    if (phase === "processing") return;
    onOpenChange(false);
  };

  const run = async (resolvedMode?: Mode, resolvedName?: string) => {
    if (!file?.storage_path) {
      toast.error("Sin storage_path");
      return;
    }
    const finalMode = resolvedMode ?? mode;
    let finalName = resolvedName ?? targetName;

    setPhase("processing");
    try {
      setProgressMsg("Descargando archivo…");
      const dl = await supabase.storage.from("territorial-sources").download(file.storage_path);
      if (dl.error || !dl.data) throw dl.error ?? new Error("No se pudo descargar");
      const text = await dl.data.text();

      setProgressMsg("Parseando HTML/KML…");
      const fc = htmlToGeoJson(text);
      if (!fc.features.length) throw new Error("No se detectaron features en el archivo");

      // Conflict detection (only on first run, before knowing existing)
      if (!existing) {
        const { data: ex } = await supabase
          .from("territorial_source_files")
          .select("id, storage_path")
          .eq("original_filename", finalName)
          .maybeSingle();
        if (ex) {
          setExisting(ex as { id: string; storage_path: string | null });
          setPhase("conflict");
          return;
        }
      }

      setProgressMsg("Subiendo GeoJSON…");
      const blob = new Blob([JSON.stringify(fc)], { type: "application/geo+json" });
      const safe = finalName.replace(/[^\w.-]+/g, "_");
      const path = `${Date.now()}-${safe}`;
      const up = await supabase.storage
        .from("territorial-sources")
        .upload(path, blob, { contentType: "application/geo+json", upsert: false });
      if (up.error) throw up.error;

      if (finalMode === "replace" && existing) {
        if (existing.storage_path) {
          await supabase.storage.from("territorial-sources").remove([existing.storage_path]);
        }
        const { error: updErr } = await supabase
          .from("territorial_source_files")
          .update({
            storage_path: path,
            size_bytes: blob.size,
            file_type: "geojson",
            status: "pending",
            error: null,
            layers_summary: null,
            uploaded_at: new Date().toISOString(),
          } as never)
          .eq("id", existing.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase
          .from("territorial_source_files")
          .insert({
            original_filename: finalName,
            size_bytes: blob.size,
            storage_path: path,
            status: "pending",
            group_id: file.group_id ?? null,
            file_type: "geojson",
          } as never);
        if (insErr) throw insErr;
      }

      const groupSet = new Set<string>();
      for (const ft of fc.features) {
        const g = (ft.properties as Record<string, unknown> | null)?.folder;
        if (typeof g === "string") groupSet.add(g);
      }
      setParsed({ features: fc.features.length, groups: [...groupSet], size: blob.size });
      setTargetName(finalName);
      setPhase("success");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setPhase(existing ? "conflict" : "confirm");
    }
  };

  const handleConflictContinue = () => {
    const finalName = mode === "replace" ? targetName : (newName.endsWith(".geojson") ? newName : `${newName}.geojson`);
    if (mode === "new" && !newName.trim()) {
      toast.error("Ingresá un nombre para el nuevo archivo");
      return;
    }
    void run(mode, finalName);
  };

  if (!file) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? close() : onOpenChange(v))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileJson className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Convertir a GeoJSON</DialogTitle>
              <DialogDescription>
                Procesa el archivo en el navegador y lo guarda en el historial.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {phase === "confirm" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Archivo origen</div>
              <div className="truncate font-medium">{file.original_filename}</div>
              <div className="mt-1 text-xs text-muted-foreground">{formatSize(file.size_bytes)}</div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="target" className="text-xs">Nombre destino</Label>
              <Input
                id="target"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                className="h-9 font-mono text-sm"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={() => void run("replace", targetName)}>
                <Sparkles className="h-4 w-4" /> Convertir y guardar
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "conflict" && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="text-sm">
                <div className="font-medium">Ya existe un archivo con ese nombre</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Elegí cómo querés guardarlo en el historial.
                </div>
              </div>
            </div>

            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="space-y-2">
              <label
                htmlFor="opt-replace"
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                  mode === "replace" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <RadioGroupItem id="opt-replace" value="replace" className="mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <RefreshCw className="h-3.5 w-3.5" /> Reemplazar el existente
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Borra el archivo previo y lo sustituye por la nueva conversión.
                  </div>
                </div>
              </label>

              <label
                htmlFor="opt-new"
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                  mode === "new" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <RadioGroupItem id="opt-new" value="new" className="mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="text-sm font-medium">Guardar con nombre nuevo</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Conserva el archivo anterior y agrega uno nuevo al historial.
                    </div>
                  </div>
                  {mode === "new" && (
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="nombre.geojson"
                      className="h-8 font-mono text-xs"
                      autoFocus
                    />
                  )}
                </div>
              </label>
            </RadioGroup>

            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={handleConflictContinue}>Continuar</Button>
            </DialogFooter>
          </div>
        )}

        {phase === "processing" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground">{progressMsg || "Procesando…"}</div>
          </div>
        )}

        {phase === "success" && parsed && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-base font-semibold">Conversión completada</div>
              <div className="text-xs text-muted-foreground">{targetName}</div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-lg font-semibold">{parsed.features}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Features</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-lg font-semibold">{parsed.groups.length}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Grupos</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-lg font-semibold">{formatSize(parsed.size)}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tamaño</div>
              </div>
            </div>

            {parsed.groups.length > 0 && (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Grupos detectados</div>
                <div className="flex flex-wrap gap-1">
                  {parsed.groups.slice(0, 12).map((g) => (
                    <span key={g} className="rounded-md bg-secondary px-2 py-0.5 text-[11px]">{g}</span>
                  ))}
                  {parsed.groups.length > 12 && (
                    <span className="text-[11px] text-muted-foreground">+{parsed.groups.length - 12} más</span>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button onClick={close}>Cerrar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
