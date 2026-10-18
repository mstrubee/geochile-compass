import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { HealthSummaryRow, HealthTipoRow } from "@/types/health";
import { ALTA_LABEL, CLASE_LABEL, fmtN, GEO_STATUS_LABEL, LEVEL_SEAL, summaryN, WARN } from "@/utils/healthScale";
import type { HealthGeoStatus } from "@/types/health";

interface Props { open: boolean; onClose: () => void; summary: HealthSummaryRow[] | undefined; tipos: HealthTipoRow[] | undefined; tiposError: string | null; summaryError: string | null }

/**
 * Ficha de la capa de establecimientos: definiciones (D1 y D2), cifras de la captura vigente, y la TABLA de clasificación ambulatorio/hospitalario
 * (decisión de diseño que activa la advertencia de la regla 3). La procedencia de la fuente está en el bloque «Fuente» del panel.
 */
export const HealthFichaDialog = ({ open, onClose, summary, tipos, tiposError, summaryError }: Props) => {
  const geo = (summary ?? []).filter((r) => r.dimension === "geo_status").sort((a, b) => Number(a.value) - Number(b.value));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Establecimientos de salud · definiciones y clasificación</DialogTitle>
          <DialogDescription>Registro oficial del DEIS/MINSAL. {LEVEL_SEAL.level} · Sello: {LEVEL_SEAL.seal}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm" data-testid="health-ficha">
          <section aria-label="Definiciones" className="space-y-1">
            <p className="font-medium">Definiciones (decididas por el dueño del proyecto)</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>{ALTA_LABEL.hospital}</b> (por defecto): complejidad «Alta» y tipo «Hospital».</li>
              <li><b>{ALTA_LABEL.ampliada}</b>: lo anterior más las Clínicas y los Centros de Especialidades de complejidad «Alta». Los registros de alta complejidad de tipo «Otro» o «SAMU» no entran en ninguna de las dos y se cuentan aparte.</li>
              <li><b>Privado</b> = dependencia administrativa «Privado». {WARN.privateDef}</li>
            </ul>
          </section>
          <section aria-label="Cifras" className="space-y-1">
            <p className="font-medium">Cifras de la captura vigente</p>
            {summaryError && <p role="alert" className="text-destructive">No se pudo leer el resumen: {summaryError}</p>}
            {!summaryError && !summary && <p role="status">Cargando…</p>}
            {summary && (
              <ul className="list-disc space-y-0.5 pl-5" data-testid="health-ficha-summary">
                <li>Registros: {fmtN(summaryN(summary, "total"))} ({fmtN(summaryN(summary, "estado", "vigente"))} vigentes, {fmtN(summaryN(summary, "estado", "cerrado"))} cerrados; {fmtN(summaryN(summary, "cerrado_sin_fecha_cierre"))} cerrados sin fecha de cierre).</li>
                <li>Alta complejidad vigente: {fmtN(summaryN(summary, "alta_hospital_vigentes"))} hospitales · {fmtN(summaryN(summary, "alta_ampliada_vigentes"))} en la definición ampliada · {fmtN(summaryN(summary, "alta_fuera_de_ambas_vigentes"))} fuera de ambas.</li>
                <li>Clase de los vigentes: {fmtN(summaryN(summary, "clase_fuente", "oficial"))} declarada por la fuente · {fmtN(summaryN(summary, "clase_fuente", "tabla"))} imputada por la tabla · {fmtN(summaryN(summary, "clase_fuente", "sin_clasificar"))} sin clasificar.</li>
                {geo.length > 0 && <li>Ubicación de los vigentes: {geo.map((g) => `${GEO_STATUS_LABEL[Number(g.value) as HealthGeoStatus] ?? g.value}: ${fmtN(g.n)}`).join(" · ")}.</li>}
              </ul>
            )}
          </section>
          <section aria-label="Clasificación por tipo" className="space-y-1">
            <p className="font-medium">Clase ambulatorio / hospitalario por tipo de establecimiento</p>
            <p className="text-muted-foreground">Manda siempre lo que declara la fuente; esta tabla solo completa las filas que no lo declaran. Es una decisión de diseño (editable), no un dato oficial.</p>
            {tiposError && <p role="alert" className="text-destructive">No se pudo leer la tabla de clasificación: {tiposError}</p>}
            {!tiposError && !tipos && <p role="status">Cargando…</p>}
            {tipos && (
              <table className="w-full text-xs" data-testid="health-tipos">
                <thead><tr className="text-left"><th className="pr-2">Tipo</th><th className="pr-2">Clase</th><th>Evidencia del registro</th></tr></thead>
                <tbody>
                  {tipos.map((t) => (
                    <tr key={t.tipo_norm} className="align-top border-t">
                      <td className="pr-2">{t.tipo_label}</td>
                      <td className="pr-2">{t.clase === "mixto" ? "Mixto (no se imputa)" : CLASE_LABEL[t.clase]}</td>
                      <td className="text-muted-foreground">{t.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section aria-label="Qué NO dice esta capa" className="space-y-1">
            <p className="font-medium">Qué NO dice esta capa</p>
            <ul className="list-disc space-y-1 pl-5"><li>{WARN.registry}</li><li>{WARN.counting}</li><li data-testid="health-ficha-heterogeneity">{WARN.heterogeneity}</li><li>{WARN.altaDefs}</li><li>{WARN.zeroTrue}</li></ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
