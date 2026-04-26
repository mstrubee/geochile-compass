import { useEffect, useMemo, useState } from "react";
import { Crosshair } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { PoiIconPreview } from "./PoiIconPreview";
import type { PoiFolder, PoiInsert, PoiUpdate, SavedPoi } from "@/types/pois";

const COLOR_OPTIONS = [
  "#34D399", "#F472B6", "#FBBF24", "#60A5FA",
  "#A78BFA", "#FB7185", "#22D3EE", "#FB923C", "#94A3B8",
];

const ORPHAN_VALUE = "__orphan__";

export interface PoiEditorDraft {
  name: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  /** True si el icono es heredado y aún no fue tocado por el usuario. */
  iconAuto: boolean;
  lat: string;
  lng: string;
  folderId: string | null;
  sales: string;
}

interface BaseProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Todas las carpetas del usuario (para el desplegable). */
  folders: PoiFolder[];
  /** Todos los POIs del usuario (para calcular icono/color heredados). */
  allPois: SavedPoi[];
  /** Solicita al padre activar el modo "elegir en el mapa". */
  onPickOnMap: (currentDraft: PoiEditorDraft) => void;
  /** Estado externo del draft (permite preservar valores entre picker y reapertura). */
  initialDraft?: Partial<PoiEditorDraft>;
}

interface CreateProps extends BaseProps {
  mode: "create";
  onSubmit: (payload: PoiInsert) => Promise<unknown> | void;
  poi?: undefined;
}

interface EditProps extends BaseProps {
  mode: "edit";
  poi: SavedPoi;
  onSubmit: (id: string, patch: PoiUpdate) => Promise<unknown> | void;
}

type Props = CreateProps | EditProps;

/** Construye una etiqueta jerárquica para el desplegable de carpetas. */
const folderPath = (id: string, byId: Map<string, PoiFolder>): string => {
  const parts: string[] = [];
  let cur: string | null = id;
  let hops = 0;
  while (cur && hops++ < 50) {
    const f = byId.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parent_id;
  }
  return parts.join(" / ");
};

/** Devuelve el icono y color predominante entre los hermanos del folder. */
const inheritedFromSiblings = (
  pois: SavedPoi[],
  folderId: string | null,
  excludeId?: string,
): { icon: string | null; color: string | null } => {
  const sibs = pois.filter(
    (p) => p.folder_id === folderId && p.id !== excludeId,
  );
  const iconCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();
  for (const s of sibs) {
    if (s.icon) iconCounts.set(s.icon, (iconCounts.get(s.icon) ?? 0) + 1);
    if (s.color) colorCounts.set(s.color, (colorCounts.get(s.color) ?? 0) + 1);
  }
  const pick = (m: Map<string, number>): string | null => {
    let best: string | null = null;
    let bestN = 0;
    m.forEach((n, k) => {
      if (n > bestN) {
        bestN = n;
        best = k;
      }
    });
    return best;
  };
  return { icon: pick(iconCounts), color: pick(colorCounts) };
};

