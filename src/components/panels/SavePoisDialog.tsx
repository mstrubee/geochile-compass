import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderPlus } from "lucide-react";
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
  // existing-mode state
  const [rootId, setRootId] = useState<string>("");
  const [subId, setSubId] = useState<string>("__none__"); // "__none__" = la raíz; "__new__" = crear subcarpeta
  const [newSubName, setNewSubName] = useState("");
  // new-folder-mode state
  const [newName, setNewName] = useState(defaultName);
  const [parentId, setParentId] = useState<string>("__root__");
  const [busy, setBusy] = useState(false);

  const rootFolders = useMemo(() => folders.filter((f) => !f.parent_id), [folders]);
  const childrenOfRoot = useMemo(
    () => folders.filter((f) => f.parent_id === rootId),
    [folders, rootId],
  );

  // Re-init when opening
  useEffect(() => {
    if (open) {
      setNewName(defaultName);
      setMode("new");
      setParentId("__root__");
      setRootId(rootFolders[0]?.id ?? "");
      setSubId("__none__");
      setNewSubName("");
    }
  }, [open, defaultName, rootFolders]);

  // Reset sub selection when changing root
  useEffect(() => {
    setSubId("__none__");
    setNewSubName("");
  }, [rootId]);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "none") {
        await onConfirm(null, {});
      } else if (mode === "existing") {
        if (!rootId) return;
        if (subId === "__new__") {
          const name = newSubName.trim();
          if (!name) return;
          await onConfirm(null, { newFolderName: name, parentId: rootId });
        } else if (subId === "__none__") {
          await onConfirm(rootId, {});
        } else {
          await onConfirm(subId, {});
        }
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

  const existingDisabled =
    mode === "existing" &&
    (!rootId || (subId === "__new__" && !newSubName.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[1000] max-w-md">
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
              <p className="text-[11px] text-muted-foreground">
                Máximo 2 niveles: Carpeta › Subcarpeta.
              </p>
            </div>
          )}

          {mode === "existing" && (
            <div className="space-y-2">
              {rootFolders.length === 0 ? (
                <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  No hay carpetas. Crea una nueva.
                </div>
              ) : (
                <>
                  <Label htmlFor="rootFolder">Carpeta</Label>
                  <Select value={rootId} onValueChange={setRootId}>
                    <SelectTrigger id="rootFolder"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {rootFolders.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {rootId && (
                    <>
                      <Label htmlFor="subFolder">Subcarpeta</Label>
                      <Select value={subId} onValueChange={setSubId}>
                        <SelectTrigger id="subFolder"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Sin subcarpeta —</SelectItem>
                          {childrenOfRoot.map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                          <SelectItem value="__new__">
                            <span className="flex items-center gap-1.5">
                              <FolderPlus className="h-3.5 w-3.5" />
                              Crear nueva subcarpeta…
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      {subId === "__new__" && (
                        <Input
                          autoFocus
                          placeholder="Nombre de la nueva subcarpeta"
                          value={newSubName}
                          onChange={(e) => setNewSubName(e.target.value)}
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {mode === "none" && (
            <p className="text-xs text-muted-foreground">Los POIs quedarán en la raíz, sin carpeta asociada.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || existingDisabled}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
