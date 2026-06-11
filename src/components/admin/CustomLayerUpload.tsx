/**
 * CustomLayerUpload.tsx
 * ──────────────────────
 * Panel admin para subir archivos (CSV, GeoJSON, KML) y convertirlos en
 * capas persistentes que se muestran en el mapa.
 *
 * Requiere la tabla `custom_layers` en Supabase (ver useCustomLayers.ts).
 */

import { useState, useRef, useCallback } from "react";
import {
  Upload, Trash2, Eye, EyeOff, Layers, X, CheckCircle, AlertCircle, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCustomLayers } from "@/hooks/useCustomLayers";
import { detectGeoFormat, parseGeoFileContent } from "@/utils/parseGeoFile";
import type { FeatureCollection } from "geojson";

// ── Colores disponibles ───────────────────────────────────────────────────────

const COLOR_PALETTE = [
  "#3B82F6", // blue
  "#10B981", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // purple
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F97316", // orange
  "#6366F1", // indigo
  "#84CC16", // lime
];

// ── Tipos locales ─────────────────────────────────────────────────────────────

interface ParsedPreview {
  filename: string;
  format: "csv" | "geojson" | "kml";
  featureCount: number;
  geojson: FeatureCollection;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Callback para notificar al mapa que debe actualizar las capas. */
  onLayersChange?: () => void;
}

// ── Componente ────────────────────────────────────────────────────────────────

