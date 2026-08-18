import { useState } from "react";
import { X, Trash2, Loader2, ImageOff } from "lucide-react";
import type { StoredReportSlides } from "@/services/isochroneReportSlidesService";

/**
 * Visor de las láminas guardadas para leaseflow.
 *
 * Existe porque las láminas viven en la base y no en el disco del analista: si
 * no se pueden mirar, no hay forma de saber qué se le está entregando a
 * leaseflow ni de detectar que quedaron viejas.
 */
export const ReportSlidesViewer = ({
  slides,
  onClose,
  onDelete,
  deleting,
}: {
  slides: StoredReportSlides;
  onClose: () => void;
  onDelete: () => void;
  deleting: boolean;
}) => {
  const laminas = [
    { n: 1, title: "Análisis territorial", src: slides.slide1 },
    { n: 2, title: "Potencial económico y proyección", src: slides.slide2 },
  ].filter((l) => !!l.src) as Array<{ n: number; title: string; src: string }>;

  const [zoom, setZoom] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border/40 bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border/40 bg-surface-1/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">
              Láminas guardadas para leaseflow
            </div>
            <div className="text-[10px] text-muted-foreground">
              Generadas el {new Date(slides.generatedAt).toLocaleString("es-CL")}
            </div>
          </div>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40"
          >
            {deleting
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Trash2 className="h-3 w-3" />}
            Eliminar
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin">
          {laminas.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <ImageOff className="h-6 w-6" />
              <span className="text-[12px]">No hay láminas guardadas.</span>
            </div>
          )}
          {laminas.map((l) => (
            <div key={l.n}>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Lámina {l.n} · {l.title}
              </div>
              <button onClick={() => setZoom(l.src)} className="block w-full" title="Ver en tamaño completo">
                <img
                  src={l.src}
                  alt={`Lámina ${l.n}`}
                  className="w-full rounded-lg border border-border/40"
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoom(null)}
        >
          <img src={zoom} alt="Lámina" className="max-h-full max-w-full" />
        </div>
      )}
    </div>
  );
};
