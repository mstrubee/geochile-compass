import { Clock, Hexagon, FileUp } from "lucide-react";

interface HeaderProps {
  mode: "none" | "isochrone" | "microzone";
  onToggleIsochrone: () => void;
  onToggleMicrozone: () => void;
}

export const Header = ({ mode, onToggleIsochrone, onToggleMicrozone }: HeaderProps) => {
  return (
    <header className="z-[1000] flex h-[52px] flex-shrink-0 items-center gap-2 border-b border-border bg-surface px-3.5">
      <h1 className="whitespace-nowrap font-display text-[18px] font-extrabold tracking-tight text-primary">
        Geo<span className="text-brand-orange">Chile</span>
      </h1>

      <span className="rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1.5px] text-primary">
        SIG v3.0
      </span>

      <span className="flex items-center gap-1.5 rounded-sm border border-brand-green/40 bg-brand-green/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1px] text-brand-green">
        <span className="h-1.5 w-1.5 animate-blink rounded-full bg-brand-green" />
        OSM Live
      </span>

      <span className="hidden whitespace-nowrap font-mono text-[10px] text-text-muted md:inline">
        🇨🇱 Chile · 🏙 Santiago RM
      </span>

      <div className="flex-1" />

      <button
        onClick={onToggleIsochrone}
        className={[
          "whitespace-nowrap rounded-md border px-2.5 py-1.5 font-body text-[12px] transition-colors",
          mode === "isochrone"
            ? "animate-pulse-iso border-iso-1/60 bg-iso-1/15 text-iso-1"
            : "border-border bg-surface-2 text-muted-foreground hover:border-primary hover:text-primary",
        ].join(" ")}
      >
        <Clock className="mr-1 inline h-3 w-3" /> Isócronas
      </button>

      <button
        onClick={onToggleMicrozone}
        className={[
          "whitespace-nowrap rounded-md border px-2.5 py-1.5 font-body text-[12px] transition-colors",
          mode === "microzone"
            ? "animate-pulse-mz border-brand-purple/50 bg-brand-purple/15 text-brand-purple"
            : "border-border bg-surface-2 text-muted-foreground hover:border-primary hover:text-primary",
        ].join(" ")}
      >
        <Hexagon className="mr-1 inline h-3 w-3" /> Microzona
      </button>

      <button className="whitespace-nowrap rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 font-body text-[12px] text-primary transition-colors hover:bg-primary/20">
        <FileUp className="mr-1 inline h-3 w-3" /> Archivo
      </button>
    </header>
  );
};
