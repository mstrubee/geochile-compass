import { useMemo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { PoiOperationalStatus, PoiUpdate, SavedPoi } from "@/types/pois";
import { POI_STATUS_LABEL } from "@/types/pois";
import { usePoiClosureStats } from "@/hooks/usePoiClosureStats";
import { CLOSURE_REVIEW_MIN_MONTHS } from "@/services/poiClosureService";

interface Props {
  pois: SavedPoi[];
  onUpdatePoi: (id: string, patch: PoiUpdate) => Promise<void>;
}

/**
 * Locales con meses sin ventas tras su apertura, para revisar y marcar.
 *
 * No marca nada por su cuenta: en la serie, un cierre real y un vacío de carga
 * de datos son indistinguibles, así que la decisión queda en el usuario. Los
 * meses previos a la primera venta no se cuentan —son meses en que el local
 * todavía no existía, no un cierre—.
 */
export const ClosureReviewSection = ({ pois, onUpdatePoi }: Props) => {
  const ids = useMemo(() => pois.map((p) => p.id), [pois]);
  const { stats, loading } = usePoiClosureStats(ids);

  const candidates = useMemo(() => {
    const rows = pois
      .map((p) => ({ poi: p, s: stats.get(p.id) }))
      .filter(
        (r) => r.s != null && r.s.closedMonths >= CLOSURE_REVIEW_MIN_MONTHS,
      ) as Array<{ poi: SavedPoi; s: NonNullable<ReturnType<typeof stats.get>> }>;
    return rows.sort((a, b) => b.s.closedMonths - a.s.closedMonths);
  }, [pois, stats]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Revisando meses sin ventas…
      </div>
    );
  }
  if (candidates.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/40 bg-surface-2/30 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-medium">
        <AlertTriangle className="h-3.5 w-3.5 text-brand-orange" />
        Locales con meses sin ventas ({candidates.length})
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Meses en cero posteriores a la apertura. Puede ser un cierre o un vacío
        de datos — revisa y marca. Solo los cerrados definitivamente quedan
        fuera de las proyecciones.
      </p>

      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {candidates.map(({ poi, s }) => (
          <div
            key={poi.id}
            className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md bg-surface-2/50 px-2 py-1.5"
          >
            <div className="min-w-0">
              <div className="truncate text-[11px]">{poi.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {s.closedMonths} mes{s.closedMonths === 1 ? "" : "es"} en cero
                {s.longestClosedRun > 1 ? ` · racha ${s.longestClosedRun}` : ""}
                {s.preOpeningMonths > 0
                  ? ` · abrió ${(s.firstSale ?? "").slice(0, 7)}`
                  : ""}
              </div>
            </div>
            <select
              value={poi.operational_status ?? "operativo"}
              onChange={(e) =>
                void onUpdatePoi(poi.id, {
                  operational_status: e.target.value as PoiOperationalStatus,
                })
              }
              className="h-7 rounded-md border border-border/50 bg-surface-3 px-1.5 text-[10px]"
            >
              {(Object.keys(POI_STATUS_LABEL) as PoiOperationalStatus[]).map((st) => (
                <option key={st} value={st}>{POI_STATUS_LABEL[st]}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
};
