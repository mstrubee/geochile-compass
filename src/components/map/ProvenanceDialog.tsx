import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LayerProvenanceRow } from "@/types/permits";
import { fmtDate, safeHttpUrl } from "@/utils/projectsScale";

interface Props { title: string; sources: LayerProvenanceRow[]; open: boolean; onClose: () => void; warnings: string[] }

/** Ficha de procedencia de una capa: de dónde sale cada dato, cuándo se capturó, qué período cubre y qué NO dice. */
export const ProvenanceDialog = ({ title, sources, open, onClose, warnings }: Props) => (
  <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Procedencia · {title}</DialogTitle>
        <DialogDescription>Cada dato de esta capa viene de la captura que se detalla abajo. Lo que no se pudo verificar se dice.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm" data-testid="provenance-dialog">
        {sources.length === 0 && <p role="status">No hay una captura publicada de esta fuente.</p>}
        {sources.map((s) => {
          const origin = safeHttpUrl(s.origin_url);
          const landing = safeHttpUrl(s.landing_url);
          return (
            <section key={s.source_key} className="space-y-1 rounded border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{s.name}</b>
                <Badge variant={s.verification_status === "comprobado" ? "secondary" : "destructive"}>
                  {s.verification_status === "comprobado" ? "Estructura verificada" : "Fuente no verificada"}
                </Badge>
                {s.freshness_status === "stale" && <Badge variant="outline" className="border-amber-500 text-amber-700">Sin captura nueva desde el {fmtDate(s.overdue_since)}</Badge>}
                {s.freshness_status === "never_loaded" && <Badge variant="outline">Sin datos cargados</Badge>}
              </div>
              <dl className="grid grid-cols-[10rem_1fr] gap-x-2 gap-y-1">
                <dt className="font-medium">Publicador</dt><dd>{s.publisher}</dd>
                <dt className="font-medium">Página oficial</dt><dd>{landing ? <a className="underline" href={landing} target="_blank" rel="noopener noreferrer">{landing}<ExternalLink className="ml-0.5 inline h-3 w-3" /></a> : "—"}</dd>
                <dt className="font-medium">Servicio consultado</dt><dd className="break-all">{origin ? <a className="underline" href={origin} target="_blank" rel="noopener noreferrer">{origin}</a> : "—"}</dd>
                <dt className="font-medium">Capturado</dt><dd>{fmtDate(s.captured_at) ?? "—"}</dd>
                <dt className="font-medium">Fecha de última edición declarada</dt><dd>{fmtDate(s.declared_date) ?? "el servicio no la declara"}</dd>
                <dt className="font-medium">Período que cubre</dt><dd>{fmtDate(s.period_start) ?? "—"} a {fmtDate(s.period_end) ?? "—"}</dd>
                <dt className="font-medium">Huella (SHA-256)</dt><dd className="break-all font-mono text-xs">{s.sha256 ?? "—"}</dd>
                <dt className="font-medium">Captura (id)</dt><dd className="break-all font-mono text-xs">{s.snapshot_id ?? "—"}</dd>
                <dt className="font-medium">Licencia</dt><dd>{s.license_label ?? "Por confirmar: el servicio no declara licencia"}</dd>
                <dt className="font-medium">Atribución</dt><dd>{s.attribution}</dd>
              </dl>
              {s.scope_note && <p className="text-muted-foreground">{s.scope_note}</p>}
            </section>
          );
        })}
        <section aria-label="Advertencias de uso">
          <p className="mb-1 font-medium">Qué NO dice esta capa</p>
          <ul className="list-disc space-y-1 pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      </div>
    </DialogContent>
  </Dialog>
);
