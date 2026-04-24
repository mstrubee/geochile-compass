import { Search } from "lucide-react";

export const SearchBar = () => {
  return (
    <div className="absolute left-1/2 top-3.5 z-[500] w-[300px] max-w-[80vw] -translate-x-1/2">
      <div className="relative">
        <input
          type="text"
          placeholder="Buscar comuna…"
          className="w-full rounded-full border border-border bg-surface/93 px-3 py-1.5 pr-9 font-body text-[12px] text-foreground outline-none backdrop-blur transition-colors placeholder:text-text-muted focus:border-primary"
        />
        <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      </div>
    </div>
  );
};
