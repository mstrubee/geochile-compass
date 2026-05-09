import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PoiFolder } from "@/types/pois";
import type {
  FolderSchemaType,
  MetricDefinition,
  MetricFormat,
  MetricKind,
  PoiFolderSchema,
} from "@/types/poiMetrics";

interface Props {
  open: boolean;
  onClose: () => void;
  folder: PoiFolder | null;
  schema: PoiFolderSchema | null;
  onSave: (s: Partial<PoiFolderSchema> & { folder_id: string }) => Promise<void>;
}

const SCHEMA_TYPES: Array<{ id: FolderSchemaType; label: string; description: string }> = [
  {
    id: "autoplanet",
    label: "AutoPlanet (formato wide)",
    description:
      "7 columnas de identidad + columnas mensuales con la métrica. Una fila por local.",
  },
  {
    id: "generic_wide",
    label: "Genérico wide",
    description: "Igual a AutoPlanet pero con identity/static/métrica configurables.",
  },
  {
    id: "generic_long",
    label: "Genérico long",
    description: "Una fila por (local, período). No soportado en este release.",
  },
];

const PRESET_AUTOPLANET: Pick<
  PoiFolderSchema,
  "schema_type" | "identity_columns" | "metric_definitions" | "static_columns"
> = {
  schema_type: "autoplanet",
  identity_columns: ["Centro Sap", "Local", "Nombre Local", "Dirección", "Comuna"],
  metric_definitions: [
    { key: "ventas", label: "Ventas", kind: "timeseries", format: "clp", aggregation: "sum" },
  ],
  static_columns: ["Centro Sap", "Local", "Nombre Local", "Gerente Zonal", "Zona"],
};

