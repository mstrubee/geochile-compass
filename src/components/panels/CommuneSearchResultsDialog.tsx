import { useMemo, useState } from "react";
import { Download, ArrowUpDown, MapPin } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Commune, NSE_LABELS } from "@/data/communes";
import { exportCommunesSubsetToExcel } from "@/services/communeDataService";
import { fmtNum, fmtArea, fmtDensity } from "@/utils/formatters";
import {
  sortCommunesByPreset,
  sortCommunesByKey,
  type CommunePreset as Preset,
  type CommuneSortKey,
  type SortDir,
} from "@/utils/communeSorting";
import { toast } from "sonner";

type SortKey = Extract<
  CommuneSortKey,
  "name" | "pop" | "hh" | "nse" | "density" | "area" | "traffic" | "lat"
>;

interface CommuneSearchResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: Commune[];
  min: number;
  max: number | null;
  onFlyToCommune: (c: Commune) => void;
}

export const CommuneSearchResultsDialog = ({
  open,
  onOpenChange,
  results,
  min,
  max,
  onFlyToCommune,
}: CommuneSearchResultsDialogProps) => {
  const [preset, setPreset] = useState<Preset | "">("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    if (sortKey) return sortCommunesByKey(results, sortKey, sortDir);
    if (preset) return sortCommunesByPreset(results, preset);
    return results;
  }, [results, preset, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    setPreset("");
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleExport = () => {
    try {
      exportCommunesSubsetToExcel(sorted, `comunas-busqueda-${Date.now()}.xlsx`);
      toast.success(`Exportadas ${sorted.length} comunas`);
    } catch (err) {
      toast.error("Error al exportar Excel");
      console.error(err);
    }
  };

  const SortHeader = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        onClick={() => toggleSort(k)}
        className={[
          "inline-flex items-center gap-1 text-[11px] font-medium hover:text-foreground transition-colors",
          sortKey === k ? "text-foreground" : "",
        ].join(" ")}
      >
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-60" />
      </button>
    </TableHead>
  );

  const rangeLabel = max === null ? `≥ ${fmtNum(min)} hab.` : `${fmtNum(min)} – ${fmtNum(max)} hab.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Resultados — {sorted.length} comunas</DialogTitle>
          <DialogDescription>
            Rango de población: {rangeLabel}. Click en encabezados para ordenar, doble click en una fila para centrar el mapa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={preset}
            onValueChange={(v) => {
              setPreset(v as Preset);
              setSortKey(null);
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

          <div className="flex-1" />

          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar Excel
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <SortHeader k="name" label="Comuna" />
                <SortHeader k="pop" label="Población" align="right" />
                <SortHeader k="hh" label="Hogares" align="right" />
                <SortHeader k="nse" label="NSE" />
                <SortHeader k="density" label="Densidad" align="right" />
                <SortHeader k="area" label="Área" align="right" />
                <SortHeader k="traffic" label="Tráfico" align="right" />
                <SortHeader k="lat" label="Lat" align="right" />
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c) => (
                <TableRow
                  key={c.name}
                  onDoubleClick={() => {
                    onFlyToCommune(c);
                    onOpenChange(false);
                  }}
                  className="cursor-pointer"
                >
                  <TableCell className="py-1.5 font-medium text-[12px]">{c.name}</TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-[11.5px]">
                    {c.pop > 0 ? fmtNum(c.pop) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-[11.5px]">
                    {c.hh > 0 ? fmtNum(c.hh) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 text-[11.5px]">{NSE_LABELS[c.nse]}</TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-[11.5px]">
                    {c.density > 0 ? fmtDensity(c.density) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-[11.5px]">
                    {c.area > 0 ? fmtArea(c.area) : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-[11.5px]">
                    {c.traffic > 0 ? `${c.traffic}/100` : "—"}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-[11px] text-muted-foreground">
                    {c.lat.toFixed(3)}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onFlyToCommune(c);
                        onOpenChange(false);
                      }}
                      className="rounded p-1 hover:bg-accent"
                      title="Centrar en mapa"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
