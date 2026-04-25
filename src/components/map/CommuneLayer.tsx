import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { CircleMarker, Popup, useMap } from "react-leaflet";
import type { CircleMarker as LCircleMarker, LeafletMouseEvent } from "leaflet";
import { COMMUNES, NSE_LABELS, NSE_INCOME, type Commune } from "@/data/communes";
import { colorForPopulation } from "@/utils/colorScales";
import { fmtNum, fmtCLP, fmtArea, fmtDensity } from "@/utils/formatters";
import {
  loadCommuneOverrides,
  saveCommuneOverride,
  type CoordOverrides,
} from "@/utils/communeOverrides";
import { toast } from "sonner";

// Radius proportional to population (sqrt for visual perception)
const radiusForPop = (pop: number): number => {
  const min = 6;
  const max = 22;
  const popMax = 650_000;
  const r = min + (Math.sqrt(pop / popMax) * (max - min));
  return Math.max(min, Math.min(max, r));
};

const FILL = "hsl(199 89% 50%)";
const STROKE = "hsl(199 89% 30%)";
const FILL_DRAG = "hsl(38 92% 50%)";
const STROKE_DRAG = "hsl(38 92% 30%)";

const PopupRow = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-[10px] text-[hsl(215_19%_35%)]">{k}</span>
    <span className="font-mono text-[10px] text-[hsl(210_40%_90%)]">{v}</span>
  </div>
);

const CommunePopup = ({ c, lat, lng }: {
  c: Commune;
  lat: number;
  lng: number;
}) => {
  const hasData = c.pop > 0;
  return (
    <div className="min-w-[180px]">
      <div className="mb-1.5 font-display text-[12px] font-semibold text-[hsl(199_89%_60%)]">
        {c.name}
      </div>
      {hasData ? (
        <div className="space-y-0.5">
          <PopupRow k="Población" v={fmtNum(c.pop)} />
          <PopupRow k="Hogares" v={fmtNum(c.hh)} />
          <PopupRow k="Área" v={fmtArea(c.area)} />
          <PopupRow k="Densidad" v={fmtDensity(c.density)} />
          <PopupRow k="NSE pred." v={NSE_LABELS[c.nse]} />
          <PopupRow k="Ingreso prom." v={`${fmtCLP(NSE_INCOME[c.nse])}/mes`} />
          <PopupRow k="Tráfico" v={`${c.traffic}/100`} />
        </div>
      ) : (
        <div className="text-[10px] text-[hsl(215_19%_55%)]">Sin datos demográficos detallados.</div>
      )}
      <div className="mt-1.5 border-t border-[hsl(215_19%_25%)] pt-1.5 space-y-0.5">
        <PopupRow k="Lat" v={lat.toFixed(5)} />
        <PopupRow k="Lng" v={lng.toFixed(5)} />
        <div className="pt-0.5 text-[9px] italic text-[hsl(215_19%_50%)]">
          Click derecho + arrastrar para reposicionar
        </div>
      </div>
    </div>
  );
};

interface CommuneLayerProps {
  visible?: boolean;
  openPopupFor?: string | null;
  onPopupOpened?: () => void;
}

export const CommuneLayer = ({ visible = true, openPopupFor, onPopupOpened }: CommuneLayerProps) => {
  const map = useMap();
  const markersRef = useRef<Map<string, LCircleMarker>>(new Map());
  const [overrides, setOverrides] = useState<CoordOverrides>(() => loadCommuneOverrides());
  const [draggingName, setDraggingName] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);

  useEffect(() => {
    draggingRef.current = draggingName;
  }, [draggingName]);

  // Apply overrides to commune list
  const communes = useMemo(() => {
    return COMMUNES.map((c) => {
      const ov = overrides[c.name];
      if (ov) return { ...c, lat: ov.lat, lng: ov.lng };
      return c;
    });
  }, [overrides]);

  // Open popup programmatically after fly-to
  useEffect(() => {
    if (!visible || !openPopupFor) return;
    const marker = markersRef.current.get(openPopupFor);
    if (!marker) return;
    const t = setTimeout(() => {
      marker.openPopup();
      onPopupOpened?.();
    }, 850);
    return () => clearTimeout(t);
  }, [openPopupFor, visible, onPopupOpened]);

  // Global mousemove/mouseup while dragging
  useEffect(() => {
    if (!draggingName) return;
    const container = map.getContainer();

    const onMove = (e: LeafletMouseEvent) => {
      const name = draggingRef.current;
      if (!name) return;
      const marker = markersRef.current.get(name);
      if (marker) marker.setLatLng(e.latlng);
    };

    const onUp = (e: LeafletMouseEvent) => {
      const name = draggingRef.current;
      if (!name) return;
      const { lat, lng } = e.latlng;
      saveCommuneOverride(name, lat, lng);
      setOverrides((prev) => ({ ...prev, [name]: { lat: +lat.toFixed(6), lng: +lng.toFixed(6) } }));
      setDraggingName(null);
      // Re-enable map dragging
      map.dragging.enable();
      container.style.cursor = "";
      toast.success(`${name} reposicionado`, {
        description: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      });
      // Prevent default contextmenu on mouseup-right
      e.originalEvent?.preventDefault?.();
    };

    // Disable map drag while we're dragging marker
    map.dragging.disable();
    container.style.cursor = "grabbing";

    map.on("mousemove", onMove);
    map.on("mouseup", onUp);

    // Suppress browser context menu while dragging
    const suppressCtx = (ev: MouseEvent) => ev.preventDefault();
    container.addEventListener("contextmenu", suppressCtx);

    return () => {
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      container.removeEventListener("contextmenu", suppressCtx);
      map.dragging.enable();
      container.style.cursor = "";
    };
  }, [draggingName, map]);

  const handleStartDrag = useCallback((name: string, e: LeafletMouseEvent) => {
    // Right-click only
    const btn = (e.originalEvent as MouseEvent | undefined)?.button;
    if (btn !== 2) return;
    e.originalEvent?.preventDefault?.();
    setDraggingName(name);
  }, []);

  if (!visible) return null;
  return (
    <>
      {communes.map((c) => {
        const hasData = c.pop > 0;
        const r = hasData ? radiusForPop(c.pop) : 4;
        const opacity = hasData ? 0.45 + (c.pop / 650_000) * 0.4 : 0.5;
        const isDragging = draggingName === c.name;
        return (
          <CircleMarker
            key={c.name}
            center={[c.lat, c.lng]}
            radius={isDragging ? r + 2 : r}
            ref={(instance) => {
              if (instance) markersRef.current.set(c.name, instance);
              else markersRef.current.delete(c.name);
            }}
            pathOptions={{
              color: isDragging ? STROKE_DRAG : STROKE,
              weight: hasData ? 1.75 : 1,
              opacity: 0.9,
              fillColor: isDragging ? FILL_DRAG : FILL,
              fillOpacity: Math.min(0.85, opacity),
            }}
            eventHandlers={{
              mousedown: (e) => handleStartDrag(c.name, e),
              contextmenu: (e) => {
                // Avoid leaflet's default contextmenu popup
                e.originalEvent?.preventDefault?.();
              },
            }}
          >
            <Popup>
              <CommunePopup c={c} lat={c.lat} lng={c.lng} />
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
};
