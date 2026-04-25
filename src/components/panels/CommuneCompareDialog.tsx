import { useMemo, useState } from "react";
import { Download, X, MapPin, ArrowUpDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Commune, NSE_LABELS } from "@/data/communes";
import { exportCommunesSubsetToExcel } from "@/services/communeDataService";
import { fmtNum, fmtArea, fmtDensity } from "@/utils/formatters";
import {
  sortCommunesByPreset,
  sortCommunesByKey,
  type CommunePreset,
  type CommuneSortKey,
  type SortDir,
} from "@/utils/communeSorting";
import { toast } from "sonner";

interface CommuneCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communes: Commune[];
  onRemove: (name: string) => void;
  onFlyToCommune: (c: Commune) => void;
}

type MetricRow = {
  key: CommuneSortKey;
  label: string;
  format: (c: Commune) => string;
  numeric: (c: Commune) => number | null;
  /** higher value = "better" for highlight (true) / lower = better (false) / no highlight (null) */
  higherIsBetter: boolean | null;
};

const METRICS: MetricRow[] = [
  {
    key: "pop",
    label: "Población",
    format: (c) => (c.pop > 0 ? fmtNum(c.pop) : "—"),
    numeric: (c) => (c.pop > 0 ? c.pop : null),
    higherIsBetter: true,
  },
  {
    key: "hh",
    label: "Hogares",
    format: (c) => (c.hh > 0 ? fmtNum(c.hh) : "—"),
    numeric: (c) => (c.hh > 0 ? c.hh : null),
    higherIsBetter: true,
  },
  {
    key: "nse",
    label: "NSE",
    format: (c) => NSE_LABELS[c.nse],
    numeric: (c) => c.nse,
    higherIsBetter: true,
  },
  {
    key: "density",
    label: "Densidad",
    format: (c) => (c.density > 0 ? fmtDensity(c.density) : "—"),
    numeric: (c) => (c.density > 0 ? c.density : null),
    higherIsBetter: null,
  },
  {
    key: "area",
    label: "Área",
    format: (c) => (c.area > 0 ? fmtArea(c.area) : "—"),
    numeric: (c) => (c.area > 0 ? c.area : null),
    higherIsBetter: null,
  },
  {
    key: "traffic",
    label: "Tráfico",
    format: (c) => (c.traffic > 0 ? `${c.traffic}/100` : "—"),
    numeric: (c) => (c.traffic > 0 ? c.traffic : null),
    higherIsBetter: false,
  },
  {
    key: "lat",
    label: "Latitud",
    format: (c) => c.lat.toFixed(4),
    numeric: (c) => c.lat,
    higherIsBetter: null,
  },
  {
    key: "lng",
    label: "Longitud",
    format: (c) => c.lng.toFixed(4),
    numeric: (c) => c.lng,
    higherIsBetter: null,
  },
];

