import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Upload, ArrowLeft, Trash2, Plus, ExternalLink, FileDown, RefreshCw, FileJson } from "lucide-react";
import { htmlToGeoJson, downloadGeoJson } from "@/utils/htmlToGeoJson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useTerritorialLayers } from "@/hooks/useTerritorialLayers";
import type { DedupStrategy, TerritorialSourceFile } from "@/types/territorial";

const AdminCapas = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { groups, layers, refresh } = useTerritorialLayers();
  const [files, setFiles] = useState<TerritorialSourceFile[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const refreshFiles = useCallback(async () => {
    const { data } = await supabase
      .from("territorial_source_files")
      .select("*")
      .order("uploaded_at", { ascending: false })
      .limit(20);
    setFiles((data ?? []) as unknown as TerritorialSourceFile[]);
  }, []);

  useEffect(() => {
    if (isAdmin) void refreshFiles();
  }, [isAdmin, refreshFiles]);

  if (authLoading || roleLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!user) {
    navigate("/auth");
    return null;
  }
  if (!isAdmin) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Acceso denegado</h1>
        <p className="text-sm text-muted-foreground">
          Tu usuario no tiene rol <code>admin</code>.
        </p>
        <Button variant="outline" onClick={() => navigate("/")}>Volver</Button>
      </div>
    );
  }

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { error } = await supabase
      .from("territorial_layer_groups")
      .insert({ name, slug, color: "#F59E0B" });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Grupo "${name}" creado`);
    setNewGroupName("");
    void refresh();
  };

  const deleteLayer = async (id: string) => {
    if (!window.confirm("¿Eliminar la capa y todos sus puntos?")) return;
    const { error } = await supabase.from("territorial_layers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Capa eliminada");
      void refresh();
    }
  };

  const convertFileToGeoJson = async (f: TerritorialSourceFile) => {
    if (!f.storage_path) {
      toast.error("Sin storage_path");
      return;
    }
    const t = toast.loading("Convirtiendo a GeoJSON…");
    try {
      const dl = await supabase.storage.from("territorial-sources").download(f.storage_path);
      if (dl.error || !dl.data) throw dl.error ?? new Error("download failed");
      const text = await dl.data.text();
      const fc = htmlToGeoJson(text);
      if (!fc.features.length) {
        toast.dismiss(t);
        toast.error("No se detectaron features en el HTML");
        return;
      }

      const baseName = f.original_filename.replace(/\.[^.]+$/, "");
      let targetName = `${baseName}.geojson`;
      let mode: "replace" | "new" = "new";

      const { data: existing } = await supabase
        .from("territorial_source_files")
        .select("id, storage_path")
        .eq("original_filename", targetName)
        .maybeSingle();

      if (existing) {
        toast.dismiss(t);
        const replace = window.confirm(
          `Ya existe "${targetName}" en el historial.\n\n` +
          `Aceptar = Reemplazar el archivo existente.\n` +
          `Cancelar = Guardar con un nombre nuevo.`,
        );
        if (replace) {
          mode = "replace";
        } else {
          const suggested = `${baseName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.geojson`;
          const input = window.prompt("Nombre del nuevo archivo:", suggested);
          if (!input) return;
          targetName = input.endsWith(".geojson") ? input : `${input}.geojson`;
        }
      }

      const t2 = toast.loading("Guardando GeoJSON…");
      const blob = new Blob([JSON.stringify(fc)], { type: "application/geo+json" });
      const safe = targetName.replace(/[^\w.-]+/g, "_");
      const path = `${Date.now()}-${safe}`;
      const up = await supabase.storage
        .from("territorial-sources")
        .upload(path, blob, { contentType: "application/geo+json", upsert: false });
      if (up.error) throw up.error;

      if (mode === "replace" && existing) {
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
            original_filename: targetName,
            size_bytes: blob.size,
            storage_path: path,
            status: "pending",
            group_id: f.group_id ?? null,
            file_type: "geojson",
          } as never);
        if (insErr) throw insErr;
      }

      toast.dismiss(t2);
      toast.success(
        mode === "replace"
          ? `"${targetName}" reemplazado · ${fc.features.length} features`
          : `"${targetName}" agregado al historial · ${fc.features.length} features`,
      );
      void refreshFiles();
    } catch (e) {
      toast.dismiss(t);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
          <h1 className="flex-1 text-base font-semibold">Admin · Capas Territoriales</h1>
          <input
            type="file"
            accept=".html,.htm,.kml"
            id="html-to-geojson-input"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const text = await f.text();
                const fc = htmlToGeoJson(text);
                if (!fc.features.length) {
                  toast.error("Formato HTML no reconocido. Probá exportarlo como GeoJSON o KML desde la herramienta de origen.");
                  return;
                }
                const byFolder = new Map<string, number>();
                for (const f of fc.features) {
                  const k = String((f.properties as Record<string, unknown>)?.folder ?? "default");
                  byFolder.set(k, (byFolder.get(k) ?? 0) + 1);
                }
                const summary = [...byFolder.entries()]
                  .map(([k, v]) => `${k}: ${v}`).join(" · ");
                const out = f.name.replace(/\.[^.]+$/, "") + ".geojson";
                downloadGeoJson(fc, out);
                toast.success(`${fc.features.length} features (${summary}) → ${out}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => document.getElementById("html-to-geojson-input")?.click()}
          >
            <FileDown className="h-4 w-4" /> HTML → GeoJSON
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" /> Cargar capa
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 p-4">
        <p className="rounded-md border border-border/40 bg-muted/30 p-3 text-xs text-muted-foreground">
          ¿Tu HTML se subió pero no muestra capas ni puntos? Usá <strong>HTML → GeoJSON</strong> para
          convertirlo en el navegador y luego cargá el .geojson resultante.
        </p>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Grupos</h2>
          <div className="flex gap-2">
            <Input
              placeholder="Nombre del grupo (ej: Talleres)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
            <Button onClick={createGroup}>
              <Plus className="h-4 w-4" /> Crear
            </Button>
          </div>
          <div className="space-y-3">
            {groups.map((g) => {
              const groupLayers = layers.filter((l) => l.group_id === g.id);
              return (
                <div key={g.id} className="rounded-lg border border-border/60 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: g.color || "#F59E0B" }}
                    />
                    <h3 className="font-medium">{g.name}</h3>
                    <span className="text-xs text-muted-foreground">
                      {groupLayers.length} capas
                    </span>
                  </div>
                  {groupLayers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin capas. Carga un archivo.</p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {groupLayers.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-center gap-2 py-1.5 text-sm"
                        >
                          <span className="flex-1">{l.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {l.feature_count}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteLayer(l.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Historial de archivos
          </h2>
          <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
            {files.length === 0 && (
              <li className="p-4 text-sm text-muted-foreground">Sin archivos.</li>
            )}
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{f.original_filename}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(f.uploaded_at).toLocaleString()} · {f.status}
                    {f.error && <span className="text-destructive"> · {f.error}</span>}
                  </div>
                </div>
                <Select
                  value={f.group_id ?? ""}
                  onValueChange={async (val) => {
                    const { error } = await supabase
                      .from("territorial_source_files")
                      .update({ group_id: val })
                      .eq("id", f.id);
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    // Cascade: move existing layers (and therefore their features) to the new group
                    const { error: layerErr, count } = await supabase
                      .from("territorial_layers")
                      .update({ group_id: val }, { count: "exact" })
                      .eq("source_file_id", f.id);
                    if (layerErr) {
                      toast.error(`Grupo actualizado, pero capas no movidas: ${layerErr.message}`);
                    } else {
                      toast.success(`Grupo actualizado · ${count ?? 0} capas movidas`);
                    }
                    void refreshFiles();
                    void refresh();
                  }}
                >
                  <SelectTrigger className="h-8 w-44">
                    <SelectValue placeholder="Asignar grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {f.gdrive_file_id && (
                  <a
                    href={`https://drive.google.com/file/d/${f.gdrive_file_id}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="inline h-3 w-3" /> Drive
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  title="Reprocesar archivo (sin exclusiones)"
                  disabled={!f.group_id}
                  onClick={async () => {
                    if (!f.group_id) {
                      toast.error("Asigná un grupo antes de reprocesar");
                      return;
                    }
                    const t = toast.loading("Reprocesando…");
                    const { data, error } = await supabase.functions.invoke(
                      "ingest-territorial-html",
                      {
                        body: {
                          source_file_id: f.id,
                          group_id: f.group_id,
                          excluded_layers: [],
                          dedup_strategy: "replace_layer",
                        },
                      },
                    );
                    toast.dismiss(t);
                    if (error) {
                      toast.error(error.message);
                    } else {
                      const layers = (data as { layers?: Array<{ name: string; count: number }> })?.layers ?? [];
                      const summary = layers.map((l) => `${l.name}: ${l.count}`).join(" · ") || "0 capas";
                      toast.success(`Reprocesado · ${summary}`);
                      void refresh();
                      void refreshFiles();
                    }
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                {(f.file_type === "html" || f.file_type === "kml" || !f.file_type) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Convertir a GeoJSON y guardar en historial"
                    onClick={() => convertFileToGeoJson(f)}
                  >
                    <FileJson className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    if (!window.confirm(`¿Eliminar "${f.original_filename}"? Se borrará también el archivo en storage.`)) return;
                    if (f.storage_path) {
                      await supabase.storage.from("territorial-sources").remove([f.storage_path]);
                    }
                    const { error } = await supabase
                      .from("territorial_source_files")
                      .delete()
                      .eq("id", f.id);
                    if (error) toast.error(error.message);
                    else {
                      toast.success("Archivo eliminado");
                      void refreshFiles();
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        groups={groups}
        onDone={() => {
          void refresh();
          void refreshFiles();
        }}
      />
    </div>
  );
};

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: ReturnType<typeof useTerritorialLayers>["groups"];
  onDone: () => void;
}

const UploadDialog = ({ open, onOpenChange, groups, onDone }: UploadDialogProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [sourceFileId, setSourceFileId] = useState<string | null>(null);
  const [scanned, setScanned] = useState<Array<{ name: string; count: number }>>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [groupId, setGroupId] = useState<string>("");
  const [dedup, setDedup] = useState<DedupStrategy>("replace_layer");

  useEffect(() => {
    if (!groupId && groups.length) setGroupId(groups[0].id);
  }, [groups, groupId]);

  const reset = () => {
    setFile(null);
    setSourceFileId(null);
    setScanned([]);
    setExcluded(new Set());
    setUploading(false);
    setScanning(false);
    setProcessing(false);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const detectFileType = (f: File): "html" | "geojson" | "kml" | "kmz" => {
    const n = f.name.toLowerCase();
    if (n.endsWith(".kmz")) return "kmz";
    if (n.endsWith(".kml")) return "kml";
    if (n.endsWith(".geojson") || n.endsWith(".json")) return "geojson";
    return "html";
  };

  const handleUpload = async () => {
    if (!file || !groupId) return;
    setUploading(true);
    try {
      const fileType = detectFileType(file);
      const mime =
        fileType === "kmz" ? "application/vnd.google-earth.kmz"
        : fileType === "kml" ? "application/vnd.google-earth.kml+xml"
        : fileType === "geojson" ? "application/geo+json"
        : "text/html";
      const path = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const up = await supabase.storage
        .from("territorial-sources")
        .upload(path, file, { contentType: mime, upsert: false });
      if (up.error) throw up.error;

      const { data: sf, error: sfErr } = await supabase
        .from("territorial_source_files")
        .insert({
          original_filename: file.name,
          size_bytes: file.size,
          storage_path: path,
          status: "pending",
          group_id: groupId,
          file_type: fileType,
        } as never)
        .select("id")
        .single();
      if (sfErr || !sf) throw sfErr || new Error("insert failed");
      setSourceFileId(sf.id);
      setUploading(false);

      setScanning(true);
      const { data: scanRes, error: scanErr } = await supabase.functions.invoke(
        "scan-territorial-html",
        { body: { source_file_id: sf.id } },
      );
      setScanning(false);
      if (scanErr) throw scanErr;
      const layers = (scanRes?.layers ?? []) as Array<{ name: string; count: number }>;
      if (!layers.length) {
        toast.error("No se detectaron capas en el archivo");
        return;
      }
      setScanned(layers);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      setUploading(false);
      setScanning(false);
    }
  };

  const handleProcess = async () => {
    if (!sourceFileId || !groupId) return;
    setProcessing(true);
    try {
      const { error } = await supabase.functions.invoke("ingest-territorial-html", {
        body: {
          source_file_id: sourceFileId,
          group_id: groupId,
          excluded_layers: Array.from(excluded),
          dedup_strategy: dedup,
        },
      });
      if (error) throw error;
      toast.success("Carga completada");
      onDone();
      close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  const totalIncluded = useMemo(
    () => scanned.filter((l) => !excluded.has(l.name)).reduce((acc, l) => acc + l.count, 0),
    [scanned, excluded],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? close() : onOpenChange(v))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cargar capa territorial</DialogTitle>
        </DialogHeader>

        {scanned.length === 0 ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Grupo destino</label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegí un grupo" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Archivo (hasta 1 GB)</label>
              <Input
                type="file"
                accept=".html,.htm,.geojson,.json,.kml,.kmz,text/html,application/json,application/geo+json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Formatos aceptados: GeoJSON, HTML, KML, KMZ.
              </p>
              {file && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={handleUpload} disabled={!file || uploading || scanning}>
                {(uploading || scanning) && <Loader2 className="h-4 w-4 animate-spin" />}
                {uploading ? "Subiendo…" : scanning ? "Analizando…" : "Subir y analizar"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Se detectaron {scanned.length} capas. Marcá las que quieras excluir.
            </p>
            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2/80 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Excluir</th>
                    <th className="px-3 py-2 text-left">Capa</th>
                    <th className="px-3 py-2 text-right">Puntos</th>
                  </tr>
                </thead>
                <tbody>
                  {scanned.map((l) => (
                    <tr key={l.name} className="border-t border-border/40">
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={excluded.has(l.name)}
                          onCheckedChange={(v) => {
                            setExcluded((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(l.name);
                              else next.delete(l.name);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">{l.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{l.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Estrategia de duplicados</label>
              <Select value={dedup} onValueChange={(v) => setDedup(v as DedupStrategy)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace_layer">Reemplazo total de la capa (recomendado)</SelectItem>
                  <SelectItem value="merge_external_id">Merge por ID externo</SelectItem>
                  <SelectItem value="merge_coords_name">Merge por coordenadas + nombre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Se importarán {totalIncluded} puntos en total.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={processing}>
                Cancelar
              </Button>
              <Button onClick={handleProcess} disabled={processing}>
                {processing && <Loader2 className="h-4 w-4 animate-spin" />}
                {processing ? "Procesando…" : "Procesar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AdminCapas;
