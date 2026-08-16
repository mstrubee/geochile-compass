import { useCallback, useEffect, useState } from "react";
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

interface Props {
  open: boolean;
  onClose: () => void;
  /** Toma las 4 fotos con el desplazamiento de zoom indicado. */
  onCapture: (zoomOffset: number) => Promise<MapCaptureImages | null>;
  /** Confirma y genera el informe con las fotos revisadas. */
  onConfirm: (images: MapCaptureImages | null) => Promise<void> | void;
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
export const MapCapturePreviewDialog = ({ open, onClose, onCapture, onConfirm }: Props) => {
  const [zoom, setZoom] = useState(0);
  const [images, setImages] = useState<MapCaptureImages | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const capture = useCallback(
    async (z: number) => {
      setCapturing(true);
      try {
        setImages(await onCapture(z));
      } finally {
        setCapturing(false);
      }
    },
    [onCapture],
  );

  // Primera captura al abrir; el zoom vuelve a 0 en cada apertura.
  useEffect(() => {
    if (!open) return;
    setZoom(0);
    void capture(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const busy = capturing || generating;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/40 px-5 pb-3 pt-4">
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            Vista previa de los mapas
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Revisa el encuadre antes de generar el informe. El zoom se aplica a
            las cuatro por igual, para que muestren la misma superficie.
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
                    {capturing ? (
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
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Zoom</span>
            <input
              type="range"
              min={-3}
              max={3}
              step={1}
              value={zoom}
              disabled={busy}
              onChange={(e) => setZoom(parseInt(e.target.value, 10))}
              // Solo al soltar: cada captura mueve el mapa real y toma 4 fotos.
              onMouseUp={() => void capture(zoom)}
              onTouchEnd={() => void capture(zoom)}
              className="w-40 accent-brand-red"
            />
            <span className="w-10 text-[11px] font-mono text-foreground">
              {zoom > 0 ? `+${zoom}` : zoom}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={busy}
              onClick={() => void capture(zoom)}
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
                  await onConfirm(images);
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
