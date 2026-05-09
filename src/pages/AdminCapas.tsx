import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Upload, ArrowLeft, Trash2, Plus, ExternalLink, FileDown, RefreshCw, FileJson, FileUp, Layers as LayersIcon, ChevronDown, Users as UsersIcon, Map as MapIcon } from "lucide-react";
import { htmlToGeoJson, downloadGeoJson } from "@/utils/htmlToGeoJson";
import { UsersAdminSection } from "@/components/admin/UsersAdminSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConvertHtmlDialog } from "@/components/admin/ConvertHtmlDialog";
import { ConfirmDeleteDialog } from "@/components/admin/ConfirmDeleteDialog";
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
  const [convertTarget, setConvertTarget] = useState<TerritorialSourceFile | null>(null);
  const [deleteLayerTarget, setDeleteLayerTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState<TerritorialSourceFile | null>(null);
  const [selectedLayers, setSelectedLayers] = useState<Record<string, Set<string>>>({});
  const [bulkDeleteGroup, setBulkDeleteGroup] = useState<{ id: string; name: string; ids: string[] } | null>(null);
  const [renameGroupTarget, setRenameGroupTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLayerName, setEditingLayerName] = useState("");

  const saveLayerName = async (id: string, originalName: string) => {
    const trimmed = editingLayerName.trim();
    setEditingLayerId(null);
    if (!trimmed || trimmed === originalName) return;
    const { error } = await supabase
      .from("territorial_layers")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Capa renombrada");
    void refresh();
  };

  const toggleLayerSelected = (groupId: string, layerId: string) => {
    setSelectedLayers((prev) => {
      const current = new Set(prev[groupId] ?? []);
      if (current.has(layerId)) current.delete(layerId);
      else current.add(layerId);
      return { ...prev, [groupId]: current };
    });
  };

  const toggleAllInGroup = (groupId: string, layerIds: string[]) => {
    setSelectedLayers((prev) => {
      const current = prev[groupId] ?? new Set<string>();
      const allSelected = layerIds.length > 0 && layerIds.every((id) => current.has(id));
      return { ...prev, [groupId]: allSelected ? new Set() : new Set(layerIds) };
    });
  };

  const performBulkDelete = async (ids: string[], groupId: string) => {
    const { error } = await supabase.from("territorial_layers").delete().in("id", ids);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${ids.length} capas eliminadas`);
    setSelectedLayers((prev) => ({ ...prev, [groupId]: new Set() }));
    void refresh();
  };

  const performRenameGroup = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    const { error } = await supabase
      .from("territorial_layer_groups")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Grupo renombrado");
    setRenameGroupTarget(null);
    void refresh();
  };

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

  const performDeleteLayer = async (id: string) => {
    const { error } = await supabase.from("territorial_layers").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Capa eliminada");
    void refresh();
  };

  const performDeleteFile = async (f: TerritorialSourceFile) => {
    if (f.storage_path) {
      await supabase.storage.from("territorial-sources").remove([f.storage_path]);
    }
    const { error } = await supabase
      .from("territorial_source_files")
      .delete()
      .eq("id", f.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Archivo eliminado");
    void refreshFiles();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
          <h1 className="flex-1 text-base font-semibold">Admin</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <AdminCollapsible
          id="users"
          title="Usuarios y permisos"
          icon={<UsersIcon className="h-4 w-4" />}
          description="Roles personalizados y asignación de permisos por sección."
        >
          <UsersAdminSection />
        </AdminCollapsible>

        <AdminCollapsible
          id="capas"
          title="Capas territoriales"
          icon={<MapIcon className="h-4 w-4" />}
          description="Cargá y administrá capas geográficas agrupadas."
        >
        <div className="flex flex-wrap items-center gap-2">
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
              const layerIds = groupLayers.map((l) => l.id);
              const selected = selectedLayers[g.id] ?? new Set<string>();
              const allChecked = layerIds.length > 0 && layerIds.every((id) => selected.has(id));
              const someChecked = selected.size > 0 && !allChecked;
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
                    <div className="ml-auto flex items-center gap-1">
                      {selected.size > 0 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            setBulkDeleteGroup({
                              id: g.id,
                              name: g.name,
                              ids: Array.from(selected),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" /> Eliminar ({selected.size})
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRenameValue(g.name);
                          setRenameGroupTarget({ id: g.id, name: g.name });
                        }}
                      >
                        Renombrar
                      </Button>
                    </div>
                  </div>
                  {groupLayers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin capas. Carga un archivo.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 border-b border-border/40 pb-1.5 text-xs text-muted-foreground">
                        <Checkbox
                          checked={allChecked ? true : someChecked ? "indeterminate" : false}
                          onCheckedChange={() => toggleAllInGroup(g.id, layerIds)}
                        />
                        <span>Seleccionar todas</span>
                      </div>
                      <ul className="divide-y divide-border/40">
                        {groupLayers.map((l) => (
                          <li
                            key={l.id}
                            className="flex items-center gap-2 py-1.5 text-sm"
                          >
                            <Checkbox
                              checked={selected.has(l.id)}
                              onCheckedChange={() => toggleLayerSelected(g.id, l.id)}
                            />
                            {editingLayerId === l.id ? (
                              <Input
                                autoFocus
                                value={editingLayerName}
                                onChange={(e) => setEditingLayerName(e.target.value)}
                                onBlur={() => void saveLayerName(l.id, l.name)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void saveLayerName(l.id, l.name);
                                  else if (e.key === "Escape") setEditingLayerId(null);
                                }}
                                className="h-7 flex-1"
                              />
                            ) : (
                              <span
                                className="flex-1 cursor-text rounded px-1 hover:bg-muted/50"
                                title="Doble clic para renombrar"
                                onDoubleClick={() => {
                                  setEditingLayerId(l.id);
                                  setEditingLayerName(l.name);
                                }}
                              >
                                {l.name}
                              </span>
                            )}
                            <span className="font-mono text-xs text-muted-foreground">
                              {l.feature_count}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteLayerTarget({ id: l.id, name: l.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </>
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
                    onClick={() => setConvertTarget(f)}
                  >
                    <FileJson className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleteFileTarget(f)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
        </AdminCollapsible>
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

      <ConvertHtmlDialog
        open={!!convertTarget}
        onOpenChange={(v) => !v && setConvertTarget(null)}
        file={convertTarget}
        onDone={() => {
          void refreshFiles();
          void refresh();
        }}
      />

      <ConfirmDeleteDialog
        open={!!deleteLayerTarget}
        onOpenChange={(v) => !v && setDeleteLayerTarget(null)}
        title="¿Eliminar la capa?"
        description="Se eliminarán también todos los puntos asociados. Esta acción no se puede deshacer."
        resourceName={deleteLayerTarget?.name}
        onConfirm={async () => {
          if (deleteLayerTarget) await performDeleteLayer(deleteLayerTarget.id);
        }}
      />

      <ConfirmDeleteDialog
        open={!!deleteFileTarget}
        onOpenChange={(v) => !v && setDeleteFileTarget(null)}
        title="¿Eliminar el archivo?"
        description="Se borrará también el archivo del almacenamiento. Esta acción no se puede deshacer."
        resourceName={deleteFileTarget?.original_filename}
        onConfirm={async () => {
          if (deleteFileTarget) await performDeleteFile(deleteFileTarget);
        }}
      />

      <ConfirmDeleteDialog
        open={!!bulkDeleteGroup}
        onOpenChange={(v) => !v && setBulkDeleteGroup(null)}
        title="¿Eliminar las capas seleccionadas?"
        description="Se eliminarán también todos los puntos asociados. Esta acción no se puede deshacer."
        resourceName={
          bulkDeleteGroup
            ? `${bulkDeleteGroup.ids.length} capas de "${bulkDeleteGroup.name}"`
            : undefined
        }
        onConfirm={async () => {
          if (bulkDeleteGroup)
            await performBulkDelete(bulkDeleteGroup.ids, bulkDeleteGroup.id);
        }}
      />

      <Dialog
        open={!!renameGroupTarget}
        onOpenChange={(v) => !v && setRenameGroupTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <LayersIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <DialogTitle>Renombrar grupo</DialogTitle>
                <DialogDescription className="mt-1">
                  Cambia el nombre visible del grupo. Los slugs y referencias internas se mantienen.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="rename-group-input">Nuevo nombre</Label>
            <Input
              id="rename-group-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameGroupTarget) {
                  void performRenameGroup(renameGroupTarget.id, renameValue);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameGroupTarget(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (renameGroupTarget)
                  void performRenameGroup(renameGroupTarget.id, renameValue);
              }}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

  const step = scanned.length === 0 ? 1 : 2;

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? close() : onOpenChange(v))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Cargar capa territorial</DialogTitle>
              <DialogDescription>
                Subí un archivo, revisá las capas detectadas y procesalas en el grupo destino.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs">
          <StepBadge n={1} label="Archivo" active={step === 1} done={step > 1} />
          <div className="h-px flex-1 bg-border" />
          <StepBadge n={2} label="Revisar capas" active={step === 2} done={false} />
        </div>

        {scanned.length === 0 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Grupo destino</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Elegí un grupo" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Archivo</Label>
              <label
                htmlFor="upload-file-input"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-center transition-colors hover:border-primary/60 hover:bg-muted/50"
              >
                <FileUp className="h-6 w-6 text-muted-foreground" />
                {file ? (
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · click para cambiar
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-medium">Hacé click para seleccionar un archivo</div>
                    <div className="text-xs text-muted-foreground">GeoJSON · HTML · KML · KMZ (hasta 1 GB)</div>
                  </>
                )}
                <input
                  id="upload-file-input"
                  type="file"
                  accept=".html,.htm,.geojson,.json,.kml,.kmz,text/html,application/json,application/geo+json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={handleUpload} disabled={!file || uploading || scanning}>
                {(uploading || scanning) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {uploading ? "Subiendo…" : scanning ? "Analizando…" : "Subir y analizar"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <LayersIcon className="h-4 w-4 text-primary" />
              <span>
                Se detectaron <strong>{scanned.length}</strong> capas. Marcá las que quieras excluir.
              </span>
            </div>

            <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Excluir</th>
                    <th className="px-3 py-2 text-left font-medium">Capa</th>
                    <th className="px-3 py-2 text-right font-medium">Puntos</th>
                  </tr>
                </thead>
                <tbody>
                  {scanned.map((l) => (
                    <tr key={l.name} className="border-t border-border/40 hover:bg-muted/30">
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

            <div className="space-y-1.5">
              <Label className="text-xs">Estrategia de duplicados</Label>
              <Select value={dedup} onValueChange={(v) => setDedup(v as DedupStrategy)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace_layer">Reemplazo total de la capa (recomendado)</SelectItem>
                  <SelectItem value="merge_external_id">Merge por ID externo</SelectItem>
                  <SelectItem value="merge_coords_name">Merge por coordenadas + nombre</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-foreground">
              Se importarán <strong>{totalIncluded.toLocaleString()}</strong> puntos en total.
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={processing}>Cancelar</Button>
              <Button onClick={handleProcess} disabled={processing}>
                {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {processing ? "Procesando…" : "Procesar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const StepBadge = ({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) => (
  <div className="flex items-center gap-1.5">
    <div
      className={[
        "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
        done ? "bg-primary text-primary-foreground"
          : active ? "bg-primary/20 text-primary ring-2 ring-primary/40"
          : "bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {n}
    </div>
    <span className={active || done ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
  </div>
);


const ADMIN_COLLAPSED_KEY = "admin_sections_open_v1";
const readAdminMap = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_COLLAPSED_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

const AdminCollapsible = ({
  id,
  title,
  description,
  icon,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) => {
  // Default cerrado, según pedido del usuario
  const [open, setOpen] = useState<boolean>(() => {
    const m = readAdminMap();
    return m[id] === true;
  });
  useEffect(() => {
    const m = readAdminMap();
    m[id] = open;
    localStorage.setItem(ADMIN_COLLAPSED_KEY, JSON.stringify(m));
  }, [id, open]);
  return (
    <section className="rounded-xl border border-border/60 bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        aria-expanded={open}
      >
        {icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          {description && (
            <div className="text-xs text-muted-foreground">{description}</div>
          )}
        </div>
        <ChevronDown
          className={["h-4 w-4 text-muted-foreground transition-transform", open ? "" : "-rotate-90"].join(" ")}
        />
      </button>
      {open && (
        <div className="max-h-[calc(100vh-12rem)] space-y-4 overflow-y-auto border-t border-border/40 p-4">{children}</div>
      )}
    </section>
  );
};

export default AdminCapas;