export const CommuneCompareDialog = ({
  open,
  onOpenChange,
  communes,
  onRemove,
  onFlyToCommune,
}: CommuneCompareDialogProps) => {
  const [preset, setPreset] = useState<CommunePreset | "">("");
  const [metricSort, setMetricSort] = useState<{
    key: CommuneSortKey;
    dir: SortDir;
  } | null>(null);

  const orderedCommunes = useMemo(() => {
    if (metricSort) return sortCommunesByKey(communes, metricSort.key, metricSort.dir);
    if (preset) return sortCommunesByPreset(communes, preset);
    return communes;
  }, [communes, preset, metricSort]);

  const toggleMetricSort = (key: CommuneSortKey) => {
    setPreset("");
    setMetricSort((prev) => {
      if (prev && prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "desc" };
    });
  };

  const handleExport = () => {
    try {
      exportCommunesSubsetToExcel(
        orderedCommunes,
        `comparacion-comunas-${Date.now()}.xlsx`,
      );
      toast.success(`Exportadas ${orderedCommunes.length} comunas`);
    } catch (err) {
      toast.error("Error al exportar Excel");
      console.error(err);
    }
  };

  // pre-compute min/max per metric for highlighting
  const extremes = useMemo(() => {
    const map = new Map<CommuneSortKey, { min: number; max: number }>();
    for (const m of METRICS) {
      const vals = orderedCommunes
        .map((c) => m.numeric(c))
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (vals.length >= 2) {
        map.set(m.key, { min: Math.min(...vals), max: Math.max(...vals) });
      }
    }
    return map;
  }, [orderedCommunes]);

  const cellHighlight = (m: MetricRow, c: Commune): string => {
    if (m.higherIsBetter === null) return "";
    const v = m.numeric(c);
    if (v === null) return "";
    const ex = extremes.get(m.key);
    if (!ex || ex.min === ex.max) return "";
    const isMax = v === ex.max;
    const isMin = v === ex.min;
    if (!isMax && !isMin) return "";
    const best = m.higherIsBetter ? isMax : isMin;
    return best
      ? "bg-emerald-500/15 text-emerald-300"
      : "bg-rose-500/15 text-rose-300";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(95vw,1100px)]">
        <DialogHeader>
          <DialogTitle>Comparar comunas — {orderedCommunes.length}</DialogTitle>
          <DialogDescription>
            Verde = mejor valor por métrica · Rojo = peor. Click en una métrica para ordenar columnas. Doble click en el encabezado para centrar el mapa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={preset}
            onValueChange={(v) => {
              setPreset(v as CommunePreset);
              setMetricSort(null);
            }}
          >
            <SelectTrigger className="h-8 w-[200px] text-[12px]">
              <SelectValue placeholder="Orden predefinido" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="north-south">Norte → Sur</SelectItem>
              <SelectItem value="south-north">Sur → Norte</SelectItem>
              <SelectItem value="alpha-asc">Alfabético A–Z</SelectItem>
              <SelectItem value="alpha-desc">Alfabético Z–A</SelectItem>
              <SelectItem value="gse-high">GSE: ABC1 → E</SelectItem>
              <SelectItem value="gse-low">GSE: E → ABC1</SelectItem>
            </SelectContent>
          </Select>

          {metricSort && (
            <span className="rounded-md bg-accent/40 px-2 py-1 text-[10.5px] text-muted-foreground">
              Orden por {METRICS.find((m) => m.key === metricSort.key)?.label} (
              {metricSort.dir === "asc" ? "asc" : "desc"})
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={handleExport}
            disabled={orderedCommunes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar Excel
          </button>
        </div>

        {orderedCommunes.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-2/30 p-6 text-center text-[12px] text-muted-foreground">
            No hay comunas en el comparador. Añade desde el sidebar o con click derecho en un globo comunal del mapa.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  <th className="sticky left-0 z-20 min-w-[120px] border-b border-border bg-background px-3 py-2 text-left font-medium text-muted-foreground">
                    Métrica
                  </th>
                  {orderedCommunes.map((c) => (
                    <th
                      key={c.name}
                      onDoubleClick={() => {
                        onFlyToCommune(c);
                        onOpenChange(false);
                      }}
                      className="min-w-[110px] border-b border-l border-border bg-background px-2 py-2 text-center font-medium text-foreground"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <button
                          onClick={() => {
                            onFlyToCommune(c);
                            onOpenChange(false);
                          }}
                          title="Centrar mapa"
                          className="rounded p-0.5 hover:bg-accent"
                        >
                          <MapPin className="h-3 w-3 opacity-70" />
                        </button>
                        <span className="flex-1 truncate text-[11.5px]" title={c.name}>
                          {c.name}
                        </span>
                        <button
                          onClick={() => onRemove(c.name)}
                          title="Quitar del comparador"
                          className="rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => (
                  <tr key={m.key} className="hover:bg-accent/20">
                    <th
                      onClick={() => toggleMetricSort(m.key)}
                      className="sticky left-0 z-10 cursor-pointer border-b border-border bg-background px-3 py-1.5 text-left font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span className="inline-flex items-center gap-1">
                        {m.label}
                        <ArrowUpDown
                          className={[
                            "h-3 w-3",
                            metricSort?.key === m.key
                              ? "text-foreground opacity-100"
                              : "opacity-40",
                          ].join(" ")}
                        />
                      </span>
                    </th>
                    {orderedCommunes.map((c) => (
                      <td
                        key={c.name}
                        className={[
                          "border-b border-l border-border px-2 py-1.5 text-center font-mono",
                          cellHighlight(m, c),
                        ].join(" ")}
                      >
                        {m.format(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
