import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, FileText, ZoomIn, Move } from "lucide-react";
import type { MapCaptureImages } from "@/utils/mapCapture";
import { DEFAULT_SETTINGS, type HeatmapSettings } from "@/hooks/useHeatmapSettings";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Toma las 4 fotos aplicando estos ajustes al heatmap y al encuadre. */
  onCapture: (
    heat: Partial<HeatmapSettings>,
    zoomOffset: number,
    panOffset: { x: number; y: number },
  ) => Promise<MapCaptureImages | null>;
  /** Recaptura solo atractores: las otras tres no cambian al afinar el heatmap. */
  onCaptureAtractores?: (
    heat: Partial<HeatmapSettings>,
    zoomOffset: number,
    panOffset: { x: number; y: number },
  ) => Promise<string | null>;
  /** Ajustes usados la última vez para esta isócrona. */
  initialHeat?: Partial<HeatmapSettings> | null;
  /** Zoom usado la última vez para esta isócrona. */
  initialZoomOffset?: number | null;
  /** Corrimiento manual del centro usado la última vez. */
  initialPanOffset?: { x: number; y: number } | null;
  /** Confirma y genera el informe con las fotos y los ajustes revisados. */
  onConfirm: (
    images: MapCaptureImages | null,
    heat: HeatmapSettings,
    zoomOffset: number,
    panOffset: { x: number; y: number },
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
/**
 * Rango del zoom relativo al encuadre automático.
 *
 * El encuadre por defecto mete la isócrona completa, así que en una isócrona
 * grande —30 minutos en una comuna chica— las manzanas quedan del tamaño de un
 * píxel y las capas dejan de leerse. Acercar sacrifica parte del polígono a
 * cambio de que se vea el detalle, que es la decisión que el analista debe poder
 * tomar. Alejar sirve para dar contexto alrededor.
 */
const ZOOM_MIN = -2;
const ZOOM_MAX = 4;

export const MapCapturePreviewDialog = ({
  open, onClose, onCapture, onCaptureAtractores, initialHeat, initialZoomOffset, initialPanOffset, onConfirm,
}: Props) => {
  // El radio del heatmap está en píxeles: lo que se ve bien en pantalla puede
  // convertirse en una mancha que tapa la isócrona a la escala de la foto.
  const [heat, setHeat] = useState<HeatmapSettings>(DEFAULT_SETTINGS.commercial);
  // El handler de soltar el slider leería el valor del render anterior, o sea
  // capturaría con un paso de atraso. La referencia siempre tiene el último.
  const heatRef = useRef(heat);
  heatRef.current = heat;
  // Zoom relativo al encuadre automático. Un solo valor para las 4 vistas: el
  // informe las compara entre sí, y a escalas distintas esa comparación engaña.
  const [zoomOffset, setZoomOffset] = useState(0);
  const zoomRef = useRef(zoomOffset);
  zoomRef.current = zoomOffset;
  /**
   * Corrimiento manual del centro, en píxeles. Se arrastra sobre cualquiera de
   * las cuatro vistas y afecta a las cuatro: el informe las compara entre sí, y
   * centradas distinto esa comparación deja de servir.
   */
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  /** Arrastre en curso: se muestra con un transform CSS para dar respuesta
   *  inmediata, y solo al soltar se rehacen las fotos. */
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [images, setImages] = useState<MapCaptureImages | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [heatBusy, setHeatBusy] = useState(false);
  const [generating, setGenerating] = useState(false);

  const capture = useCallback(
    async (h: HeatmapSettings, z: number, pOff: { x: number; y: number }) => {
      setCapturing(true);
      try {
        setImages(await onCapture(h, z, pOff));
      } finally {
        setCapturing(false);
      }
    },
    [onCapture],
  );

  /** Al mover un control solo cambia atractores: rehacer las cuatro es lento. */
  const recaptureHeat = useCallback(
    async (h: HeatmapSettings) => {
      if (!onCaptureAtractores) return capture(h, zoomRef.current, panRef.current);
      setHeatBusy(true);
      try {
        const img = await onCaptureAtractores(h, zoomRef.current, panRef.current);
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
    const z = initialZoomOffset ?? 0;
    const pOff = initialPanOffset ?? { x: 0, y: 0 };
    setHeat(inicial);
    setZoomOffset(z);
    zoomRef.current = z;
    setPan(pOff);
    panRef.current = pOff;
    void capture(inicial, z, pOff);
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
            Ajusta el heatmap y el zoom hasta que las capas se lean bien, y recién
            ahí genera el informe. Arrastra cualquier vista para centrar las
            cuatro. Acercar recorta parte de la isócrona a cambio de ver el
            detalle: en isócronas grandes suele convenir.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(92vh-190px)] overflow-y-auto px-5 py-4">
          {(pan.x !== 0 || pan.y !== 0) && (
            <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              <Move className="h-3 w-3" />
              Centro corrido {pan.x > 0 ? `${pan.x}px →` : `${-pan.x}px ←`} ·{" "}
              {pan.y > 0 ? `${pan.y}px ↓` : `${-pan.y}px ↑`}
              <button
                onClick={() => {
                  const z = { x: 0, y: 0 };
                  setPan(z); panRef.current = z;
                  void capture(heatRef.current, zoomRef.current, z);
                }}
                disabled={busy}
                className="underline hover:text-foreground disabled:opacity-40"
              >
                centrar
              </button>
            </div>
          )}

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
                      <img
                        src={src}
                        alt={titulo}
                        draggable={false}
                        onPointerDown={(e) => {
                          if (busy) return;
                          // `setPointerCapture` mantiene los eventos aunque el
                          // puntero salga de la imagen: sin eso, arrastrar hacia
                          // afuera dejaba el gesto colgado a medio camino.
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                          dragStart.current = { x: e.clientX, y: e.clientY };
                          setDrag({ x: 0, y: 0 });
                        }}
                        onPointerMove={(e) => {
                          if (!dragStart.current) return;
                          setDrag({
                            x: e.clientX - dragStart.current.x,
                            y: e.clientY - dragStart.current.y,
                          });
                        }}
                        onPointerUp={(e) => {
                          const st = dragStart.current;
                          dragStart.current = null;
                          const d = { x: e.clientX - (st?.x ?? e.clientX), y: e.clientY - (st?.y ?? e.clientY) };
                          setDrag(null);
                          // Un click sin desplazamiento real no debe gastar una
                          // recaptura de cuatro fotos.
                          if (!st || (Math.abs(d.x) < 3 && Math.abs(d.y) < 3)) return;
                          // La vista previa se muestra a ~1/3 del ancho real del
                          // mapa, así que el arrastre se escala: mover 10 px acá
                          // son ~30 px de mapa. Sin el factor el paneo se sentiría
                          // mucho más lento de lo que el usuario arrastra.
                          const scale =
                            (e.currentTarget as HTMLImageElement).naturalWidth /
                            Math.max(1, (e.currentTarget as HTMLImageElement).clientWidth);
                          // Se ARRASTRA la imagen, así que el mapa va al revés:
                          // llevar la foto a la derecha significa mirar más a la
                          // izquierda.
                          const next = {
                            x: Math.round(panRef.current.x - d.x * scale),
                            y: Math.round(panRef.current.y - d.y * scale),
                          };
                          setPan(next);
                          panRef.current = next;
                          void capture(heatRef.current, zoomRef.current, next);
                        }}
                        className="h-full w-full cursor-grab object-cover active:cursor-grabbing"
                        style={
                          drag
                            ? { transform: `translate(${drag.x}px, ${drag.y}px)`, transition: "none" }
                            : undefined
                        }
                      />
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
                  {/* Input numérico y no un span: las flechas ↑↓ del teclado
                      ajustan el valor de a un paso sin tener que apuntar el
                      slider con el mouse, que es lo que pidió Matias. */}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={key === "opacity" ? heat[key].toFixed(2) : heat[key]}
                    disabled={busy}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setHeat((h) => ({ ...h, [key]: Math.min(max, Math.max(min, v)) }));
                    }}
                    // Se recaptura al soltar la flecha o al salir del campo, no en
                    // cada pulsación: mantener ↑ apretada dispararía una captura
                    // por repetición del teclado.
                    onKeyUp={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        void recaptureHeat(heatRef.current);
                      }
                    }}
                    onBlur={() => void recaptureHeat(heatRef.current)}
                    className="w-14 rounded border border-border/40 bg-surface-2/60 px-1 py-0.5 text-[11px] font-mono text-foreground"
                  />
                </div>
              ),
            )}
            {/* Zoom: uno solo para las 4 vistas. Cambiarlo obliga a rehacer las
                cuatro fotos, no solo atractores, porque el encuadre es común. */}
            <div className="flex items-center gap-1.5 border-l border-border/40 pl-3">
              <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Zoom</span>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={1}
                value={zoomOffset}
                disabled={busy}
                onChange={(e) => setZoomOffset(parseInt(e.target.value, 10))}
                onMouseUp={() => void capture(heatRef.current, zoomRef.current, panRef.current)}
                onTouchEnd={() => void capture(heatRef.current, zoomRef.current, panRef.current)}
                className="w-24 accent-brand-red"
              />
              <input
                type="number"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={1}
                value={zoomOffset}
                disabled={busy}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isFinite(v)) return;
                  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
                  setZoomOffset(clamped);
                  zoomRef.current = clamped;
                }}
                onKeyUp={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    void capture(heatRef.current, zoomRef.current, panRef.current);
                  }
                }}
                onBlur={() => void capture(heatRef.current, zoomRef.current, panRef.current)}
                className="w-14 rounded border border-border/40 bg-surface-2/60 px-1 py-0.5 text-[11px] font-mono text-foreground"
              />
              {zoomOffset !== 0 && (
                <button
                  onClick={() => { setZoomOffset(0); zoomRef.current = 0; void capture(heatRef.current, 0, panRef.current); }}
                  disabled={busy}
                  className="text-[10px] text-muted-foreground underline hover:text-foreground disabled:opacity-40"
                  title="Volver al encuadre que mete la isócrona completa"
                >
                  auto
                </button>
              )}
            </div>

            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={busy}
              onClick={() => void capture(heatRef.current, zoomRef.current, panRef.current)}
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
                  await onConfirm(images, heatRef.current, zoomRef.current, panRef.current);
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
