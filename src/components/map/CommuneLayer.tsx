import { CircleMarker, Popup } from "react-leaflet";
import { COMMUNES, NSE_LABELS, NSE_INCOME, type Commune } from "@/data/communes";
import { fmtNum, fmtCLP, fmtArea, fmtDensity } from "@/utils/formatters";

// Radius proportional to population (sqrt for visual perception)
const radiusForPop = (pop: number): number => {
  const min = 6;
  const max = 22;
  const popMax = 650_000;
  const r = min + (Math.sqrt(pop / popMax) * (max - min));
  return Math.max(min, Math.min(max, r));
};

// Use design-system primary as base color (sky / #38bdf8)
const FILL = "hsl(199 89% 60%)";

const PopupRow = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-[10px] text-[hsl(215_19%_35%)]">{k}</span>
    <span className="font-mono text-[10px] text-[hsl(210_40%_90%)]">{v}</span>
  </div>
);

const CommunePopup = ({ c }: { c: Commune }) => (
  <div className="min-w-[180px]">
    <div className="mb-1.5 font-display text-[12px] font-semibold text-[hsl(199_89%_60%)]">
      {c.name}
    </div>
    <div className="space-y-0.5">
      <PopupRow k="Población" v={fmtNum(c.pop)} />
      <PopupRow k="Hogares" v={fmtNum(c.hh)} />
      <PopupRow k="Área" v={fmtArea(c.area)} />
      <PopupRow k="Densidad" v={fmtDensity(c.density)} />
      <PopupRow k="NSE pred." v={NSE_LABELS[c.nse]} />
      <PopupRow k="Ingreso prom." v={`${fmtCLP(NSE_INCOME[c.nse])}/mes`} />
      <PopupRow k="Tráfico" v={`${c.traffic}/100`} />
    </div>
  </div>
);

interface CommuneLayerProps {
  visible?: boolean;
}

export const CommuneLayer = ({ visible = true }: CommuneLayerProps) => {
  if (!visible) return null;
  return (
    <>
      {COMMUNES.map((c) => {
        const r = radiusForPop(c.pop);
        // Opacity proportional to relative population
        const opacity = 0.35 + (c.pop / 650_000) * 0.4;
        return (
          <CircleMarker
            key={c.name}
            center={[c.lat, c.lng]}
            radius={r}
            pathOptions={{
              color: FILL,
              weight: 1.5,
              fillColor: FILL,
              fillOpacity: Math.min(0.75, opacity),
            }}
          >
            <Popup>
              <CommunePopup c={c} />
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
};
