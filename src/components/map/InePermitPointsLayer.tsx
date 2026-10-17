import { useEffect } from "react";
import { CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { InePermitPointRow } from "@/types/projects";
import { clusterRadius, fmtInt, PRECISION_OPACITY, USO_COLOR } from "@/utils/projectsScale";
import { PermitClusterPopup, PermitPointPopup } from "./ProjectPopups";

export type PermitView = "clusters" | "heat";

/** Mapa de calor por unidades (no por número de puntos: un punto agrupa varias unidades). */
const HeatByUnits = ({ rows }: { rows: InePermitPointRow[] }) => {
  const map = useMap();
  useEffect(() => {
    const max = Math.max(1, ...rows.map((r) => Math.log1p(r.units)));
    const pts = rows.map((r) => [r.lat, r.lon, Math.log1p(r.units) / max] as [number, number, number]);
    const layer = (L as unknown as { heatLayer: (p: unknown, o: unknown) => L.Layer }).heatLayer(pts, { radius: 18, blur: 20, maxZoom: 14, max: 1 });
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [map, rows]);
  return null;
};

/**
 * Permisos georreferenciados del INE. Zoom bajo → clusters (por unidades); zoom alto → puntos coloreados por destino con opacidad según la
 * PRECISIÓN de la ubicación (BAJA y sin dato casi transparentes) y borde rojo punteado si caen fuera de su comuna declarada.
 */
export const InePermitPointsLayer = ({ rows, view }: { rows: InePermitPointRow[]; view: PermitView }) => {
  if (view === "heat") return <HeatByUnits rows={rows} />;
  return (
    <>
      {rows.map((r, i) =>
        r.kind === "cluster" ? (
          <CircleMarker key={`c${i}`} center={[r.lat, r.lon]} radius={clusterRadius(r.units)}
            pathOptions={{ color: "#c2410c", weight: 1, fillColor: "#f97316", fillOpacity: 0.55 }}>
            <Tooltip direction="center" permanent className="!bg-transparent !border-0 !shadow-none !text-[10px] !font-semibold !text-white">{fmtInt(r.units)}</Tooltip>
            <Popup><PermitClusterPopup row={r} /></Popup>
          </CircleMarker>
        ) : (
          <CircleMarker key={`p${r.src_oid ?? i}`} center={[r.lat, r.lon]} radius={Math.min(4 + Math.log10(Math.max(r.units, 1)) * 3, 12)}
            pathOptions={{
              color: r.geo_status === 2 ? "#dc2626" : "#1f2937", weight: r.geo_status === 2 ? 2 : 0.8, dashArray: r.geo_status === 2 ? "3 2" : undefined,
              fillColor: r.uso ? USO_COLOR[r.uso] : "#6b7280", fillOpacity: r.geo_precision != null ? PRECISION_OPACITY[r.geo_precision] : 0.5,
            }}>
            <Popup><PermitPointPopup row={r} /></Popup>
          </CircleMarker>
        ),
      )}
    </>
  );
};
