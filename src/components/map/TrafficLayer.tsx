import { CircleMarker, Popup } from "react-leaflet";
import { COMMUNES, type Commune } from "@/data/communes";
import { fmtNum } from "@/utils/formatters";

// Traffic thresholds: <50 fluido (verde) · 50-72 moderado (amarillo) · >72 alto (rojo)
const trafficColor = (t: number): { hsl: string; label: string } => {
  if (t < 50) return { hsl: "hsl(142 71% 45%)", label: "Fluido" };
  if (t <= 72) return { hsl: "hsl(47 95% 53%)", label: "Moderado" };
  return { hsl: "hsl(0 84% 60%)", label: "Alto" };
};

// Radius scales with traffic intensity: 6 → 18px
const radiusForTraffic = (t: number): number => 6 + (t / 100) * 12;

const PopupRow = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-[10px] text-[hsl(215_19%_35%)]">{k}</span>
    <span className="font-mono text-[10px] text-[hsl(210_40%_90%)]">{v}</span>
  </div>
);

const TrafficPopup = ({ c }: { c: Commune }) => {
  const tc = trafficColor(c.traffic);
  return (
    <div className="min-w-[180px]">
      <div className="mb-1.5 font-display text-[12px] font-semibold" style={{ color: tc.hsl }}>
        {c.name}
      </div>
      <div className="space-y-0.5">
        <PopupRow k="Índice tráfico" v={`${c.traffic}/100`} />
        <PopupRow k="Categoría" v={tc.label} />
        <PopupRow k="Población" v={fmtNum(c.pop)} />
        <PopupRow k="Hora punta est." v={c.traffic > 72 ? "07:30 / 18:30" : c.traffic > 50 ? "08:00 / 19:00" : "—"} />
      </div>
    </div>
  );
};

interface TrafficLayerProps {
  visible?: boolean;
}

export const TrafficLayer = ({ visible = true }: TrafficLayerProps) => {
  if (!visible) return null;
  return (
    <>
      {COMMUNES.map((c) => {
        const tc = trafficColor(c.traffic);
        return (
          <CircleMarker
            key={`tr-${c.name}`}
            center={[c.lat, c.lng]}
            radius={radiusForTraffic(c.traffic)}
            pathOptions={{
              color: tc.hsl,
              weight: 1.5,
              fillColor: tc.hsl,
              fillOpacity: 0.55,
            }}
          >
            <Popup>
              <TrafficPopup c={c} />
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
};
