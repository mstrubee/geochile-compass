import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronRight, FolderPlus, Loader2, X } from "lucide-react";
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

const NONE = "__none__"; // "no bajar más / quedar aquí"
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
  /**
   * Path = lista ordenada de IDs de carpetas desde la raíz hasta la carpeta destino.
   * Cada nivel adicional muestra un Select con los hijos de la carpeta del nivel anterior.
   */
  const [path, setPath] = useState<string[]>([]);
  // Selección pendiente del último nivel: undefined = aún no decide, NONE/NEW = controles
  const [pendingSel, setPendingSel] = useState<string>(NONE);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const childrenMap = useMemo(() => {
    const m = new Map<string | null, PoiFolder[]>();
    folders.forEach((f) => {
      const k = f.parent_id;
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    });
    return m;
  }, [folders]);

  const currentParentId: string | null = path.length ? path[path.length - 1] : null;
  const optionsAtCurrent = childrenMap.get(currentParentId) ?? [];

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setPath([]);
      setPendingSel(NONE);
      setNewName(defaultName);
      onRefreshFolders?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cuando cambia el padre actual, resetear la selección pendiente
  useEffect(() => {
    setPendingSel(NONE);
    setNewName(defaultName);
  }, [currentParentId, defaultName]);

  const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? "?";

  const goDown = (id: string) => {
    setPath((p) => [...p, id]);
  };

  const popLevel = (idx: number) => {
    // Volver al nivel idx (descarta lo que está después)
    setPath((p) => p.slice(0, idx));
  };

  const createHere = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Escribe un nombre");
      return;
    }
    setCreating(true);
    try {
      const f = await onCreateFolder(name, currentParentId);
      await onRefreshFolders?.();
      setPath((p) => [...p, f.id]);
      setPendingSel(NONE);
      setNewName("");
      toast.success(`Carpeta "${f.name}" creada`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error creando carpeta");
    } finally {
      setCreating(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      let finalId: string | null = currentParentId;
      // Si el usuario eligió bajar a una carpeta existente sin haberla "fijado"
      if (pendingSel !== NONE && pendingSel !== NEW) {
        finalId = pendingSel;
      }
      // Si pendingSel === NEW y hay nombre, crear y guardar dentro
      if (pendingSel === NEW && newName.trim()) {
        const f = await onCreateFolder(newName.trim(), currentParentId);
        finalId = f.id;
      }
      await onConfirm(finalId);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && (pendingSel !== NEW || newName.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[1000] max-w-md">
        <DialogHeader>
          <DialogTitle>Guardar {pointCount} POIs</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Breadcrumb del destino actual */}
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
            <button
              type="button"
              onClick={() => popLevel(0)}
              className={["rounded px-1.5 py-0.5", path.length === 0 ? "bg-background font-medium" : "hover:bg-background/60"].join(" ")}
            >
              Raíz
            </button>
            {path.map((id, i) => (
              <span key={id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => popLevel(i + 1)}
                  className={[
                    "rounded px-1.5 py-0.5",
                    i === path.length - 1 ? "bg-background font-medium" : "hover:bg-background/60",
                  ].join(" ")}
                >
                  {folderName(id)}
                </button>
              </span>
            ))}
            {path.length > 0 && (
              <button
                type="button"
                onClick={() => popLevel(0)}
                className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background/60"
                aria-label="Volver a raíz"
                title="Volver a raíz"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Selector del siguiente nivel (o quedarse aquí / crear nueva) */}
          <div className="space-y-1.5">
            <Label htmlFor="lvlSel">
              {path.length === 0 ? "Carpeta destino" : "Subcarpeta (opcional)"}
            </Label>
            <Select value={pendingSel} onValueChange={setPendingSel}>
              <SelectTrigger id="lvlSel"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {path.length === 0 ? "— Sin carpeta (raíz) —" : "— Guardar aquí —"}
                </SelectItem>
                {optionsAtCurrent.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
                <SelectItem value={NEW}>
                  <span className="flex items-center gap-1.5">
                    <FolderPlus className="h-3.5 w-3.5" />
                    Crear nueva {path.length === 0 ? "carpeta" : "subcarpeta"}…
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Si elige una existente: botón para entrar dentro y seguir bajando */}
            {pendingSel !== NONE && pendingSel !== NEW && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => goDown(pendingSel)}
                className="w-full"
              >
                Entrar a "{folderName(pendingSel)}" y elegir subcarpeta
              </Button>
            )}

            {/* Si elige crear nueva: input + crear (entra dentro) o aceptar al guardar */}
            {pendingSel === NEW && (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Nombre de la nueva carpeta"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={createHere}
                  disabled={creating || !newName.trim()}
                  title="Crear y entrar dentro para añadir más subcarpetas"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear"}
                </Button>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Sin límite de niveles. Usa el breadcrumb para subir o navegar.
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
