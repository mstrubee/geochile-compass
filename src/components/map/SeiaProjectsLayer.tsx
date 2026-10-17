import { CircleMarker, Popup, Tooltip } from "react-leaflet";
import type { SeiaProjectRow } from "@/types/projects";
import { isCoarseLocation, SEIA_DOUBTFUL, stateColor } from "@/utils/projectsScale";
import { SeiaPopup } from "./ProjectPopups";

/**
 * Proyectos del SEIA. Color por ESTADO de evaluación (se muestra siempre). Una ubicación dudosa (fuera de su comuna declarada, con la comuna sin
 * cruzar, o con coordenadas redondeadas a grado entero) se dibuja con borde rojo punteado; el punto es siempre el ORIGINAL de la fuente. Una corrección propuesta se dibuja aparte, rotulada.
 */
export const SeiaProjectsLayer = ({ rows }: { rows: SeiaProjectRow[] }) => (
  <>
    {rows.map((r) => {
      const doubtful = SEIA_DOUBTFUL.has(r.geo_status) || isCoarseLocation(r);
      return (
        <CircleMarker key={`${r.service_layer}-${r.expediente_id}`} center={[r.lat, r.lon]} radius={6}
          pathOptions={{ color: doubtful ? "#dc2626" : "#111827", weight: doubtful ? 2.5 : 1, dashArray: doubtful ? "3 2" : undefined, fillColor: stateColor(r.status_declared), fillOpacity: doubtful ? 0.35 : 0.85 }}>
          <Popup><SeiaPopup row={r} /></Popup>
        </CircleMarker>
      );
    })}
    {rows.filter((r) => r.review_decision === "propose_correction" && r.proposed_lon != null && r.proposed_lat != null).map((r) => (
      <CircleMarker key={`rev-${r.service_layer}-${r.expediente_id}`} center={[r.proposed_lat as number, r.proposed_lon as number]} radius={6}
        pathOptions={{ color: "#2563eb", weight: 2, dashArray: "2 3", fillOpacity: 0 }}>
        <Tooltip>Corrección PROPUESTA (no oficial) para «{r.name}»</Tooltip>
      </CircleMarker>
    ))}
  </>
);
