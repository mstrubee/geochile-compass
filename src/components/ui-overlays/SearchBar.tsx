import { Search } from "lucide-react";

export const SearchBar = () => {
  return (
    <div className="absolute left-1/2 top-4 z-[500] w-[320px] max-w-[80vw] -translate-x-1/2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Buscar comuna…"
          className="w-full rounded-2xl border border-border/60 bg-surface/70 py-2 pl-9 pr-3 text-[13px] text-foreground shadow-apple outline-none backdrop-blur-2xl backdrop-saturate-150 transition-colors placeholder:text-text-muted focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
        />
      </div>
    </div>
  );
};
