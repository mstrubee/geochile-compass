import { Search, Loader2, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface SearchResult {
  id: string;
  label: string;
  lat: number;
  lng: number;
  bbox: [number, number, number, number] | null; // [south, north, west, east]
  type: string;
}

interface Props {
  onSelect: (result: SearchResult) => void;
}

const VIEWBOX = "-71.7,-33.0,-70.0,-34.2"; // Región Metropolitana aprox. (lon_min,lat_max,lon_max,lat_min)

export const SearchBar = ({ onSelect }: Props) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cierre al hacer click fuera
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  // Búsqueda con debounce
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const url =
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8` +
          `&countrycodes=cl&viewbox=${VIEWBOX}&bounded=0` +
          `&q=${encodeURIComponent(term)}`;
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { "Accept-Language": "es" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Array<{
          place_id: number;
          display_name: string;
          lat: string;
          lon: string;
          boundingbox?: [string, string, string, string];
          type: string;
          class: string;
        }> = await res.json();
        const mapped: SearchResult[] = data.map((r) => ({
          id: String(r.place_id),
          label: r.display_name,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          bbox: r.boundingbox
            ? [
                parseFloat(r.boundingbox[0]),
                parseFloat(r.boundingbox[1]),
                parseFloat(r.boundingbox[2]),
                parseFloat(r.boundingbox[3]),
              ]
            : null,
          type: r.type || r.class,
        }));
        setResults(mapped);
        setOpen(true);
        setActiveIdx(-1);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.warn("Search failed", err);
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [q]);

  const choose = (r: SearchResult) => {
    onSelect(r);
    setOpen(false);
    setQ(r.label.split(",").slice(0, 2).join(","));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIdx >= 0 ? activeIdx : 0];
      if (r) choose(r);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute left-1/2 top-4 z-[500] w-[360px] max-w-[80vw] -translate-x-1/2"
    >
      <div className="relative">
        {loading ? (
          <Loader2 className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
        ) : (
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        )}
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar dirección o comuna…"
          className="w-full rounded-2xl border border-border/60 bg-surface/70 py-2 pl-9 pr-8 text-[13px] text-foreground shadow-apple outline-none backdrop-blur-2xl backdrop-saturate-150 transition-colors placeholder:text-text-muted focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setResults([]);
              setOpen(false);
            }}
            className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-foreground"
            aria-label="Limpiar"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="mt-1.5 max-h-[320px] overflow-auto rounded-2xl border border-border/60 bg-surface/95 py-1 shadow-apple backdrop-blur-2xl backdrop-saturate-150">
          {results.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => choose(r)}
                className={[
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] transition-colors",
                  i === activeIdx
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground hover:bg-surface-2/60",
                ].join(" ")}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                <span className="line-clamp-2 flex-1 leading-snug">{r.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && q.trim().length >= 3 && (
        <div className="mt-1.5 rounded-2xl border border-border/60 bg-surface/95 px-3 py-2.5 text-center text-[12px] text-text-muted shadow-apple backdrop-blur-2xl">
          Sin resultados
        </div>
      )}
    </div>
  );
};
