import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, Layers, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { filterDestinations, type DestinationOption } from "@/utils/importWizard";

interface Props {
  options: readonly DestinationOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Ofrece "en la raíz" (se crea una carpeta nueva con el nombre del archivo). */
  rootLabel?: string;
  placeholder?: string;
}

/** Lista con buscador para elegir una carpeta (importación nueva) o una capa (reemplazar/agregar). */
export const DestinationPicker = ({ options, value, onChange, rootLabel, placeholder = "Buscar…" }: Props) => {
  const [term, setTerm] = useState("");
  const shown = useMemo(() => filterDestinations(options, term), [options, term]);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Con una lista larga, la capa o carpeta elegida (p. ej. la sobre la que se soltó el archivo) debe verse.
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [value]);

  return (
    <div className="rounded-lg border border-border/60">
      <div className="relative border-b border-border/60">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={placeholder}
          aria-label="Buscar destino"
          className="h-8 rounded-b-none border-0 pl-7 text-[12px] focus-visible:ring-0"
        />
      </div>
      <ul className="max-h-40 overflow-y-auto py-1" role="listbox" aria-label="Destino">
        {rootLabel && !term && (
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onClick={() => onChange(null)}
              className={cn("flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] hover:bg-surface-2/60", value === null && "bg-primary/15 text-foreground")}
            >
              <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{rootLabel}</span>
            </button>
          </li>
        )}
        {shown.map((o) => {
          const Icon = o.kind === "folder" ? Folder : Layers;
          const selected = o.id === value;
          return (
            <li key={o.id}>
              <button
                ref={selected ? selectedRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(o.id)}
                style={{ paddingLeft: 8 + (term ? 0 : o.depth * 12) }}
                className={cn("flex w-full items-center gap-2 py-1 pr-2 text-left text-[12px] hover:bg-surface-2/60", selected && "bg-primary/15 text-foreground")}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="truncate">{o.name}</span>
                {term && o.path && <span className="truncate text-[10px] text-text-muted">{o.path}</span>}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="px-2 py-2 text-[11px] text-text-muted">Sin resultados.</li>}
      </ul>
    </div>
  );
};
