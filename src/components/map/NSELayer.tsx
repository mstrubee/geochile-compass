import { CircleMarker, Popup } from "react-leaflet";
import { COMMUNES, NSE_LABELS, NSE_INCOME, NSE_COLOR_HSL, type Commune, type NSE } from "@/data/communes";
import { fmtNum, fmtCLP } from "@/utils/formatters";
import { trafficLevelOf, type TrafficLevel } from "@/utils/traffic";

const PopupRow = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-[10px] text-[hsl(215_19%_35%)]">{k}</span>
    <span className="font-mono text-[10px] text-[hsl(210_40%_90%)]">{v}</span>
  </div>
);

const NSEPopup = ({ c }: { c: Commune }) => {
  const color = `hsl(${NSE_COLOR_HSL[c.nse]})`;
  return (
    <div className="min-w-[180px]">
      <div className="mb-1.5 font-display text-[12px] font-semibold" style={{ color }}>
        {c.name}
      </div>
      <div className="space-y-0.5">
        <PopupRow k="NSE pred." v={NSE_LABELS[c.nse]} />
        <PopupRow k="Ingreso prom." v={`${fmtCLP(NSE_INCOME[c.nse])}/mes`} />
        <PopupRow k="Población" v={fmtNum(c.pop)} />
        <PopupRow k="Hogares" v={fmtNum(c.hh)} />
        <PopupRow k="Tráfico" v={`${c.traffic}/100`} />
      </div>
      <div className="mt-1.5 font-mono text-[9px] text-[hsl(215_19%_35%)]">
        Fuente: CASEN 2022 (estimado)
      </div>
    </div>
  );
};

interface NSELayerProps {
  visible?: boolean;
  nseFilter?: NSE | null;
  trafficFilter?: TrafficLevel | null;
}

export const NSELayer = ({ visible = true, nseFilter = null, trafficFilter = null }: NSELayerProps) => {
  if (!visible) return null;
  const anyFilter = nseFilter !== null || trafficFilter !== null;
  return (
    <>
      {COMMUNES.map((c) => {
        const color = `hsl(${NSE_COLOR_HSL[c.nse]})`;
        const matchNse = nseFilter === null || c.nse === nseFilter;
        const matchTraffic = trafficFilter === null || trafficLevelOf(c.traffic) === trafficFilter;
        const isMatch = matchNse && matchTraffic;
        const radius = anyFilter && isMatch ? 18 : 14;
        const fillOpacity = !anyFilter ? 0.6 : isMatch ? 0.7 : 0.06;
        const strokeOpacity = !anyFilter ? 1 : isMatch ? 1 : 0.18;
        const weight = anyFilter && isMatch ? 2.5 : 1.5;
        return (
          <CircleMarker
            key={`nse-${c.name}`}
            center={[c.lat, c.lng]}
            radius={radius}
            pathOptions={{
              color,
              weight,
              opacity: strokeOpacity,
              fillColor: color,
              fillOpacity,
            }}
          >
            <Popup>
              <NSEPopup c={c} />
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
};