export const PoiEditorDialog = (props: Props) => {
  const { open, onOpenChange, folders, allPois, onPickOnMap, initialDraft } = props;
  const isEdit = props.mode === "edit";

  const foldersById = useMemo(() => {
    const m = new Map<string, PoiFolder>();
    folders.forEach((f) => m.set(f.id, f));
    return m;
  }, [folders]);

  // Carpetas ordenadas por path para el desplegable
  const folderOptions = useMemo(() => {
    return folders
      .map((f) => ({ id: f.id, label: folderPath(f.id, foldersById) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folders, foldersById]);

  const [draft, setDraft] = useState<PoiEditorDraft>(() =>
    buildInitialDraft(props, allPois, initialDraft),
  );
  const [busy, setBusy] = useState(false);

  // Reset al abrir, respetando initialDraft (si viene de un picker reabriendo el diálogo)
  useEffect(() => {
    if (!open) return;
    setDraft(buildInitialDraft(props, allPois, initialDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Al cambiar de carpeta, si el icono/color son automáticos, recalcularlos.
  const handleFolderChange = (value: string) => {
    const newFolderId = value === ORPHAN_VALUE ? null : value;
    const inh = inheritedFromSiblings(
      allPois,
      newFolderId,
      isEdit ? props.poi.id : undefined,
    );
    setDraft((d) => ({
      ...d,
      folderId: newFolderId,
      icon: d.iconAuto ? inh.icon ?? "" : d.icon,
      color: d.iconAuto && inh.color ? inh.color : d.color,
    }));
  };

  const handleSubmit = async () => {
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      toast.error("El nombre es obligatorio");
      return;
    }
    const latNum = parseFloat(draft.lat);
    const lngNum = parseFloat(draft.lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      toast.error("Latitud inválida");
      return;
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      toast.error("Longitud inválida");
      return;
    }

    let salesValue: number | null = null;
    if (draft.sales.trim() !== "") {
      const n = parseFloat(draft.sales.replace(/[^\d.\-]/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Ventas inválidas");
        return;
      }
      salesValue = n;
    }

    setBusy(true);
    try {
      if (isEdit) {
        const prevProps =
          (props.poi.properties as Record<string, unknown> | null) ?? {};
        const newProps: Record<string, unknown> = { ...prevProps };
        if (salesValue === null) delete newProps.sales;
        else newProps.sales = salesValue;

        await props.onSubmit(props.poi.id, {
          name: trimmedName,
          description: draft.description.trim() || null,
          category: draft.category.trim() || null,
          color: draft.color || null,
          icon: draft.icon.trim() || null,
          folder_id: draft.folderId,
          properties: newProps,
        });
        toast.success(`POI "${trimmedName}" actualizado`);
      } else {
        const props_obj: Record<string, unknown> = {};
        if (salesValue !== null) props_obj.sales = salesValue;
        await props.onSubmit({
          name: trimmedName,
          description: draft.description.trim() || null,
          category: draft.category.trim() || null,
          color: draft.color || null,
          icon: draft.icon.trim() || null,
          lat: latNum,
          lng: lngNum,
          folder_id: draft.folderId,
          properties: props_obj,
        });
        toast.success(`POI "${trimmedName}" creado`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar "${props.poi.name}"` : "Crear POI"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Edita las propiedades del POI. El icono y la carpeta pueden cambiarse en cualquier momento."
              : "Define las propiedades del POI. El icono se hereda de los hermanos de la carpeta destino."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Preview de icono */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
            <PoiIconPreview icon={draft.icon || null} color={draft.color} size={40} />
            <div className="flex-1 text-xs">
              <div className="font-medium text-foreground">Vista previa</div>
              <div className="text-muted-foreground">
                {draft.icon ? "Icono personalizado" : "Marcador circular del color elegido"}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="poi-name" className="text-xs">Nombre *</Label>
            <Input
              id="poi-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Ej: Sucursal Las Condes"
              className="h-8 text-sm"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="poi-folder" className="text-xs">Carpeta</Label>
            <Select
              value={draft.folderId ?? ORPHAN_VALUE}
              onValueChange={handleFolderChange}
            >
              <SelectTrigger id="poi-folder" className="h-8 text-sm">
                <SelectValue placeholder="Sin carpeta" />
              </SelectTrigger>
              <SelectContent className="z-[1100]">
                <SelectItem value={ORPHAN_VALUE}>— Sin carpeta —</SelectItem>
                {folderOptions.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="poi-desc" className="text-xs">Descripción</Label>
            <Textarea
              id="poi-desc"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Opcional"
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="poi-cat" className="text-xs">Categoría</Label>
              <Input
                id="poi-cat"
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                placeholder="Opcional"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="poi-sales" className="text-xs">Ventas (opcional)</Label>
              <Input
                id="poi-sales"
                value={draft.sales}
                onChange={(e) => setDraft((d) => ({ ...d, sales: e.target.value }))}
                placeholder="Ej: 12500000"
                inputMode="decimal"
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, color: c, iconAuto: false }))}
                  className={[
                    "h-6 w-6 rounded-full border-2 transition-all",
                    draft.color === c ? "border-foreground scale-110" : "border-transparent",
                  ].join(" ")}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="poi-icon" className="text-xs">
              Icono (URL de imagen, opcional)
            </Label>
            <Input
              id="poi-icon"
              value={draft.icon}
              onChange={(e) =>
                setDraft((d) => ({ ...d, icon: e.target.value, iconAuto: false }))
              }
              placeholder="https://… .png  /  data:image/…"
              className="h-8 font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              {draft.iconAuto
                ? "Heredado de los POIs hermanos. Edítalo para personalizarlo."
                : "Si está vacío, se usará un círculo del color elegido."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="poi-lat" className="text-xs">Latitud *</Label>
              <Input
                id="poi-lat"
                value={draft.lat}
                onChange={(e) => setDraft((d) => ({ ...d, lat: e.target.value }))}
                placeholder="-33.45"
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="poi-lng" className="text-xs">Longitud *</Label>
              <Input
                id="poi-lng"
                value={draft.lng}
                onChange={(e) => setDraft((d) => ({ ...d, lng: e.target.value }))}
                placeholder="-70.66"
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onPickOnMap(draft)}
          >
            <Crosshair className="mr-2 h-3.5 w-3.5" />
            Elegir posición en el mapa…
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={busy}>
            {busy ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear POI"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

function buildInitialDraft(
  props: Props,
  allPois: SavedPoi[],
  initialDraft: Partial<PoiEditorDraft> | undefined,
): PoiEditorDraft {
  if (props.mode === "edit") {
    const p = props.poi;
    const sales =
      p.properties && typeof (p.properties as Record<string, unknown>).sales === "number"
        ? String((p.properties as Record<string, unknown>).sales)
        : "";
    const base: PoiEditorDraft = {
      name: p.name,
      description: p.description ?? "",
      category: p.category ?? "",
      color: p.color || "#34D399",
      icon: p.icon ?? "",
      iconAuto: false,
      lat: p.lat.toFixed(6),
      lng: p.lng.toFixed(6),
      folderId: p.folder_id,
      sales,
    };
    return { ...base, ...initialDraft };
  }
  // create
  const folderId = initialDraft?.folderId ?? null;
  const inh = inheritedFromSiblings(allPois, folderId);
  const base: PoiEditorDraft = {
    name: "",
    description: "",
    category: "",
    color: inh.color || "#34D399",
    icon: inh.icon ?? "",
    iconAuto: true,
    lat: "",
    lng: "",
    folderId,
    sales: "",
  };
  return { ...base, ...initialDraft };
}
