import { AlertTriangle, Loader2 } from "lucide-react";
import type { ImportMode, ImportPreview } from "@/services/layerImport";
import { sizeMessage } from "@/utils/importWizard";
import { cn } from "@/lib/utils";

interface Props {
  mode: ImportMode;
  local: { folders: number; layers: number; features: number } | null;
  preview: ImportPreview | null;
  previewing: boolean;
  rowsToWrite: number;
  maxRows: number | null;
  /** Falta elegir la capa a actualizar. */
  needsTarget: boolean;
}

const n = (v: number) => v.toLocaleString("es-CL");

const Stat = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <div className="rounded-lg border border-border/60 px-2 py-1.5">
    <div className={cn("font-mono text-[15px] font-semibold leading-none", tone)}>{n(value)}</div>
    <div className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
  </div>
);

const CHANGE_LABEL: Record<string, string> = { name: "nombre", location: "ubicación", attributes: "atributos", external_id: "id" };

const Sample = ({ title, names }: { title: string; names: (string | null)[] }) =>
  names.length ? (
    <details className="text-[11px]">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {title} (primeras {names.length})
      </summary>
      <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-5 text-text-muted">
        {names.map((x, i) => (
          <li key={i}>{x || "(sin nombre)"}</li>
        ))}
      </ul>
    </details>
  ) : null;

/** Qué va a pasar: en una importación nueva, cuántas carpetas/capas/puntos; al actualizar, el diff. */
export const ImportDiffPanel = ({ mode, local, preview, previewing, rowsToWrite, maxRows, needsTarget }: Props) => {
  const tooBig = maxRows != null ? sizeMessage(rowsToWrite, maxRows) : null;

  if (mode === "new") {
    return (
      <div className="space-y-2 text-[12px]">
        {local && local.layers > 0 ? (
          <p>
            Se crearán <b>{n(local.folders)}</b> {local.folders === 1 ? "carpeta" : "carpetas"}, <b>{n(local.layers)}</b> {local.layers === 1 ? "capa" : "capas"} y{" "}
            <b>{n(local.features)}</b> puntos.
          </p>
        ) : (
          <p className="text-muted-foreground">No hay nada incluido: marca al menos una capa del archivo.</p>
        )}
        {tooBig && <Warning>{tooBig}</Warning>}
      </div>
    );
  }

  if (needsTarget) return <p className="text-[12px] text-muted-foreground">Elige la capa que quieres {mode === "replace" ? "reemplazar" : "actualizar"} para ver las diferencias.</p>;
  if (previewing && !preview) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando diferencias…
      </p>
    );
  }
  const d = preview?.diff;
  if (!d || !preview) return null;

  return (
    <div className={cn("space-y-2", previewing && "opacity-60")}>
      <p className="text-[12px] text-muted-foreground">
        Capa <b className="text-foreground">{preview.target?.name}</b> · hoy {n(preview.target?.feature_count ?? 0)} puntos
      </p>
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Agregadas" value={d.added} tone="text-emerald-400" />
        <Stat label={mode === "replace" ? "Eliminadas" : "Se conservan"} value={mode === "replace" ? d.removed : d.kept} tone={mode === "replace" ? "text-red-400" : "text-muted-foreground"} />
        <Stat label="Modificadas" value={d.modified} tone="text-amber-400" />
        <Stat label="Sin cambio" value={d.unchanged} tone="text-muted-foreground" />
      </div>
      <p className="text-[11px] text-text-muted">
        Se emparejan por id ({n(d.matched_by_external_id)}) y, cuando no hay id, por ubicación y nombre ({n(d.matched_by_coords)}). Solo se escribe lo que cambia:{" "}
        <b>{n(d.rows_to_write)}</b> puntos.
      </p>
      {mode === "replace" && d.removed > 0 && (
        <Warning>
          Se eliminarán {n(d.removed)} puntos que ya no vienen en el archivo. Puedes deshacerlo justo después de importar.
        </Warning>
      )}
      {tooBig && <Warning>{tooBig}</Warning>}
      <div className="space-y-1">
        <Sample title="Agregadas" names={d.samples.added} />
        <Sample title={mode === "replace" ? "Eliminadas" : "Se conservan"} names={d.samples.removed} />
        {d.samples.modified.length > 0 && (
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Modificadas (primeras {d.samples.modified.length})</summary>
            <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-5 text-text-muted">
              {d.samples.modified.map((m, i) => (
                <li key={i}>
                  {m.name || "(sin nombre)"} — cambió {(m.changed ?? []).map((c) => CHANGE_LABEL[c] ?? c).join(", ")}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
};

const Warning = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
    <span>{children}</span>
  </p>
);
