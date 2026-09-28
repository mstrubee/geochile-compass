import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { POI_STATUS_LABEL, type PoiOperationalStatus } from "@/types/pois";
import { RADIO_ALEDANA_KM, type NearbyStore } from "@/services/nearbyStoresService";

interface Props {
  open: boolean;
  onClose: () => void;
  stores: NearbyStore[];
  onChange: (stores: NearbyStore[]) => void;
}

const clave = (s: NearbyStore) => `${s.from}:${s.fromName ?? ""}:${s.id}`;

/**
 * Elige qué locales entran en el informe.
 *
 * Los medidos desde una zona aledaña necesitan criterio humano: estar a menos
 * de {@link RADIO_ALEDANA_KM} km de una zona sumada no los hace relevantes
 * para la decisión, y quién conoce la red sabe cuáles sí lo son.
 */
export const NearbyStoresDialog = ({ open, onClose, stores, onChange }: Props) => {
  const grupos = new Map<string, NearbyStore[]>();
  for (const s of stores) {
    const g = s.from === "iso" ? "Desde la isócrona" : `Desde ${s.fromName ?? "zona aledaña"}`;
    grupos.set(g, [...(grupos.get(g) ?? []), s]);
  }

  const toggle = (s: NearbyStore, valor: boolean) =>
    onChange(stores.map((x) => (clave(x) === clave(s) ? { ...x, selected: valor } : x)));

  const todos = (valor: boolean) =>
    onChange(stores.map((x) => ({ ...x, selected: valor })));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
        <DialogHeader className="border-b border-border/40 px-5 pb-3 pt-4">
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            Locales de la red en el informe
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Los que estén marcados aparecen en la lámina. Desde cada zona
            aledaña se buscan los locales en {RADIO_ALEDANA_KM} km a la redonda.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-3">
          {stores.length === 0 && (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              No se encontraron locales cercanos.
            </p>
          )}
          {[...grupos.entries()].map(([titulo, lista]) => (
            <div key={titulo}>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-brand-red">
                {titulo}
              </div>
              <div className="overflow-hidden rounded-lg bg-surface-2/60">
                {lista.map((s) => (
                  <label
                    key={clave(s)}
                    className="flex cursor-pointer items-center gap-2 border-b border-border/30 px-2 py-1.5 text-[11px] last:border-b-0 hover:bg-surface-3/40"
                  >
                    <Checkbox
                      checked={s.selected}
                      onCheckedChange={(v) => toggle(s, v === true)}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {s.name}
                      {s.status && s.status !== "operativo" && (
                        <span className="ml-1 text-[10px] text-brand-orange">
                          · {POI_STATUS_LABEL[s.status as PoiOperationalStatus] ?? s.status}
                        </span>
                      )}
                    </span>
                    <span className="w-16 text-right font-mono text-muted-foreground">
                      {s.km.toFixed(1)} km
                    </span>
                    <span className="w-14 text-right font-mono text-foreground">
                      {s.minutes} min
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/40 px-5 py-3">
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => todos(true)}>
              Marcar todos
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => todos(false)}>
              Desmarcar
            </Button>
          </div>
          <Button size="sm" onClick={onClose}>Listo</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
