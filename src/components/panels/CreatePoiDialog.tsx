import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { PoiFolder, PoiInsert } from "@/types/pois";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folder: PoiFolder | null;
  defaultLatLng: { lat: number; lng: number } | null;
  /** Icono y color predominantes entre los hermanos del POI a crear (heredados). */
  inheritedIcon: string | null;
  inheritedColor: string | null;
  onCreate: (payload: PoiInsert) => Promise<void> | void;
}

const COLOR_OPTIONS = [
  "#34D399", "#F472B6", "#FBBF24", "#60A5FA",
  "#A78BFA", "#FB7185", "#22D3EE", "#FB923C", "#94A3B8",
];

export const CreatePoiDialog = ({
  open,
  onOpenChange,
  folder,
  defaultLatLng,
  inheritedIcon,
  inheritedColor,
  onCreate,
}: Props) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState<string>(inheritedColor || COLOR_OPTIONS[0]);
  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Reset al abrir.
  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setCategory("");
    setColor(inheritedColor || COLOR_OPTIONS[0]);
    setLat(defaultLatLng ? defaultLatLng.lat.toFixed(6) : "");
    setLng(defaultLatLng ? defaultLatLng.lng.toFixed(6) : "");
  }, [open, defaultLatLng, inheritedColor]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("El nombre es obligatorio");
      return;
    }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      toast.error("Latitud inválida");
      return;
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      toast.error("Longitud inválida");
      return;
    }

    setBusy(true);
    try {
      await onCreate({
        name: trimmedName,
        description: description.trim() || null,
        category: category.trim() || null,
        color,
        icon: inheritedIcon, // heredado de los hermanos
        lat: latNum,
        lng: lngNum,
        folder_id: folder?.id ?? null,
      });
      toast.success(`POI "${trimmedName}" creado`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear el POI");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Crear POI{folder ? ` en "${folder.name}"` : ""}</DialogTitle>
          <DialogDescription>
            El icono se hereda de los POIs hermanos. Lat/Lng se precargan al centro del mapa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="poi-name" className="text-xs">Nombre *</Label>
            <Input
              id="poi-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Sucursal Las Condes"
              className="h-8 text-sm"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="poi-desc" className="text-xs">Descripción</Label>
            <Textarea
              id="poi-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opcional"
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="poi-cat" className="text-xs">Categoría</Label>
            <Input
              id="poi-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Opcional"
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={[
                    "h-6 w-6 rounded-full border-2 transition-all",
                    color === c ? "border-foreground scale-110" : "border-transparent",
                  ].join(" ")}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="poi-lat" className="text-xs">Latitud *</Label>
              <Input
                id="poi-lat"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-33.45"
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="poi-lng" className="text-xs">Longitud *</Label>
              <Input
                id="poi-lng"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-70.66"
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>

          {inheritedIcon && (
            <p className="text-[10px] text-muted-foreground">
              Icono heredado: <code className="rounded bg-muted px-1">{inheritedIcon.length > 40 ? inheritedIcon.slice(0, 40) + "…" : inheritedIcon}</code>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={busy}>
            {busy ? "Creando…" : "Crear POI"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
