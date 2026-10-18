import type { HealthEstablishmentRow } from "@/types/health";
import { claseText, COMPLEJIDAD_LABEL, DEPENDENCIA_LABEL, GEO_MARKED, GEO_STATUS_LABEL, WARN } from "@/utils/healthScale";

/** Popup de un establecimiento. Siempre dice la clase (y si es imputada), el estado y, si corresponde, que la ubicación está marcada. */
export const HealthPopup = ({ row }: { row: HealthEstablishmentRow }) => (
  <div className="min-w-[210px] space-y-1 text-xs" data-testid="health-popup">
    <p className="text-sm font-semibold">{row.name}</p>
    <p>{row.tipo_glosa} · {row.comuna_name}</p>
    <p><span className="font-medium">Dependencia: </span>{DEPENDENCIA_LABEL[row.dependencia_norm] ?? row.dependencia_norm}</p>
    <p><span className="font-medium">Complejidad: </span>{COMPLEJIDAD_LABEL[row.complejidad]}</p>
    <p><span className="font-medium">Clase: </span>{claseText(row)}</p>
    {(row.alta_hospital || row.alta_ampliada) && (
      <p className="font-medium">
        Alta complejidad: {row.alta_hospital ? "hospital (definición por defecto y ampliada)" : "solo en la definición ampliada (clínica o centro de especialidades)"}
      </p>
    )}
    <p><span className="font-medium">Estado: </span>{row.estado === "vigente" ? "Vigente" : "CERRADO (no cuenta como oferta vigente)"}</p>
    {row.tiene_urgencia != null && <p><span className="font-medium">Servicio de urgencia: </span>{row.tiene_urgencia ? "sí" : "no"}</p>}
    {row.address && <p>{row.address}</p>}
    {GEO_MARKED.has(row.geo_status) && (
      <p className="text-amber-700 dark:text-amber-400">
        {GEO_STATUS_LABEL[row.geo_status]}{row.geo_distance_m != null ? ` · a ${Math.round(row.geo_distance_m).toLocaleString("es-CL")} m de su comuna` : ""}. El punto es el original de la fuente.
      </p>
    )}
    <p className="text-muted-foreground">Código {row.code}. {WARN.registry}</p>
  </div>
);