export const CustomLayerUpload = ({ open, onOpenChange, onLayersChange }: Props) => {
  const { layers, loading, asUserLayers: _ul, addLayer, deleteLayer, toggleVisibility, visMap, reload } = useCustomLayers();

  // Estado del formulario de carga
  const [preview, setPreview]   = useState<ParsedPreview | null>(null);
  const [name, setName]         = useState("");
  const [color, setColor]       = useState(COLOR_PALETTE[0]);
  const [icon, setIcon]         = useState("📍");
  const [saving, setSaving]     = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);

  // ── Leer y parsear archivo ────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setParseErr(null);
    setPreview(null);

    const format = detectGeoFormat(file.name);
    if (!format) {
      setParseErr("Formato no soportado. Usa .csv, .geojson o .kml");
      return;
    }

    const text = await file.text();
    try {
      const geojson = parseGeoFileContent(text, format);
      setPreview({ filename: file.name, format, featureCount: geojson.features.length, geojson });
      setName(file.name.replace(/\.(csv|geojson|json|kml)$/i, ""));
    } catch (e) {
      setParseErr((e as Error).message);
    }
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  // Drag & drop
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // ── Guardar capa en DB ────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!preview || !name.trim()) return;
    setSaving(true);
    try {
      await addLayer({
        name: name.trim(),
        color_hex: color,
        icon_emoji: icon,
        geojson: preview.geojson,
        feature_count: preview.featureCount,
      });
      toast.success(`Capa "${name}" guardada`, {
        description: `${preview.featureCount.toLocaleString()} elementos en el mapa`,
      });
      setPreview(null);
      setName("");
      onLayersChange?.();
    } catch (e) {
      toast.error("Error al guardar", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  // ── Eliminar capa ─────────────────────────────────────────────────────────

  const handleDelete = async (id: string, layerName: string) => {
    await deleteLayer(id);
    toast.success(`Capa "${layerName}" eliminada`);
    onLayersChange?.();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Capas Personalizadas"
      description="Sube archivos CSV, GeoJSON o KML para añadirlos como capas en el mapa"
      icon={Layers}
      size="2xl"
    >
      <div className="flex flex-col gap-5 p-4 max-h-[70vh] overflow-y-auto">

        {/* ── Zona de carga ─────────────────────────────────────────────── */}
        <div
          className={[
            "rounded-xl border-2 border-dashed transition-colors cursor-pointer",
            dragging
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
              : "border-border hover:border-blue-400 hover:bg-surface-2/40",
          ].join(" ")}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="flex flex-col items-center gap-2 py-7 px-4 text-center">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-[14px] font-medium text-foreground">
              Arrastra un archivo o haz click para seleccionar
            </p>
            <p className="text-[12px] text-muted-foreground">
              Formatos: <span className="font-mono">.csv</span> · <span className="font-mono">.geojson</span> · <span className="font-mono">.json</span> · <span className="font-mono">.kml</span>
            </p>
            <p className="text-[11px] text-text-muted mt-1">
              CSV: debe tener columnas <span className="font-mono">lat</span> y <span className="font-mono">lng</span> (o variantes en español/inglés)
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.geojson,.json,.kml"
            className="hidden"
            onChange={onFileInput}
          />
        </div>

        {/* ── Error de parseo ───────────────────────────────────────────── */}
        {parseErr && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900 dark:bg-red-950/30">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-500 mt-0.5" />
            <p className="text-[12px] text-red-700 dark:text-red-400 whitespace-pre-line">{parseErr}</p>
          </div>
        )}

        {/* ── Preview + formulario ──────────────────────────────────────── */}
        {preview && (
          <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20 p-4 space-y-4">
            {/* Info del archivo */}
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-foreground truncate">{preview.filename}</p>
                <p className="text-[11px] text-muted-foreground">
                  {preview.featureCount.toLocaleString()} elementos · formato {preview.format.toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setPreview(null); setParseErr(null); }}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Nombre */}
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1">Nombre de la capa</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Tiendas propias Región Metropolitana"
                className="h-8 text-[13px]"
              />
            </div>

            {/* Color + Icono */}
            <div className="flex gap-4 flex-wrap">
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-1.5">Color</label>
                <div className="flex gap-1.5 flex-wrap">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={[
                        "h-6 w-6 rounded-full border-2 transition-transform",
                        color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                      ].join(" ")}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-foreground mb-1">Icono</label>
                <Input
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  maxLength={2}
                  className="h-8 w-16 text-center text-[16px]"
                  title="Emoji del marcador"
                />
              </div>
            </div>

            {/* Guardar */}
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="w-full gap-2"
            >
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</>
                : <><Layers className="h-4 w-4" /> Agregar capa al mapa</>}
            </Button>
          </div>
        )}

        {/* ── Capas existentes ──────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[12px] font-semibold text-foreground uppercase tracking-wide">
              Capas guardadas
            </h3>
            {layers.length > 0 && (
              <span className="text-[11px] text-muted-foreground">{layers.length} capa{layers.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-[12px] text-muted-foreground">Cargando…</span>
            </div>
          )}

          {!loading && layers.length === 0 && (
            <p className="text-[12px] text-muted-foreground py-4 text-center">
              No hay capas personalizadas aún.
            </p>
          )}

          {!loading && layers.length > 0 && (
            <div className="space-y-1.5">
              {layers.map((l) => {
                const visible = visMap[l.id] ?? true;
                return (
                  <div
                    key={l.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-surface-2/30 px-3 py-2"
                  >
                    {/* Color dot + nombre */}
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: l.color_hex }}
                    />
                    <span className="text-[13px] flex-shrink-0 leading-none">{l.icon_emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className={["text-[13px] font-medium truncate", visible ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                        {l.name}
                      </p>
                      <p className="text-[10px] text-text-muted">
                        {l.feature_count.toLocaleString()} elementos · {new Date(l.created_at).toLocaleDateString("es-CL")}
                      </p>
                    </div>

                    {/* Toggle visibilidad */}
                    <button
                      type="button"
                      onClick={() => toggleVisibility(l.id)}
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      title={visible ? "Ocultar capa" : "Mostrar capa"}
                    >
                      {visible
                        ? <Eye className="h-4 w-4" />
                        : <EyeOff className="h-4 w-4" />}
                    </button>

                    {/* Eliminar */}
                    <button
                      type="button"
                      onClick={() => handleDelete(l.id, l.name)}
                      className="flex-shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                      title="Eliminar capa"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppDialog>
  );
};
