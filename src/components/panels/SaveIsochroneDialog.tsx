import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppDialog } from "@/components/ui/app-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FolderPlus, Save } from "lucide-react";
import type { IsochroneFolder, SaveIsochronePayload } from "@/types/savedIsochrones";
import type { Isochrone } from "@/types/isochrones";
import { ISO_MODE_LABEL } from "@/types/isochrones";

interface Props {
  open: boolean;
  onClose: () => void;
  isochrone: Isochrone | null;
  folders: IsochroneFolder[];
  onSave: (payload: SaveIsochronePayload) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<{ id: string } | null | void>;
  defaultName?: string;
}

const buildIndentedList = (folders: IsochroneFolder[]) => {
  const byParent = new Map<string | null, IsochroneFolder[]>();
  for (const f of folders) {
    const k = f.parent_id;
    const arr = byParent.get(k) ?? [];
    arr.push(f);
    byParent.set(k, arr);
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    const items = (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const it of items) {
      out.push({ id: it.id, label: `${"— ".repeat(depth)}${it.name}` });
      walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
};

export const SaveIsochroneDialog = ({
  open,
  onClose,
  isochrone,
  folders,
  onSave,
  onCreateFolder,
  defaultName,
}: Props) => {
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && isochrone) {
      setName(
        defaultName ??
          `${ISO_MODE_LABEL[isochrone.mode]} · ${isochrone.minutes.join("/")}min`,
      );
      setFolderId(null);
      setCreatingFolder(false);
      setNewFolderName("");
    }
  }, [open, isochrone, defaultName]);

  const folderOptions = useMemo(() => buildIndentedList(folders), [folders]);

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const created = await onCreateFolder(trimmed, null);
    if (created && "id" in created && created.id) setFolderId(created.id);
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const handleSave = async () => {
    if (!isochrone) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave({
        name: trimmed,
        folder_id: folderId,
        mode: isochrone.mode,
        minutes: isochrone.minutes,
        center_lat: isochrone.center.lat,
        center_lng: isochrone.center.lng,
        color: isochrone.color,
        features: isochrone.features,
        source_lat: isochrone.center.lat,
        source_lng: isochrone.center.lng,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      icon={Save}
      tone="primary"
      title="Guardar isócrona"
      description="Asigna un nombre y elige una carpeta para organizarla."
      cancelLabel="Cancelar"
      confirmLabel={saving ? "Guardando…" : "Guardar"}
      onConfirm={handleSave}
      confirmDisabled={saving || !name.trim()}
      confirmLoading={saving}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="iso-name" className="text-xs">Nombre</Label>
          <Input
            id="iso-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mi isócrona"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="iso-folder" className="text-xs">Carpeta</Label>
            <button
              type="button"
              onClick={() => setCreatingFolder((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <FolderPlus className="h-3 w-3" /> Nueva
            </button>
          </div>
          {creatingFolder ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                placeholder="Nombre de carpeta"
              />
              <Button size="sm" onClick={handleCreateFolder}>
                Crear
              </Button>
            </div>
          ) : (
            <select
              id="iso-folder"
              value={folderId ?? ""}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— Sin carpeta —</option>
              {folderOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </AppDialog>
  );
};
