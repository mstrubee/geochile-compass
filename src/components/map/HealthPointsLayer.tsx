import { CircleMarker, Popup } from "react-leaflet";
import type { HealthEstablishmentRow } from "@/types/health";
import { CLASE_COLOR, GEO_MARKED, pointRadius } from "@/utils/healthScale";
import { HealthPopup } from "./HealthPopup";

/**
 * Establecimientos de salud. Color = clase (ambulatorio / hospitalario / sin clasificar); radio mayor = alta complejidad (definición ampliada);
 * relleno tenue = clase imputada por la tabla de diseño; borde rojo punteado = ubicación marcada (el punto es SIEMPRE el original de la fuente);
 * gris hueco = cerrado.
 */
export const HealthPointsLayer = ({ rows }: { rows: HealthEstablishmentRow[] }) => (
  <>
    {rows.map((r) => {
      const closed = r.estado === "cerrado";
      const marked = GEO_MARKED.has(r.geo_status);
      return (
        <CircleMarker key={r.code} center={[r.lat, r.lon]} radius={pointRadius(r)}
          pathOptions={{
            color: marked ? "#dc2626" : "#111827", weight: marked ? 2.5 : 1, dashArray: marked ? "3 2" : undefined,
            fillColor: closed ? "#9ca3af" : CLASE_COLOR[r.clase_servicio], fillOpacity: closed ? 0.15 : r.clase_fuente === "tabla" ? 0.5 : 0.85,
          }}>
          <Popup><HealthPopup row={r} /></Popup>
        </CircleMarker>
      );
    })}
  </>
);
