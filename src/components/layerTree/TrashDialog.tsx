import { Folder, Layers, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTrash } from "@/hooks/useLayerTree";
import { TRASH_RETENTION_DAYS, type TrashItem } from "@/utils/layerTreeEdit";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Devuelve el elemento a su carpeta (o a la raíz si esa carpeta sigue en la papelera). */
  onRestore: (item: TrashItem) => Promise<void> | void;
}

const when = (d: number) => (d === 0 ? "hoy" : d === 1 ? "en 1 día" : `en ${d} días`);

/** Lo eliminado queda 30 días y después se borra solo. */
export const TrashDialog = ({ open, onClose, onRestore }: Props) => {
  const { data, isLoading, isError, refetch } = useTrash(open);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="z-[1300] max-w-md">
        <DialogHeader>
          <DialogTitle>Papelera</DialogTitle>
          <DialogDescription>
            Lo que eliminas se guarda {TRASH_RETENTION_DAYS} días y después se borra definitivamente.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto">
          {isLoading && (
            <p className="flex items-center gap-2 px-1 py-3 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
            </p>
          )}
          {isError && (
            <p className="px-1 py-3 text-[12px] text-muted-foreground">
              No se pudo leer la papelera.{" "}
              <button type="button" className="text-primary underline" onClick={() => void refetch()}>
                Reintentar
              </button>
            </p>
          )}
          {data && data.length === 0 && <p className="px-1 py-6 text-center text-[12px] text-muted-foreground">La papelera está vacía.</p>}
          <ul className="divide-y divide-border/50">
            {data?.map((item) => {
              const Icon = item.node.kind === "folder" ? Folder : Layers;
              return (
                <li key={item.node.id} className="flex items-center gap-2 py-2">
                  <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{item.node.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {item.parentName ? `De “${item.parentName}” · ` : ""}
                      {item.descendants > 0 ? `${item.descendants} ${item.descendants === 1 ? "elemento" : "elementos"} dentro · ` : ""}
                      se borra {when(item.daysLeft)}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => void onRestore(item)}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restaurar
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
};
