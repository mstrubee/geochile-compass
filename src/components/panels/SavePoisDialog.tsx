import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PoiFolder } from "@/types/pois";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultName: string;
  pointCount: number;
  folders: PoiFolder[];
  onConfirm: (folderId: string | null, opts: { newFolderName?: string; parentId?: string | null }) => Promise<void>;
}

export const SavePoisDialog = ({ open, onOpenChange, defaultName, pointCount, folders, onConfirm }: Props) => {
  const [mode, setMode] = useState<"existing" | "new" | "none">("new");
  const [folderId, setFolderId] = useState<string>("");
  const [newName, setNewName] = useState(defaultName);
  const [parentId, setParentId] = useState<string>("__root__");
  const [busy, setBusy] = useState(false);

  // Re-init when opening
  useMemo(() => {
    if (open) {
      setNewName(defaultName);
      setMode("new");
      setParentId("__root__");
      setFolderId(folders[0]?.id ?? "");
    }
  }, [open, defaultName, folders]);

  const rootFolders = folders.filter((f) => !f.parent_id);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "none") {
        await onConfirm(null, {});
      } else if (mode === "existing") {
        await onConfirm(folderId || null, {});
      } else {
        await onConfirm(null, {
          newFolderName: newName.trim() || defaultName,
          parentId: parentId === "__root__" ? null : parentId,
        });
      }
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Guardar {pointCount} POIs</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
            {(
              [
                { k: "new", l: "Nueva carpeta" },
                { k: "existing", l: "Carpeta existente" },
                { k: "none", l: "Sin carpeta" },
              ] as const
            ).map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => setMode(o.k)}
                className={[
                  "flex-1 rounded-md px-2 py-1.5 transition",
                  mode === o.k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                ].join(" ")}
              >
                {o.l}
              </button>
            ))}
          </div>

          {mode === "new" && (
            <div className="space-y-2">
              <Label htmlFor="newName">Nombre de la carpeta</Label>
              <Input id="newName" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Label htmlFor="parent">Carpeta padre (opcional)</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="parent"><SelectValue placeholder="Raíz" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">— Raíz —</SelectItem>
                  {rootFolders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "existing" && (
            <div className="space-y-2">
              <Label htmlFor="folder">Carpeta destino</Label>
              {folders.length === 0 ? (
                <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  No hay carpetas. Crea una nueva.
                </div>
              ) : (
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger id="folder"><SelectValue /></SelectTrigger>
                  <SelectContent>
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
              )}
            </div>
          )}

          {mode === "none" && (
            <p className="text-xs text-muted-foreground">Los POIs quedarán en la raíz, sin carpeta asociada.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button
            onClick={submit}
            disabled={busy || (mode === "existing" && !folderId)}
          >
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
