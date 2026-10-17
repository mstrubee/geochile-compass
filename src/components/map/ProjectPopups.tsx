import { ExternalLink } from "lucide-react";
import type { CrfPolygonRow, InePermitPointRow, SeiaProjectRow } from "@/types/projects";
import {
  fmtDate, fmtInt, fmtUsd, PE_GEO_STATUS_LABEL, PRECISION_LABEL, safeHttpUrl, SEIA_DOUBTFUL, SEIA_GEO_STATUS_LABEL, USO_LABEL, WARN,
} from "@/utils/projectsScale";

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-1"><span className="font-medium">{k}:</span><span>{v}</span></div>
);

/** Un punto del INE. Dice qué es (y qué no) en el propio globo, no solo en la leyenda. */
export const PermitPointPopup = ({ row }: { row: InePermitPointRow }) => (
  <div className="min-w-[210px] space-y-1 text-xs" data-testid="popup-permit-point">
    <div className="text-sm font-semibold">Registro del INE · año {row.year ?? "—"}</div>
    <Row k="Unidades" v={fmtInt(row.units)} />
    <Row k="Destino" v={row.uso ? USO_LABEL[row.uso] : "sin dato"} />
    {row.glosa && <Row k="Glosa de destino" v={row.glosa} />}
    {row.floors != null && <Row k="Pisos" v={row.floors} />}
    {row.area_m2 != null && <Row k="Superficie" v={`${fmtInt(row.area_m2)} (m² según la fuente; unidad no declarada)`} />}
    <Row k="Precisión de la ubicación" v={row.geo_precision != null ? PRECISION_LABEL[row.geo_precision] : "sin dato"} />
    {row.geo_status != null && row.geo_status !== 0 && <p className="text-amber-700">{PE_GEO_STATUS_LABEL[row.geo_status]}</p>}
    <Row k="Comuna (CUT)" v={row.comuna_cut ?? "—"} />
    <p className="text-amber-700">{WARN.yearOnly} {WARN.noPermitNumber}</p>
    <p className="text-amber-700">{WARN.recordNotPermit}</p>
  </div>
);

export const PermitClusterPopup = ({ row }: { row: InePermitPointRow }) => (
  <div className="min-w-[200px] space-y-1 text-xs" data-testid="popup-permit-cluster">
    <div className="text-sm font-semibold">Zona agrupada</div>
    <Row k="Unidades (suma)" v={fmtInt(row.units)} />
    <Row k="Puntos" v={fmtInt(row.n_points)} />
    <p className="text-muted-foreground">Acerque el mapa para ver los puntos de esta zona.</p>
    <p className="text-amber-700">{WARN.recordNotPermit}</p>
  </div>
);

export const CrfPopup = ({ row }: { row: CrfPolygonRow }) => (
  <div className="min-w-[210px] space-y-1 text-xs" data-testid="popup-crf">
    <div className="text-sm font-semibold">Recepción final · año {row.year}</div>
    <Row k="Viviendas del certificado" v={fmtInt(row.dwellings)} />
    <Row k="Comuna (CUT)" v={row.comuna_cut} />
    {row.geom_status > 0 && <p className="text-amber-700">{row.geom_status === 2 ? "Polígono reparado con diferencia de área sobre el umbral: revisión pendiente." : "Polígono reparado (la geometría original de la fuente era inválida)."}</p>}
    <p className="text-amber-700">{WARN.crfNotPermit}</p>
  </div>
);

export const SeiaPopup = ({ row }: { row: SeiaProjectRow }) => {
  const url = safeHttpUrl(row.expediente_url);
  return (
    <div className="min-w-[240px] max-w-[300px] space-y-1 text-xs" data-testid="popup-seia">
      <div className="text-sm font-semibold">{row.name}</div>
      <Row k="Tipo de evaluación" v={`${row.form} · expediente ${row.expediente_id}`} />
      <Row k="Estado de evaluación" v={<b>{row.status_declared}</b>} />
      <Row k="Tipología" v={`${row.typology_letter} ${row.typology_name.replace(/^[a-zñ.0-9]+\)\s*/i, "")}`.slice(0, 160)} />
      <Row k="Titular" v={row.titular ?? "—"} />
      <Row k="Comuna declarada" v={row.comunas_declared ?? "—"} />
      <Row k="Presentado" v={fmtDate(row.submitted_at) ?? "—"} />
      <Row k="Fecha de calificación" v={fmtDate(row.qualified_at) ?? "—"} />
      <Row k="Inversión declarada" v={fmtUsd(row.investment_usd)} />
      {SEIA_DOUBTFUL.has(row.geo_status) && (
        <p className="text-red-700" data-testid="popup-seia-doubtful">
          {SEIA_GEO_STATUS_LABEL[row.geo_status]}
          {row.geo_status === 2 && row.geo_distance_m != null && ` — a ≈ ${fmtInt(Math.round(row.geo_distance_m))} m de su comuna`}
          . El punto mostrado es el original de la fuente; no se movió.
        </p>
      )}
      {row.review_decision === "propose_correction" && <p className="text-blue-700">Hay una corrección PROPUESTA (no oficial){row.review_note ? `: ${row.review_note}` : ""}; se dibuja aparte.</p>}
      <p className="text-amber-700">{WARN.seiaQualified} {WARN.seiaInvestment}</p>
      {url && <a className="underline" href={url} target="_blank" rel="noopener noreferrer">Expediente en el SEIA<ExternalLink className="ml-0.5 inline h-3 w-3" /></a>}
    </div>
  );
};
