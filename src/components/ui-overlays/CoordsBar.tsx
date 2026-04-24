interface CoordsBarProps {
  coords: { lat: number; lng: number } | null;
}

export const CoordsBar = ({ coords }: CoordsBarProps) => {
  return (
    <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-[500] -translate-x-1/2 rounded-sm border border-border bg-background/80 px-3 py-0.5 font-mono text-[9px] text-text-muted">
      LAT {coords ? coords.lat.toFixed(5) : "—"} · LNG {coords ? coords.lng.toFixed(5) : "—"}
    </div>
  );
};
