// ============================================================================
// MapContextMenu.tsx
//
// Menú contextual del mapa (click derecho). Renderiza una lista de acciones
// posicionada en las coordenadas del cursor. Se cierra al hacer click afuera
// o presionar Escape.
// ============================================================================
import { useEffect, useRef } from "react";

export interface MapContextMenuItem {
  key: string;
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MapContextMenuItem[];
  onClose: () => void;
}

export const MapContextMenu = ({ x, y, items, onClose }: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamping a viewport para no salirse del borde derecho/inferior.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(x, vw - 220);
  const top = Math.min(y, vh - items.length * 36 - 8);

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[200px] overflow-hidden rounded-lg border border-border/60 bg-surface/95 shadow-apple-lg backdrop-blur-xl"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.key}
          disabled={it.disabled}
          onClick={() => {
            if (it.disabled) return;
            it.onClick();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {it.icon && <span className="text-[14px] leading-none">{it.icon}</span>}
          <span className="flex-1">{it.label}</span>
        </button>
      ))}
    </div>
  );
};
