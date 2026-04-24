import { CircleMarker, Popup } from "react-leaflet";
import { COMMUNES, NSE_LABELS, type Commune, type NSE } from "@/data/communes";
import { fmtNum } from "@/utils/formatters";
import { trafficLevelOf, TRAFFIC_LEVELS, type TrafficLevel } from "@/utils/traffic";

const radiusForTraffic = (t: number): number => 6 + (t / 100) * 12;

const PopupRow = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-[10px] text-[hsl(215_19%_35%)]">{k}</span>
    <span className="font-mono text-[10px] text-[hsl(210_40%_90%)]">{v}</span>
  </div>
);

const TrafficPopup = ({ c }: { c: Commune }) => {
  const lvl = trafficLevelOf(c.traffic);
  const tc = TRAFFIC_LEVELS[lvl];
  return (
    <div className="min-w-[180px]">
      <div className="mb-1.5 font-display text-[12px] font-semibold" style={{ color: tc.hsl }}>
        {c.name}
      </div>
      <div className="space-y-0.5">
        <PopupRow k="Índice tráfico" v={`${c.traffic}/100`} />
        <PopupRow k="Categoría" v={tc.label} />
        <PopupRow k="Población" v={fmtNum(c.pop)} />
        <PopupRow k="NSE pred." v={NSE_LABELS[c.nse]} />
        <PopupRow k="Hora punta est." v={c.traffic > 72 ? "07:30 / 18:30" : c.traffic > 50 ? "08:00 / 19:00" : "—"} />
      </div>
    </div>
  );
};

interface TrafficLayerProps {
  visible?: boolean;
  nseFilter?: NSE | null;
  trafficFilter?: TrafficLevel | null;
}

export const TrafficLayer = ({ visible = true, nseFilter = null, trafficFilter = null }: TrafficLayerProps) => {
  if (!visible) return null;
  const anyFilter = nseFilter !== null || trafficFilter !== null;
  return (
    <>
      {COMMUNES.map((c) => {
        const lvl = trafficLevelOf(c.traffic);
        const tc = TRAFFIC_LEVELS[lvl];
        const matchNse = nseFilter === null || c.nse === nseFilter;
        const matchTraffic = trafficFilter === null || lvl === trafficFilter;
        const isMatch = matchNse && matchTraffic;
        const baseR = radiusForTraffic(c.traffic);
        const radius = anyFilter && isMatch ? baseR + 4 : baseR;
        const fillOpacity = !anyFilter ? 0.55 : isMatch ? 0.7 : 0.06;
        const strokeOpacity = !anyFilter ? 1 : isMatch ? 1 : 0.18;
        const weight = anyFilter && isMatch ? 2.5 : 1.5;
        return (
          <CircleMarker
            key={`tr-${c.name}`}
            center={[c.lat, c.lng]}
            radius={radius}
            pathOptions={{
              color: tc.hsl,
              weight,
              opacity: strokeOpacity,
              fillColor: tc.hsl,
              fillOpacity,
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
