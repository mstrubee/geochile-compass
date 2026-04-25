import { useMemo, useState, type KeyboardEvent } from "react";
import { Search, MapPin, Filter, GitCompare, X, Plus, Trash2 } from "lucide-react";
import { COMMUNES, type Commune } from "@/data/communes";
import { normalizeCommuneName } from "@/services/communeDataService";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

interface CommuneSearchProps {
  onFlyToCommune: (c: Commune) => void;
  onOpenRangeResults: (results: Commune[], min: number, max: number | null) => void;
  /** Lista actual de comunas en el comparador (controlada desde Index). */
  compareList: Commune[];
  onCompareListChange: (list: Commune[]) => void;
  onOpenCompare: () => void;
  /** Lista acumulada de comunas buscadas por nombre (controlada desde Index). */
  searchedList: Commune[];
  onSearchedListChange: (list: Commune[]) => void;
}

export const CommuneSearch = ({
  onFlyToCommune,
  onOpenRangeResults,
  compareList,
  onCompareListChange,
  onOpenCompare,
  searchedList,
  onSearchedListChange,
}: CommuneSearchProps) => {
  const [tab, setTab] = useState<"text" | "range" | "compare">("text");
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [cmpQuery, setCmpQuery] = useState("");
  const [cmpHighlight, setCmpHighlight] = useState(0);

  const suggestions = useMemo(() => {
    const q = normalizeCommuneName(text);
    if (!q) return [];
    return COMMUNES.filter((c) => normalizeCommuneName(c.name).includes(q)).slice(0, 8);
  }, [text]);

  const cmpSuggestions = useMemo(() => {
    const q = normalizeCommuneName(cmpQuery);
    if (!q) return [];
    const taken = new Set(compareList.map((c) => c.name));
    return COMMUNES.filter(
      (c) => !taken.has(c.name) && normalizeCommuneName(c.name).includes(q),
    ).slice(0, 8);
  }, [cmpQuery, compareList]);

  const pickSuggestion = (c: Commune) => {
    setText("");
    setHighlight(0);
    onFlyToCommune(c);
    // Acumula en la lista de búsquedas si no está
    if (!searchedList.some((x) => x.name === c.name)) {
      onSearchedListChange([...searchedList, c]);
    }
  };

  const removeSearched = (name: string) => {
    onSearchedListChange(searchedList.filter((c) => c.name !== name));
  };

  const clearSearched = () => {
    onSearchedListChange([]);
  };

  const addToCompare = (c: Commune) => {
    if (compareList.some((x) => x.name === c.name)) {
      toast.info(`${c.name} ya está en el comparador`);
      return;
    }
    onCompareListChange([...compareList, c]);
    setCmpQuery("");
    setCmpHighlight(0);
  };

  const removeFromCompare = (name: string) => {
    onCompareListChange(compareList.filter((c) => c.name !== name));
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
    } else if (e.key === "Escape") {
      e.preventDefault();
      setText("");
      setHighlight(0);
      clearSearched();
    }
  };

  const handleCmpKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCmpHighlight((h) => Math.min(h + 1, cmpSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCmpHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = cmpSuggestions[cmpHighlight] ?? cmpSuggestions[0];
      if (c) addToCompare(c);
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
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="w-full">
      <TabsList className="grid w-full grid-cols-3 h-8">
        <TabsTrigger value="text" className="text-[11px]">
          <Search className="mr-1 h-3 w-3" />
          Texto
          {searchedList.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/80 px-1 text-[9px] font-mono text-primary-foreground">
              {searchedList.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="range" className="text-[11px]">
          <Filter className="mr-1 h-3 w-3" />
          Rango
        </TabsTrigger>
        <TabsTrigger value="compare" className="text-[11px]">
          <GitCompare className="mr-1 h-3 w-3" />
          Comparar
          {compareList.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/80 px-1 text-[9px] font-mono text-primary-foreground">
              {compareList.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="text" className="mt-2 space-y-2">
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

        {searchedList.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">
                Buscadas ({searchedList.length})
              </span>
              <button
                onClick={clearSearched}
                title="Borrar todas (ESC)"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-2.5 w-2.5" />
                Limpiar
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {searchedList.map((c) => (
                <span
                  key={c.name}
                  className="inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-[10.5px] text-accent-foreground"
                >
                  <button
                    onClick={() => onFlyToCommune(c)}
                    title="Centrar en mapa"
                    className="hover:underline"
                  >
                    {c.name}
                  </button>
                  <button
                    onClick={() => removeSearched(c.name)}
                    className="rounded-full hover:bg-destructive/30 hover:text-destructive"
                    title="Quitar"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-text-muted">
          Enter centra el perímetro · Click en chip para re-centrar · ESC vacía la lista.
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

      <TabsContent value="compare" className="mt-2 space-y-2">
        <div className="relative">
          <Input
            value={cmpQuery}
            onChange={(e) => {
              setCmpQuery(e.target.value);
              setCmpHighlight(0);
            }}
            onKeyDown={handleCmpKey}
            placeholder="Añadir comuna al comparador..."
            className="h-8 text-[12px]"
          />
          {cmpSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
              {cmpSuggestions.map((c, i) => (
                <button
                  key={c.name}
                  onMouseEnter={() => setCmpHighlight(i)}
                  onClick={() => addToCompare(c)}
                  className={[
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11.5px] transition-colors",
                    i === cmpHighlight
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60",
                  ].join(" ")}
                >
                  <Plus className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
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

        {compareList.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {compareList.map((c) => (
              <span
                key={c.name}
                className="inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-[10.5px] text-accent-foreground"
              >
                {c.name}
                <button
                  onClick={() => removeFromCompare(c.name)}
                  className="rounded-full hover:bg-destructive/30 hover:text-destructive"
                  title="Quitar"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onOpenCompare}
            disabled={compareList.length < 2}
            className="flex-1 rounded-md bg-primary px-2.5 py-1.5 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Comparar ({compareList.length})
          </button>
          {compareList.length > 0 && (
            <button
              onClick={() => onCompareListChange([])}
              className="rounded-md border border-border px-2.5 py-1.5 text-[11.5px] text-muted-foreground hover:bg-accent/40"
            >
              Limpiar
            </button>
          )}
        </div>
        <p className="text-[10px] text-text-muted">
          Mínimo 2 comunas. Click derecho en un globo del mapa para añadirla.
        </p>
      </TabsContent>
    </Tabs>
  );
};
