import { useMemo, useState, type KeyboardEvent } from "react";
import { Search, MapPin, Filter } from "lucide-react";
import { COMMUNES, type Commune } from "@/data/communes";
import { normalizeCommuneName } from "@/services/communeDataService";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

interface CommuneSearchProps {
  onFlyToCommune: (c: Commune) => void;
  onOpenRangeResults: (results: Commune[], min: number, max: number | null) => void;
}

export const CommuneSearch = ({ onFlyToCommune, onOpenRangeResults }: CommuneSearchProps) => {
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  const suggestions = useMemo(() => {
    const q = normalizeCommuneName(text);
    if (!q) return [];
    return COMMUNES.filter((c) => normalizeCommuneName(c.name).includes(q)).slice(0, 8);
  }, [text]);

  const pickSuggestion = (c: Commune) => {
    setText("");
    setHighlight(0);
    onFlyToCommune(c);
  };

  const handleTextKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = suggestions[highlight] ?? suggestions[0];
      if (c) pickSuggestion(c);
    }
  };

  const handleRangeSearch = () => {
    const minN = min.trim() === "" ? 0 : Number(min);
    const maxN = max.trim() === "" ? null : Number(max);
    if (Number.isNaN(minN) || (maxN !== null && Number.isNaN(maxN))) {
      toast.error("Ingresa números válidos");
      return;
    }
    if (maxN !== null && maxN < minN) {
      toast.error("El máximo debe ser ≥ al mínimo");
      return;
    }
    const results = COMMUNES.filter(
      (c) => c.pop >= minN && (maxN === null || c.pop <= maxN),
    );
    if (results.length === 0) {
      toast.info("No se encontraron comunas en ese rango");
      return;
    }
    onOpenRangeResults(results, minN, maxN);
  };

  return (
    <Tabs defaultValue="text" className="w-full">
      <TabsList className="grid w-full grid-cols-2 h-8">
        <TabsTrigger value="text" className="text-[11px]">
          <Search className="mr-1 h-3 w-3" />
          Texto
        </TabsTrigger>
        <TabsTrigger value="range" className="text-[11px]">
          <Filter className="mr-1 h-3 w-3" />
          Rango pob.
        </TabsTrigger>
      </TabsList>

      <TabsContent value="text" className="mt-2">
        <div className="relative">
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={handleTextKey}
            placeholder="Buscar comuna..."
            className="h-8 text-[12px]"
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
              {suggestions.map((c, i) => (
                <button
                  key={c.name}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pickSuggestion(c)}
                  className={[
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11.5px] transition-colors",
                    i === highlight
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60",
                  ].join(" ")}
                >
                  <MapPin className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.pop > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.pop.toLocaleString("es-CL")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-1 text-[10px] text-text-muted">
          Enter centra el mapa y abre la demografía.
        </p>
      </TabsContent>

      <TabsContent value="range" className="mt-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            inputMode="numeric"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            placeholder="Mínimo"
            className="h-8 text-[12px]"
          />
          <Input
            type="number"
            inputMode="numeric"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            placeholder="Máximo (opc.)"
            className="h-8 text-[12px]"
          />
        </div>
        <button
          onClick={handleRangeSearch}
          className="w-full rounded-md bg-primary px-2.5 py-1.5 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Buscar comunas
        </button>
        <p className="text-[10px] text-text-muted">
          Filtra por población. Resultados ordenables y exportables.
        </p>
      </TabsContent>
    </Tabs>
  );
};
