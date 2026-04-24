interface CoordsBarProps {
  coords: { lat: number; lng: number } | null;
}

export const CoordsBar = ({ coords }: CoordsBarProps) => {
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-[500] -translate-x-1/2 rounded-full border border-border/60 bg-surface/70 px-3 py-1 font-mono text-[10px] text-muted-foreground shadow-apple-sm backdrop-blur-2xl backdrop-saturate-150">
      LAT {coords ? coords.lat.toFixed(5) : "—"} · LNG {coords ? coords.lng.toFixed(5) : "—"}
    </div>
  );
};
