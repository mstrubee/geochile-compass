import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, FileText } from "lucide-react";
import type { MapCaptureImages } from "@/utils/mapCapture";
import { DEFAULT_SETTINGS, type HeatmapSettings } from "@/hooks/useHeatmapSettings";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Toma las 4 fotos aplicando estos ajustes al heatmap de atractores. */
  onCapture: (heat: Partial<HeatmapSettings>) => Promise<MapCaptureImages | null>;
  /** Recaptura solo atractores: las otras tres no cambian al afinar el heatmap. */
  onCaptureAtractores?: (heat: Partial<HeatmapSettings>) => Promise<string | null>;
  /** Ajustes usados la última vez para esta isócrona. */
  initialHeat?: Partial<HeatmapSettings> | null;
  /** Confirma y genera el informe con las fotos y los ajustes revisados. */
  onConfirm: (
    images: MapCaptureImages | null,
    heat: HeatmapSettings,
  ) => Promise<void> | void;
}

const TITULOS: Array<[keyof MapCaptureImages, string]> = [
  ["isoOnly", "Isócrona"],
  ["gse", "GSE por manzana"],
  ["gasto", "Gasto endógeno"],
  ["atractores", "Atractores comerciales"],
];

/**
 * Vista previa de las fotos antes de generar el informe.
 *
 * El encuadre depende del tamaño del contenedor del mapa y del alcance de cada
 * capa, así que conviene revisarlo antes de que quede impreso en una lámina de
 * directorio en vez de descubrirlo después.
 */
export const MapCapturePreviewDialog = ({
  open, onClose, onCapture, onCaptureAtractores, initialHeat, onConfirm,
}: Props) => {
  // El radio del heatmap está en píxeles: lo que se ve bien en pantalla puede
  // convertirse en una mancha que tapa la isócrona a la escala de la foto.
  const [heat, setHeat] = useState<HeatmapSettings>(DEFAULT_SETTINGS.commercial);
  // El handler de soltar el slider leería el valor del render anterior, o sea
  // capturaría con un paso de atraso. La referencia siempre tiene el último.
  const heatRef = useRef(heat);
  heatRef.current = heat;
  const [images, setImages] = useState<MapCaptureImages | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [heatBusy, setHeatBusy] = useState(false);
  const [generating, setGenerating] = useState(false);

  const capture = useCallback(
    async (h: HeatmapSettings) => {
      setCapturing(true);
      try {
        setImages(await onCapture(h));
      } finally {
        setCapturing(false);
      }
    },
    [onCapture],
  );

  /** Al mover un control solo cambia atractores: rehacer las cuatro es lento. */
  const recaptureHeat = useCallback(
    async (h: HeatmapSettings) => {
      if (!onCaptureAtractores) return capture(h);
      setHeatBusy(true);
      try {
        const img = await onCaptureAtractores(h);
        setImages((prev) => (prev ? { ...prev, atractores: img } : prev));
      } finally {
        setHeatBusy(false);
      }
    },
    [onCaptureAtractores, capture],
  );

  // Primera captura al abrir, retomando los ajustes de la última exportación.
  useEffect(() => {
    if (!open) return;
    const inicial = { ...DEFAULT_SETTINGS.commercial, ...(initialHeat ?? {}) };
    setHeat(inicial);
    void capture(inicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const busy = capturing || heatBusy || generating;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/40 px-5 pb-3 pt-4">
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            Vista previa de los mapas
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Ajusta el heatmap de atractores comerciales hasta que se lea bien
            sobre la isócrona, y recién ahí genera el informe.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(92vh-190px)] overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            {TITULOS.map(([key, titulo]) => {
              const src = images?.[key] ?? null;
              return (
                <div key={key}>
                  <div className="mb-1 text-[11px] font-medium text-brand-red">{titulo}</div>
                  <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-border/40 bg-surface-2/50">
                    {capturing || (heatBusy && key === "atractores") ? (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : src ? (
                      <img src={src} alt={titulo} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                        Sin captura
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {([
              ["radius", "Radio", 5, 60, 1],
              ["blur", "Difuminado", 1, 50, 1],
              ["opacity", "Opacidad", 0.1, 1, 0.05],
            ] as Array<[keyof HeatmapSettings, string, number, number, number]>).map(
              ([key, label, min, max, step]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={heat[key]}
                    disabled={busy}
                    onChange={(e) =>
                      setHeat((h) => ({ ...h, [key]: parseFloat(e.target.value) }))
                    }
                    // Solo al soltar: cada captura mueve el mapa y toma 4 fotos.
                    onMouseUp={() => void recaptureHeat(heatRef.current)}
                    onTouchEnd={() => void recaptureHeat(heatRef.current)}
                    className="w-24 accent-brand-red"
                  />
                  <span className="w-8 text-[11px] font-mono text-foreground">
                    {key === "opacity" ? heat[key].toFixed(2) : heat[key]}
                  </span>
                </div>
              ),
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={busy}
              onClick={() => void recaptureHeat(heatRef.current)}
            >
              <RefreshCw className="mr-1.5 h-3 w-3" /> Recapturar
            </Button>
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setGenerating(true);
                try {
                  await onConfirm(images, heatRef.current);
                  onClose();
                } finally {
                  setGenerating(false);
                }
              }}
            >
              {generating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="mr-1.5 h-3.5 w-3.5" />
              )}
              Generar informe
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
