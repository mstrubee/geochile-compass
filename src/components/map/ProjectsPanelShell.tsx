import { useEffect, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LayerProvenanceRow } from "@/types/permits";
import { fmtDate, safeHttpUrl } from "@/utils/projectsScale";
import { ProvenanceDialog } from "./ProvenanceDialog";

interface ShellProps { title: string; offset: number; testId: string; children: ReactNode }

/** Contenedor flotante de los paneles de la Parte 4 (se apilan hacia la izquierda según `offset`). */
export const ProjectsPanelShell = ({ title, offset, testId, children }: ShellProps) => {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    L.DomEvent.disableClickPropagation(ref.current);
    L.DomEvent.disableScrollPropagation(ref.current);
  }, []);
  return (
    <div
      ref={ref}
      data-testid={testId}
      style={{ right: `calc(0.75rem + ${offset} * 19.25rem)` }}
      className="absolute bottom-8 z-[1000] w-72 max-h-[70vh] overflow-y-auto rounded-lg border bg-background/95 text-foreground shadow-lg backdrop-blur"
    >
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {title}
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
      {open && <div className="space-y-3 px-3 pb-3 text-xs">{children}</div>}
    </div>
  );
};

interface SourceProps {
  title: string;
  sources: LayerProvenanceRow[];
  error: string | null;
  loading: boolean;
  warnings: string[];
}

/** Fuente, estado de verificación, frescura, fechas, licencia y advertencias de uso: SIEMPRE visibles en la leyenda. */
export const SourceBlock = ({ title, sources, error, loading, warnings }: SourceProps) => {
  const [ficha, setFicha] = useState(false);
  const verified = sources.length > 0 && sources.every((s) => s.verification_status === "comprobado");
  const stale = sources.find((s) => s.freshness_status === "stale");
  const never = sources.length > 0 && sources.every((s) => s.freshness_status === "never_loaded");
  const first = sources[0];
  const lastEnd = sources.map((s) => s.period_end).filter(Boolean).sort().at(-1);
  const captured = sources.map((s) => s.captured_at).filter(Boolean).sort().at(-1);
  const landing = safeHttpUrl(first?.landing_url);
  return (
    <div data-testid="projects-source" className="space-y-1 border-t pt-2">
      {error && <p role="alert" className="text-destructive">No se pudo leer la procedencia de los datos: {error}</p>}
      {!error && !loading && sources.length === 0 && <p role="status">Todavía no hay datos cargados para esta capa.</p>}
      {first && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {verified
              ? <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" />Estructura verificada</Badge>
              : <Badge variant="destructive" className="gap-1" data-testid="badge-unverified"><ShieldAlert className="h-3 w-3" />Fuente no verificada</Badge>}
            {stale && <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700" data-testid="badge-stale"><AlertTriangle className="h-3 w-3" />Sin captura nueva desde el {fmtDate(stale.overdue_since)}</Badge>}
            {never && <Badge variant="outline">Sin datos cargados</Badge>}
          </div>
          <p><span className="font-medium">Fuente: </span>
            {landing ? <a className="underline" href={landing} target="_blank" rel="noopener noreferrer">{first.publisher}<ExternalLink className="ml-0.5 inline h-3 w-3" /></a> : first.publisher}
          </p>
          <p><span className="font-medium">Datos hasta: </span>{fmtDate(lastEnd) ?? "—"} · <span className="font-medium">Capturado: </span>{fmtDate(captured) ?? "—"}</p>
          <p><span className="font-medium">Última edición declarada por el origen: </span>{fmtDate(first.declared_date) ?? "no la declara"}</p>
          <p className="text-muted-foreground" data-testid="license-line">{first.attribution} · Licencia: {first.license_label ?? "por confirmar (el servicio no la declara)"}</p>
        </>
      )}
      <ul data-testid="projects-warnings" className="list-disc space-y-0.5 pl-4 text-amber-700 dark:text-amber-400">
        {warnings.map((w) => <li key={w}>{w}</li>)}
      </ul>
      <Button type="button" variant="outline" size="sm" className="h-7 w-full gap-1 text-xs" onClick={() => setFicha(true)}>
        <FileText className="h-3 w-3" />Ver ficha de procedencia
      </Button>
      <ProvenanceDialog title={title} sources={sources} open={ficha} onClose={() => setFicha(false)} warnings={warnings} />
    </div>
  );
};
