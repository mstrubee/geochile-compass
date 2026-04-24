import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PoiFolder } from "@/types/pois";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultName: string;
  pointCount: number;
  folders: PoiFolder[];
  onCreateFolder: (name: string, parentId: string | null) => Promise<PoiFolder>;
  onRefreshFolders?: () => Promise<void> | void;
  /** folderId final (puede ser null = raíz) */
  onConfirm: (folderId: string | null) => Promise<void>;
}

const ROOT = "__root__";
const NEW = "__new__";

export const SavePoisDialog = ({
  open,
  onOpenChange,
  defaultName,
  pointCount,
  folders,
  onCreateFolder,
  onRefreshFolders,
  onConfirm,
}: Props) => {
  // Selección del nivel 1 (carpeta raíz): id, ROOT, o NEW
  const [rootSel, setRootSel] = useState<string>(ROOT);
  const [newRootName, setNewRootName] = useState("");

  // Selección del nivel 2 (subcarpeta): id, ROOT (= ninguna), o NEW
  const [subSel, setSubSel] = useState<string>(ROOT);
  const [newSubName, setNewSubName] = useState("");

  const [busy, setBusy] = useState(false);
  const [creatingRoot, setCreatingRoot] = useState(false);

  const rootFolders = useMemo(() => folders.filter((f) => !f.parent_id), [folders]);
  const childrenOfSel = useMemo(
    () => (rootSel && rootSel !== ROOT && rootSel !== NEW ? folders.filter((f) => f.parent_id === rootSel) : []),
    [folders, rootSel],
  );

  // Reset al abrir + refresh
  useEffect(() => {
    if (open) {
      setRootSel(ROOT);
      setNewRootName(defaultName);
      setSubSel(ROOT);
      setNewSubName("");
      onRefreshFolders?.();
    }
  }, [open, defaultName, onRefreshFolders]);

  // Reset subcarpeta al cambiar carpeta padre
  useEffect(() => {
    setSubSel(ROOT);
    setNewSubName("");
  }, [rootSel]);

  // Crear carpeta raíz inline (la deja seleccionada)
  const createRootInline = async () => {
    const name = newRootName.trim();
    if (!name) {
      toast.error("Escribe un nombre");
      return;
    }
    setCreatingRoot(true);
    try {
      const f = await onCreateFolder(name, null);
      await onRefreshFolders?.();
      setRootSel(f.id);
      setNewRootName("");
      toast.success(`Carpeta "${f.name}" creada`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error creando carpeta");
    } finally {
      setCreatingRoot(false);
    }
  };

  const canSubmit =
    !busy &&
    (rootSel !== NEW || newRootName.trim().length > 0) &&
    (subSel !== NEW || newSubName.trim().length > 0);

  const submit = async () => {
    setBusy(true);
    try {
      // Resolver carpeta raíz final
      let rootId: string | null = null;
      if (rootSel === ROOT) {
        rootId = null;
      } else if (rootSel === NEW) {
        const created = await onCreateFolder(newRootName.trim(), null);
        rootId = created.id;
      } else {
        rootId = rootSel;
      }

      // Resolver subcarpeta final
      let finalId: string | null = rootId;
      if (rootId && subSel === NEW) {
        const created = await onCreateFolder(newSubName.trim(), rootId);
        finalId = created.id;
      } else if (rootId && subSel !== ROOT && subSel !== NEW) {
        finalId = subSel;
      }

      await onConfirm(finalId);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[1000] max-w-md">
        <DialogHeader>
          <DialogTitle>Guardar {pointCount} POIs</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Nivel 1: Carpeta */}
          <div className="space-y-1.5">
            <Label htmlFor="rootSel">Carpeta</Label>
            <Select value={rootSel} onValueChange={setRootSel}>
              <SelectTrigger id="rootSel"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT}>— Sin carpeta (raíz) —</SelectItem>
                {rootFolders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
                <SelectItem value={NEW}>
                  <span className="flex items-center gap-1.5">
                    <FolderPlus className="h-3.5 w-3.5" />
                    Crear nueva carpeta…
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            {rootSel === NEW && (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Nombre de la nueva carpeta"
                  value={newRootName}
                  onChange={(e) => setNewRootName(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={createRootInline}
                  disabled={creatingRoot || !newRootName.trim()}
                >
                  {creatingRoot ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear"}
                </Button>
              </div>
            )}
          </div>

          {/* Nivel 2: Subcarpeta (solo si hay padre seleccionado) */}
          {rootSel !== ROOT && rootSel !== NEW && (
            <div className="space-y-1.5">
              <Label htmlFor="subSel">Subcarpeta (opcional)</Label>
              <Select value={subSel} onValueChange={setSubSel}>
                <SelectTrigger id="subSel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT}>— Sin subcarpeta —</SelectItem>
                  {childrenOfSel.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                  <SelectItem value={NEW}>
                    <span className="flex items-center gap-1.5">
                      <FolderPlus className="h-3.5 w-3.5" />
                      Crear nueva subcarpeta…
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              {subSel === NEW && (
                <Input
                  placeholder="Nombre de la nueva subcarpeta"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                />
              )}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Máximo 2 niveles: Carpeta › Subcarpeta.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
