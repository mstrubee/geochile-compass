import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
  MapPin,
  Check,
  X,
  Move,
} from "lucide-react";
import { toast } from "sonner";
import type { PoiFolder, PoiUpdate, SavedPoi } from "@/types/pois";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pois: SavedPoi[];
  folders: PoiFolder[];
  onCreateFolder: (name: string, parentId: string | null) => Promise<PoiFolder>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onMoveFolder: (id: string, parentId: string | null) => Promise<void>;
  onUpdatePoi: (id: string, patch: PoiUpdate) => Promise<void>;
  onDeletePois: (ids: string[]) => Promise<void>;
  onMovePois: (ids: string[], folderId: string | null) => Promise<void>;
}

const COLOR_OPTIONS = [
  "#34D399", "#F472B6", "#FBBF24", "#60A5FA",
  "#A78BFA", "#FB7185", "#22D3EE", "#FB923C", "#94A3B8",
];

export const PoiManagerDialog = ({
  open,
  onOpenChange,
  pois,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onUpdatePoi,
  onDeletePois,
  onMovePois,
}: Props) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["__root__"]));
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [editingPoi, setEditingPoi] = useState<SavedPoi | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creatingIn, setCreatingIn] = useState<string | "__root__" | null>(null);
  const [newFolderName, setNewFolderName] = useState("");

  const rootFolders = useMemo(() => folders.filter((f) => !f.parent_id), [folders]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, PoiFolder[]>();
    folders.forEach((f) => {
      if (f.parent_id) {
        const arr = m.get(f.parent_id) ?? [];
        arr.push(f);
        m.set(f.parent_id, arr);
      }
    });
    return m;
  }, [folders]);
  const poisByFolder = useMemo(() => {
    const m = new Map<string | null, SavedPoi[]>();
    pois.forEach((p) => {
      const k = p.folder_id;
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    });
    return m;
  }, [pois]);

  const toggleExp = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePoiSel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreateFolder = async (parentId: string | null) => {
    const name = newFolderName.trim();
    if (!name) {
      toast.error("Nombre requerido");
      return;
    }
    try {
      await onCreateFolder(name, parentId);
      toast.success("Carpeta creada");
      setNewFolderName("");
      setCreatingIn(null);
      if (parentId) setExpanded((p) => new Set(p).add(parentId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleRenameFolder = async (id: string) => {
    const name = folderDraft.trim();
    if (!name) return;
    try {
      await onRenameFolder(id, name);
      setEditingFolderId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleDeleteFolder = async (f: PoiFolder) => {
    const subCount = (childrenOf.get(f.id) ?? []).length;
    const poiCount = (poisByFolder.get(f.id) ?? []).length;
    const msg = subCount || poiCount
      ? `Eliminar "${f.name}"? Contiene ${subCount} subcarpetas y ${poiCount} POIs (los POIs quedarán sin carpeta).`
      : `Eliminar carpeta "${f.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await onDeleteFolder(f.id);
      toast.success("Carpeta eliminada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleDeleteFolderPois = async (folderId: string | null) => {
    const ids = (poisByFolder.get(folderId) ?? []).map((p) => p.id);
    if (!ids.length) return;
    if (!window.confirm(`Eliminar ${ids.length} POIs de esta carpeta?`)) return;
    try {
      await onDeletePois(ids);
      toast.success(`${ids.length} POIs eliminados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleBulkDelete = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Eliminar ${selected.size} POIs seleccionados?`)) return;
    try {
      await onDeletePois([...selected]);
      setSelected(new Set());
      toast.success("POIs eliminados");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleBulkMove = async (folderId: string | null) => {
    if (!selected.size) return;
    try {
      await onMovePois([...selected], folderId);
      setSelected(new Set());
      toast.success("POIs movidos");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const walk = (pid: string) => {
      (childrenOf.get(pid) ?? []).forEach((c) => {
        if (!out.has(c.id)) {
          out.add(c.id);
          walk(c.id);
        }
      });
    };
    walk(id);
    return out;
  };

  const handleMoveFolder = async (folderId: string, parentId: string | null) => {
    try {
      await onMoveFolder(folderId, parentId);
      toast.success("Carpeta movida");
      if (parentId) setExpanded((p) => new Set(p).add(parentId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const renderPoiRow = (p: SavedPoi, depth: number) => (
    <div
      key={p.id}
      className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50"
      style={{ paddingLeft: `${depth * 20 + 28}px` }}
    >
      <input
        type="checkbox"
        checked={selected.has(p.id)}
        onChange={() => togglePoiSel(p.id)}
        className="h-3.5 w-3.5"
      />
      <MapPin className="h-3 w-3 flex-shrink-0" style={{ color: p.color || "#34D399" }} />
      <span className="flex-1 truncate text-xs" title={p.name}>{p.name}</span>
      {p.category && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {p.category}
        </span>
      )}
      <button
        onClick={() => setEditingPoi(p)}
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-primary/10 hover:text-primary"
        aria-label="Editar"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        onClick={async () => {
          if (!window.confirm(`Eliminar "${p.name}"?`)) return;
          await onDeletePois([p.id]);
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label="Eliminar"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );

  const folderPath = (id: string): string => {
    const f = folders.find((x) => x.id === id);
    if (!f) return "";
    return f.parent_id ? `${folderPath(f.parent_id)} › ${f.name}` : f.name;
  };

  const renderFolder = (f: PoiFolder, depth: number) => {
    const isOpen = expanded.has(f.id);
    const subs = childrenOf.get(f.id) ?? [];
    const myPois = poisByFolder.get(f.id) ?? [];
    const isEditing = editingFolderId === f.id;
    return (
      <div key={f.id}>
        <div
          className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
          style={{ paddingLeft: `${depth * 20 + 4}px` }}
        >
          <button
            onClick={() => toggleExp(f.id)}
            className="flex h-5 w-5 items-center justify-center text-muted-foreground"
            aria-label={isOpen ? "Contraer" : "Expandir"}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <Folder className="h-3.5 w-3.5" style={{ color: f.color || "#FBBF24" }} />
          {isEditing ? (
            <>
              <Input
                value={folderDraft}
                onChange={(e) => setFolderDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameFolder(f.id);
                  if (e.key === "Escape") setEditingFolderId(null);
                }}
                autoFocus
                className="h-6 flex-1 text-xs"
              />
              <button onClick={() => handleRenameFolder(f.id)} className="text-primary"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEditingFolderId(null)} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
            </>
          ) : (
            <>
              <span className="flex-1 text-xs font-medium">{f.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{myPois.length}</span>
              <button
                onClick={() => { setCreatingIn(f.id); setNewFolderName(""); setExpanded((p) => new Set(p).add(f.id)); }}
                className="hidden h-6 w-6 items-center justify-center rounded hover:bg-primary/10 hover:text-primary group-hover:flex"
                aria-label="Nueva subcarpeta"
                title="Nueva subcarpeta"
              >
                <FolderPlus className="h-3 w-3" />
              </button>
              <button
                onClick={() => { setEditingFolderId(f.id); setFolderDraft(f.name); }}
                className="hidden h-6 w-6 items-center justify-center rounded hover:bg-primary/10 hover:text-primary group-hover:flex"
                aria-label="Renombrar"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <Select
                value={f.parent_id ?? "__null__"}
                onValueChange={(v) => handleMoveFolder(f.id, v === "__null__" ? null : v)}
              >
                <SelectTrigger
                  className="hidden h-6 w-6 items-center justify-center rounded border-0 bg-transparent p-0 hover:bg-primary/10 hover:text-primary group-hover:flex [&>svg:last-child]:hidden"
                  aria-label="Mover carpeta"
                  title="Convertir en hija de…"
                >
                  <Move className="h-3 w-3" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__null__">— Raíz (sin padre) —</SelectItem>
                  {folders
                    .filter((opt) => {
                      if (opt.id === f.id) return false;
                      const desc = descendantsOf(f.id);
                      return !desc.has(opt.id);
                    })
                    .map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {folderPath(opt.id)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <button
                onClick={() => handleDeleteFolderPois(f.id)}
                disabled={!myPois.length}
                className="hidden h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex disabled:opacity-30"
                aria-label="Eliminar POIs"
                title="Eliminar todos los POIs de esta carpeta"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleDeleteFolder(f)}
                className="hidden h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                aria-label="Eliminar carpeta"
                title="Eliminar carpeta"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
        {isOpen && (
          <div>
            {creatingIn === f.id && (
              <div className="flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: `${depth * 20 + 28}px` }}>
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFolder(f.id);
                    if (e.key === "Escape") setCreatingIn(null);
                  }}
                  placeholder="Nombre subcarpeta"
                  autoFocus
                  className="h-6 flex-1 text-xs"
                />
                <button onClick={() => handleCreateFolder(f.id)} className="text-primary"><Check className="h-3.5 w-3.5" /></button>
                <button onClick={() => setCreatingIn(null)} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            {subs.map((sub) => renderFolder(sub, depth + 1))}
            {myPois.map((p) => renderPoiRow(p, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const orphanPois = poisByFolder.get(null) ?? [];
  const rootOpen = expanded.has("__root__");
  const folderOptions = [
    { id: "__null__", label: "— Sin carpeta (raíz) —" },
    ...folders.map((f) => ({ id: f.id, label: folderPath(f.id) })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Administrar POIs</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setCreatingIn("__root__"); setNewFolderName(""); }}
          >
            <FolderPlus className="mr-1.5 h-3.5 w-3.5" /> Nueva carpeta
          </Button>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{selected.size} seleccionados</span>
              <Select onValueChange={(v) => handleBulkMove(v === "__null__" ? null : v)}>
                <SelectTrigger className="h-8 w-48 text-xs">
                  <Move className="mr-1.5 h-3.5 w-3.5" />
                  <SelectValue placeholder="Mover a..." />
                </SelectTrigger>
                <SelectContent>
                  {folderOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Eliminar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Limpiar
              </Button>
            </>
          )}
        </div>

        <div className="max-h-[55vh] overflow-y-auto pr-1">
          {creatingIn === "__root__" && (
            <div className="mb-1 flex items-center gap-1.5 px-2 py-1">
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder(null);
                  if (e.key === "Escape") setCreatingIn(null);
                }}
                placeholder="Nombre carpeta"
                autoFocus
                className="h-7 flex-1 text-xs"
              />
              <button onClick={() => handleCreateFolder(null)} className="text-primary"><Check className="h-4 w-4" /></button>
              <button onClick={() => setCreatingIn(null)} className="text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>
          )}

          {rootFolders.map((f) => renderFolder(f, 0))}

          {orphanPois.length > 0 && (
            <div className="mt-2">
              <div
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
              >
                <button
                  onClick={() => toggleExp("__root__")}
                  className="flex h-5 w-5 items-center justify-center text-muted-foreground"
                >
                  {rootOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 text-xs font-medium text-muted-foreground">Sin carpeta</span>
                <span className="font-mono text-[10px] text-muted-foreground">{orphanPois.length}</span>
              </div>
              {rootOpen && orphanPois.map((p) => renderPoiRow(p, 0))}
            </div>
          )}

          {!rootFolders.length && !orphanPois.length && (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No hay carpetas ni POIs. Crea una carpeta o carga puntos desde un archivo.
            </div>
          )}
        </div>

        <PoiEditPanel
          poi={editingPoi}
          folders={folders}
          onCancel={() => setEditingPoi(null)}
          onSave={async (patch) => {
            if (!editingPoi) return;
            try {
              await onUpdatePoi(editingPoi.id, patch);
              toast.success("POI actualizado");
              setEditingPoi(null);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Error");
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

interface EditProps {
  poi: SavedPoi | null;
  folders: PoiFolder[];
  onCancel: () => void;
  onSave: (patch: PoiUpdate) => Promise<void>;
}

const PoiEditPanel = ({ poi, folders, onCancel, onSave }: EditProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState<string>("#34D399");
  const [folderId, setFolderId] = useState<string>("__null__");

  useMemo(() => {
    if (poi) {
      setName(poi.name);
      setDescription(poi.description ?? "");
      setCategory(poi.category ?? "");
      setColor(poi.color || "#34D399");
      setFolderId(poi.folder_id ?? "__null__");
    }
  }, [poi]);

  if (!poi) return null;

  return (
    <Dialog open={!!poi} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar POI</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="poi-name">Nombre</Label>
            <Input id="poi-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="poi-desc">Descripción</Label>
            <Textarea id="poi-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="poi-cat">Categoría</Label>
              <Input id="poi-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Carpeta</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__null__">— Sin carpeta —</SelectItem>
                  {folders.map((f) => {
                    const parent = folders.find((p) => p.id === f.parent_id);
                    return (
                      <SelectItem key={f.id} value={f.id}>
                        {parent ? `${parent.name} › ${f.name}` : f.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={[
                    "h-7 w-7 rounded-full border-2 transition",
                    color === c ? "border-foreground scale-110" : "border-transparent",
                  ].join(" ")}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Coordenadas: {poi.lat.toFixed(5)}, {poi.lng.toFixed(5)}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button
            onClick={() =>
              onSave({
                name: name.trim() || poi.name,
                description: description.trim() || null,
                category: category.trim() || null,
                color,
                folder_id: folderId === "__null__" ? null : folderId,
              })
            }
          >
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