export const PoiFolderSchemaDialog = ({ open, onClose, folder, schema, onSave }: Props) => {
  const [type, setType] = useState<FolderSchemaType>("autoplanet");
  const [identity, setIdentity] = useState<string[]>([]);
  const [staticCols, setStaticCols] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [importEnabled, setImportEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (schema) {
      setType(schema.schema_type);
      setIdentity(schema.identity_columns);
      setStaticCols(schema.static_columns);
      setMetrics(schema.metric_definitions);
      setImportEnabled(schema.import_enabled);
    } else {
      // valores por defecto: AutoPlanet
      setType(PRESET_AUTOPLANET.schema_type);
      setIdentity(PRESET_AUTOPLANET.identity_columns);
      setStaticCols(PRESET_AUTOPLANET.static_columns);
      setMetrics(PRESET_AUTOPLANET.metric_definitions);
      setImportEnabled(true);
    }
  }, [open, schema]);

  const applyPreset = () => {
    setType(PRESET_AUTOPLANET.schema_type);
    setIdentity(PRESET_AUTOPLANET.identity_columns);
    setStaticCols(PRESET_AUTOPLANET.static_columns);
    setMetrics(PRESET_AUTOPLANET.metric_definitions);
  };

  const handleSave = async () => {
    if (!folder) return;
    setSaving(true);
    try {
      await onSave({
        folder_id: folder.id,
        schema_type: type,
        identity_columns: identity,
        static_columns: staticCols,
        metric_definitions: metrics,
        import_enabled: importEnabled,
      });
      toast.success("Esquema guardado");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurar importación · {folder?.name ?? ""}</DialogTitle>
          <DialogDescription className="text-[11px]">
            Define qué columnas se esperan en el Excel y qué métricas extraer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tipo */}
          <div>
            <Label className="text-[11px]">Tipo de planilla</Label>
            <div className="mt-1 grid gap-1.5">
              {SCHEMA_TYPES.map((t) => (
                <label
                  key={t.id}
                  className={[
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-2",
                    type === t.id
                      ? "border-primary bg-primary/5"
                      : "border-border/40 bg-surface-2/40 hover:bg-surface-2/60",
                    t.id === "generic_long" ? "cursor-not-allowed opacity-50" : "",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    checked={type === t.id}
                    onChange={() => setType(t.id)}
                    disabled={t.id === "generic_long"}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium">{t.label}</div>
                    <div className="text-[10px] text-muted-foreground">{t.description}</div>
                  </div>
                </label>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="mt-2 h-7 text-[11px]" onClick={applyPreset}>
              Restaurar preset AutoPlanet
            </Button>
          </div>

          {/* Identity */}
          <div>
            <Label className="text-[11px]">
              Columnas de identidad ({identity.length})
            </Label>
            <ColList items={identity} onChange={setIdentity} placeholder="Nombre exacto de columna" />
            <div className="mt-1 text-[10px] text-muted-foreground">
              Estas columnas se usan para identificar la fila. Debe incluir "Dirección" y "Comuna".
            </div>
          </div>

          {/* Static */}
          <div>
            <Label className="text-[11px]">
              Columnas estáticas a guardar ({staticCols.length})
            </Label>
            <ColList items={staticCols} onChange={setStaticCols} placeholder="Nombre exacto de columna" />
            <div className="mt-1 text-[10px] text-muted-foreground">
              Se guardan como atributos del POI (ej. Centro Sap, Gerente Zonal).
            </div>
          </div>

          {/* Métricas */}
          <div>
            <Label className="text-[11px]">Métricas ({metrics.length})</Label>
            <div className="mt-1 space-y-1.5">
              {metrics.map((m, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1.2fr_1.5fr_90px_90px_28px] gap-1 rounded-md border border-border/40 bg-surface-2/40 p-1.5"
                >
                  <Input
                    value={m.key}
                    onChange={(e) => updateMetric(metrics, setMetrics, idx, { key: e.target.value })}
                    placeholder="key"
                    className="h-7 text-[11px]"
                  />
                  <Input
                    value={m.label}
                    onChange={(e) => updateMetric(metrics, setMetrics, idx, { label: e.target.value })}
                    placeholder="Etiqueta"
                    className="h-7 text-[11px]"
                  />
                  <select
                    value={m.kind}
                    onChange={(e) =>
                      updateMetric(metrics, setMetrics, idx, { kind: e.target.value as MetricKind })
                    }
                    className="h-7 rounded-md border border-input bg-background px-2 text-[11px]"
                  >
                    <option value="timeseries">Temporal</option>
                    <option value="static_number">Estático nº</option>
                    <option value="static_text">Estático txt</option>
                  </select>
                  <select
                    value={m.format}
                    onChange={(e) =>
                      updateMetric(metrics, setMetrics, idx, { format: e.target.value as MetricFormat })
                    }
                    className="h-7 rounded-md border border-input bg-background px-2 text-[11px]"
                  >
                    <option value="clp">CLP</option>
                    <option value="int">Entero</option>
                    <option value="decimal">Decimal</option>
                    <option value="percent">%</option>
                    <option value="text">Texto</option>
                  </select>
                  <button
                    onClick={() => setMetrics(metrics.filter((_, i) => i !== idx))}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() =>
                  setMetrics([
                    ...metrics,
                    { key: "", label: "", kind: "timeseries", format: "decimal", aggregation: "sum" },
                  ])
                }
              >
                <Plus className="mr-1 h-3 w-3" /> Agregar métrica
              </Button>
            </div>
          </div>

          {/* Toggle */}
          <label className="flex cursor-pointer items-center gap-2 rounded-md bg-surface-2/40 p-2">
            <input
              type="checkbox"
              checked={importEnabled}
              onChange={(e) => setImportEnabled(e.target.checked)}
            />
            <span className="text-[12px]">Habilitar importación de Excel para esta carpeta</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border/40 pt-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const updateMetric = (
  list: MetricDefinition[],
  setList: (v: MetricDefinition[]) => void,
  idx: number,
  patch: Partial<MetricDefinition>,
) => {
  setList(list.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
};

const ColList = ({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) => {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((c, idx) => (
          <span
            key={c + idx}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-border/40 bg-surface-3/50 px-2 text-[10px]"
          >
            <span className="font-mono">{c}</span>
            <button
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onChange([...items, draft.trim()]);
              setDraft("");
            }
          }}
          placeholder={placeholder}
          className="h-7 text-[11px]"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => {
            if (draft.trim()) {
              onChange([...items, draft.trim()]);
              setDraft("");
            }
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};
