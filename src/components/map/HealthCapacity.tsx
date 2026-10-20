import { useHealthCapacity } from "@/hooks/useHealth";
import type { HealthCapacity as Capacity, HealthCapacityOccupancy, HealthCapacitySource } from "@/types/health";
import { CAP_TEXT, dateLabel, fmtCount, fmtPct, indexText, monthLabel, notReadyFields, NO_DATA, showPublicOnlyNote, yearLabel } from "@/utils/healthCapacity";

const Source = ({ label, s }: { label: string; s: HealthCapacitySource | null }) =>
  s ? (
    <li data-testid={`cap-source-${label}`}>
      <b>{s.name}</b>. Licencia: {s.license_label ?? NO_DATA}. Archivo del {dateLabel(s.declared_date)}{s.declared_date_note ? ` (${s.declared_date_note})` : ""}; descargado el {dateLabel(s.captured_at)};
      período {dateLabel(s.period_start)} a {dateLabel(s.period_end)}. SHA-256 {s.sha256.slice(0, 12)}…. <span className="break-all">{s.origin_url}</span>
    </li>
  ) : null;

const Occupancy = ({ testId, title, o }: { testId: string; title: string; o: HealthCapacityOccupancy | null }) => (
  <div data-testid={testId}>
    <p><span className="font-medium">{title}: </span>{o ? indexText(o) : NO_DATA}</p>
    {o && (
      <p className="text-muted-foreground">
        {fmtCount(o.ocupados)} días-cama ocupados de {fmtCount(o.disponibles)} disponibles · {CAP_TEXT.avgNote}.{o.indice != null && o.indice > 100 ? ` ${CAP_TEXT.over100}` : ""}
      </p>
    )}
  </div>
);

/** Cuerpo puro (sin red): lo usan el popup y las pruebas. */
export const HealthCapacityBody = ({ cap }: { cap: Capacity }) => {
  const { dotacion: dot, ocupacion_anual: ano, ocupacion_mes: mes } = cap;
  const areas = ano?.areas ?? [];
  const notReady = notReadyFields(cap);
  return (
    <div className="mt-1 space-y-1 border-t pt-1" data-testid="health-capacity">
      <p className="font-medium">Capacidad (DEIS)</p>
      <div data-testid="cap-dotacion">
        <p><span className="font-medium">Camas de dotación: </span>{dot && dot.total != null ? `${fmtCount(dot.total)} (${dot.year})` : NO_DATA}</p>
        {dot && dot.total == null && <p className="text-muted-foreground">El archivo no trae la fila «Total» de {dot.year} para este establecimiento.</p>}
      </div>
      <Occupancy testId="cap-ocupacion-anual" title={ano ? `Ocupación ${yearLabel(ano)}` : "Ocupación del último año completo"} o={ano} />
      <Occupancy testId="cap-ocupacion-mes" title={`Último mes publicado${mes?.period ? ` (${monthLabel(mes.period)})` : ""}`} o={mes} />
      {showPublicOnlyNote(cap) && <p className="text-amber-700 dark:text-amber-400" data-testid="cap-no-snss-note">{CAP_TEXT.publicOnly}</p>}
      {(dot?.areas.length ?? 0) > 0 || areas.length > 0 ? (
        <details data-testid="cap-areas">
          <summary className="cursor-pointer">Desglose por área funcional</summary>
          <p className="text-muted-foreground">{CAP_TEXT.areasNote}</p>
          {dot && dot.areas.length > 0 && (
            <>
              <p className="mt-1 font-medium">Camas de dotación {dot.year}</p>
              <ul className="list-disc pl-4">{dot.areas.map((a) => <li key={a.area}>{a.nombre}: {fmtCount(a.camas)}</li>)}</ul>
              <p className="text-muted-foreground">{CAP_TEXT.totalNote}</p>
            </>
          )}
          {areas.length > 0 && ano && (
            <>
              <p className="mt-1 font-medium">Ocupación {yearLabel(ano)}</p>
              <ul className="list-disc pl-4">{areas.map((a) => <li key={a.area}>{a.nombre}: {indexText(a)} ({fmtCount(a.ocupados)} / {fmtCount(a.disponibles)})</li>)}</ul>
            </>
          )}
        </details>
      ) : null}
      <details data-testid="cap-sources">
        <summary className="cursor-pointer">Fuentes y definiciones</summary>
        <ul className="list-disc space-y-1 pl-4">
          <Source label="dotacion" s={cap.fuentes.dotacion} />
          <Source label="rem20" s={cap.fuentes.rem20} />
        </ul>
        {!cap.fuentes.dotacion && !cap.fuentes.rem20 && <p>Todavía no hay una captura publicada de las fuentes de capacidad.</p>}
        <p className="mt-1">{CAP_TEXT.dotacionDef}</p>
        <p>{CAP_TEXT.formula}</p>
      </details>
      {notReady.length > 0 && (
        <p className="text-muted-foreground" data-testid="cap-client-ready">
          No apto para informes a clientes (client_ready = false): {notReady.map((n) => `${CAP_TEXT.fieldLabel[n.field]}${n.note ? ` — ${n.note}` : ""}`).join(" · ")}
        </p>
      )}
    </div>
  );
};

/** Sección «Capacidad» del popup de un hospital: se pide al abrirlo. Un error se MUESTRA (no se disfraza de «sin dato»). */
export const HealthCapacity = ({ code }: { code: string }) => {
  const q = useHealthCapacity(code);
  if (q.isLoading) return <p className="mt-1 border-t pt-1 text-muted-foreground" role="status" data-testid="cap-loading">Cargando capacidad…</p>;
  if (q.error) return <p className="mt-1 border-t pt-1 text-destructive" role="alert" data-testid="cap-error">No se pudo leer la capacidad: {(q.error as Error).message}</p>;
  if (!q.data) return <p className="mt-1 border-t pt-1" data-testid="health-capacity">Capacidad (DEIS): {NO_DATA}.</p>;
  return <HealthCapacityBody cap={q.data} />;
};
