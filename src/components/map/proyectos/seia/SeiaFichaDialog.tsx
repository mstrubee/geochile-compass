import { ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSeiaProject } from "@/hooks/useSeia";
import type { SeiaGeoStatus, SeiaProjectDetail } from "@/types/seia";
import { expedienteLink, formatDate, formatUsd, GEO_LABEL, typologyCode } from "@/utils/seiaFilters";

interface Props {
  selected: { source_key: string; external_id: string } | null;
  onClose: () => void;
}

const REVIEW_LABEL = { confirmed_ok: "Ubicación confirmada", confirmed_error: "Ubicación confirmada como errónea", corrected: "Corrección propuesta" } as const;
const GEO_BADGE: Record<SeiaGeoStatus, string> = {
  inside: "", near_border: "", outside_declared: "border-red-500 text-red-700", comuna_unmatched: "border-gray-500 text-gray-700", no_geometry: "border-gray-500 text-gray-700", pending: "border-gray-500 text-gray-700",
};

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[9rem_1fr] gap-2 border-t py-1 first:border-t-0"><dt className="text-muted-foreground">{k}</dt><dd>{children}</dd></div>
);

const Body = ({ d }: { d: SeiaProjectDetail }) => {
  const p = d.project;
  const link = expedienteLink(p);
  const verified = d.source.verification_status === "comprobado";
  const flagged = p.geo_check_status === "outside_declared";
  return (
    <div className="space-y-3 text-xs">
      <p data-testid="ficha-scope" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
        Este proyecto <b>ingresó al SEIA</b>: no es un permiso de edificación. La fecha de calificación no es fecha de permiso ni de inicio de obras, y la inversión es <b>declarada</b> por el titular, no ejecutada.
      </p>
      <dl>
        <Row k="Expediente">{p.kind} · {p.external_id}</Row>
        <Row k="Titular">{p.titular ?? "—"}</Row>
        <Row k="Estado declarado">{p.status_declared ?? "—"}</Row>
        <Row k="Tipología">
          {p.typology_name ?? p.typology_letter ?? "—"}
          {typologyCode(p.typology_letter) === "h.1" && <p className="text-muted-foreground" data-testid="ficha-h1-note">«Proyectos inmobiliarios» incluye proyectos no residenciales (p. ej. fábricas o centros comerciales): no implica vivienda.</p>}
        </Row>
        <Row k="Forma de presentación">{p.submission_form_declared ?? "—"}</Row>
        <Row k="Fecha de presentación">{formatDate(p.submitted_at)}</Row>
        <Row k="Fecha de calificación">{formatDate(p.qualified_at)} <span className="text-muted-foreground">(no es fecha de permiso)</span></Row>
        <Row k="Inversión declarada"><span data-testid="ficha-investment">{formatUsd(p.investment_usd)}</span></Row>
        <Row k="Región / comunas">
          {p.region_declared ?? "—"} · {p.comunas_declared ?? "—"}
          {p.comunas_unresolved.length > 0 && <p className="text-amber-700" data-testid="ficha-unresolved">No se pudo identificar: {p.comunas_unresolved.join(", ")}.</p>}
        </Row>
      </dl>

      <div className="space-y-1 rounded border p-2" data-testid="ficha-location">
        <div className="flex flex-wrap items-center gap-2">
          <b>Ubicación</b>
          <Badge variant="outline" className={GEO_BADGE[p.geo_check_status]}>{GEO_LABEL[p.geo_check_status]}</Badge>
        </div>
        {p.lat != null && p.lon != null
          ? <p className="font-mono">{p.lat.toFixed(5)}, {p.lon.toFixed(5)} <span className="font-sans text-muted-foreground">(punto original del SEA)</span></p>
          : <p>El servicio no entregó un punto para este expediente.</p>}
        {flagged && (
          <p role="alert" className="text-red-700">
            El punto cae a {p.geo_check_distance_m != null ? `${Math.round(p.geo_check_distance_m).toLocaleString("es-CL")} m` : "una distancia no calculada"} de la comuna que declara el expediente
            {p.geo_check_detail?.tolerance_m != null && <> (tolerancia {p.geo_check_detail.tolerance_m} m)</>}. Se muestra tal como lo informa el SEA: <b>no se movió</b>.
          </p>
        )}
        {d.reviews.length > 0 && (
          <ul className="space-y-1" data-testid="ficha-reviews">
            {d.reviews.map((r, i) => (
              <li key={i} className="border-t pt-1">
                <b>{REVIEW_LABEL[r.decision]}</b> · {formatDate(r.reviewed_at)}: {r.note}
                {r.proposed_lat != null && r.proposed_lon != null && <span className="font-mono"> → {r.proposed_lat.toFixed(5)}, {r.proposed_lon.toFixed(5)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1" data-testid="ficha-source">
        <div className="flex flex-wrap items-center gap-1">
          {verified
            ? <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" />Fuente verificada</Badge>
            : <Badge variant="destructive" className="gap-1" data-testid="ficha-unverified"><ShieldAlert className="h-3 w-3" />Fuente no verificada</Badge>}
          <a className="underline" href={link.url} target="_blank" rel="noopener noreferrer">Ver expediente en e-SEIA<ExternalLink className="ml-0.5 inline h-3 w-3" /></a>
          <a className="underline" href={d.snapshot.origin_url} target="_blank" rel="noopener noreferrer">Servicio de origen<ExternalLink className="ml-0.5 inline h-3 w-3" /></a>
        </div>
        {link.built && <p className="text-muted-foreground">El enlace al expediente se construye con el ID (el servicio no entrega uno); si no abre, busque el ID {p.external_id} en e-SEIA.</p>}
        <p className="text-muted-foreground">
          {d.source.attribution}. Capturado el {formatDate(d.snapshot.captured_at)}
          {d.snapshot.declared_date ? `; fecha declarada por el servicio: ${formatDate(d.snapshot.declared_date)}` : "; el servicio no declara fecha"}.
          Huella (SHA-256 del contenido): <span className="font-mono">{d.snapshot.sha256.slice(0, 12)}…</span>
        </p>
      </div>

      {Object.keys(d.raw).length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">Otros atributos originales del servicio</summary>
          <table className="mt-1 w-full" data-testid="ficha-raw">
            <tbody>{Object.entries(d.raw).map(([k, v]) => <tr key={k} className="border-t"><td className="p-1 font-mono">{k}</td><td className="p-1 font-mono">{String(v)}</td></tr>)}</tbody>
          </table>
        </details>
      )}
    </div>
  );
};

/** Ficha de un expediente: sus campos tal como los informa el SEA, la calidad de su ubicación y de qué captura salió. */
export const SeiaFichaDialog = ({ selected, onClose }: Props) => {
  const { data, isLoading, error } = useSeiaProject(selected);
  return (
    <Dialog open={selected != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.project.name ?? "Proyecto del SEIA"}</DialogTitle>
          <DialogDescription>Proyecto evaluado en el SEIA · datos como los publica el Servicio de Evaluación Ambiental.</DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-xs">Cargando…</p>}
        {error && <p role="alert" className="text-xs text-destructive">No se pudo leer el proyecto: {(error as Error).message}</p>}
        {!isLoading && !error && selected && data == null && <p role="status" className="text-xs">Este expediente ya no figura en la carga vigente del SEIA.</p>}
        {data && <Body d={data} />}
      </DialogContent>
    </Dialog>
  );
};
