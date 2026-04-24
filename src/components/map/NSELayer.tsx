import { CircleMarker, Popup } from "react-leaflet";
import { COMMUNES, NSE_LABELS, NSE_INCOME, NSE_COLOR_HSL, type Commune } from "@/data/communes";
import { fmtNum, fmtCLP } from "@/utils/formatters";

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
      </div>
      <div className="mt-1.5 font-mono text-[9px] text-[hsl(215_19%_35%)]">
        Fuente: CASEN 2022 (estimado)
      </div>
    </div>
  );
};

interface NSELayerProps {
  visible?: boolean;
  filter?: import("@/data/communes").NSE | null;
}

export const NSELayer = ({ visible = true, filter = null }: NSELayerProps) => {
  if (!visible) return null;
  return (
    <>
      {COMMUNES.map((c) => {
        const color = `hsl(${NSE_COLOR_HSL[c.nse]})`;
        const isMatch = filter == null || c.nse === filter;
        const radius = filter != null && isMatch ? 18 : 14;
        const fillOpacity = isMatch ? 0.65 : 0.08;
        const strokeOpacity = isMatch ? 1 : 0.2;
        const weight = filter != null && isMatch ? 2.5 : 1.5;
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
