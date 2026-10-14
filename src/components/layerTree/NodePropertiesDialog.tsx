import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { StyleProps } from "@/hooks/useLayerTreeEditor";
import type { TreeRow } from "@/utils/layerTree";

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_PICKER_COLOR = "#f59e0b";

interface Props {
  /** Carpeta o capa a editar; `null` cierra el diálogo. */
  row: TreeRow | null;
  onClose: () => void;
  /** Solo trae las propiedades que cambiaron (`null` borra la propiedad). */
  onSave: (id: string, patch: StyleProps) => void;
}

/** Color, ícono y opacidad compartidos de una carpeta o capa. Los ve todo el equipo. */
export const NodePropertiesDialog = ({ row, onClose, onSave }: Props) => {
  const style = row?.node?.style;
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState("");
  const [opacity, setOpacity] = useState(100);

  useEffect(() => {
    if (!row) return;
    setColor(style?.color ?? "");
    setIcon(style?.icon ?? "");
    setOpacity(Math.round((style?.opacity ?? 1) * 100));
  }, [row, style?.color, style?.icon, style?.opacity]);

  if (!row) return null;
  const isLayer = row.kind === "layer";
  const colorOk = color === "" || HEX.test(color);

  const save = () => {
    const patch: StyleProps = {};
    const nextColor = color === "" ? null : color.toLowerCase();
    if (nextColor !== (style?.color?.toLowerCase() ?? null)) patch.color = nextColor;
    const nextIcon = icon.trim() === "" ? null : icon.trim();
    if (nextIcon !== (style?.icon ?? null)) patch.icon = nextIcon;
    // 100 % es el valor por defecto: no se guarda.
    const nextOpacity = opacity >= 100 ? null : opacity / 100;
    if (nextOpacity !== (style?.opacity ?? null)) patch.opacity = nextOpacity;
    if (Object.keys(patch).length) onSave(row.id, patch);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="z-[1300] max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate">Propiedades de “{row.name}”</DialogTitle>
          <DialogDescription>
            Estos cambios los ve todo el equipo. Para cambiar solo cómo la ves tú, usa “Mi estilo en este equipo”.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="node-color">Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Elegir color"
                value={HEX.test(color) ? color : DEFAULT_PICKER_COLOR}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
              />
              <Input
                id="node-color"
                value={color}
                onChange={(e) => setColor(e.target.value.trim())}
                placeholder="#RRGGBB (sin color)"
                className="font-mono text-[12px]"
                aria-invalid={!colorOk}
              />
              {color !== "" && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setColor("")}>
                  Quitar
                </Button>
              )}
            </div>
            {!colorOk && <p className="text-[11px] text-destructive">Usa el formato #RRGGBB, por ejemplo #10B981.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="node-icon">Ícono</Label>
            <Input
              id="node-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="Un emoji (🏥) o la URL de una imagen"
              maxLength={2048}
            />
          </div>

          {isLayer && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="node-opacity">Opacidad en el mapa</Label>
                <span className="font-mono text-[11px] text-muted-foreground">{opacity}%</span>
              </div>
              <Slider id="node-opacity" min={10} max={100} step={5} value={[opacity]} onValueChange={([v]) => setOpacity(v)} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={!colorOk}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
