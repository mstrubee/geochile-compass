import { useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/utils/clipboard";
import type { ImportErrorReport } from "@/utils/importErrorReport";

/**
 * Un fallo del importador, sin rodeos: qué paso falló, la causa y cómo corregirlo, más un botón que
 * copia un mensaje completo para pegarlo en el chat. Si el navegador no deja copiar, muestra el texto
 * para copiarlo a mano (nunca queda el fallo sin salida).
 */
export const ImportErrorPanel = ({ report }: { report: ImportErrorReport }) => {
  const [copied, setCopied] = useState<"idle" | "ok" | "manual">("idle");

  const copy = async () => setCopied((await copyText(report.text)) ? "ok" : "manual");

  return (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[12px]">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-destructive">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        {report.title}
      </p>
      <p>
        <b>Causa:</b> {report.cause}
      </p>
      <p>
        <b>Cómo corregirlo:</b> {report.solution}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          {copied === "ok" ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
          {copied === "ok" ? "Copiado: pégalo en el chat" : "Copiar mensaje para el chat"}
        </Button>
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Detalle técnico</summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-[10px]">
            {report.raw}
            {report.code ? `\n(código ${report.code})` : ""}
          </pre>
        </details>
      </div>
      {copied === "manual" && (
        <div className="space-y-1">
          <p className="text-[11px] text-amber-300">El navegador no dejó copiar automáticamente. Selecciona este texto, cópialo y pégalo en el chat:</p>
          <textarea
            readOnly
            aria-label="Mensaje para copiar"
            value={report.text}
            onFocus={(e) => e.currentTarget.select()}
            className="h-32 w-full rounded border border-border bg-background p-2 font-mono text-[10px]"
          />
        </div>
      )}
    </div>
  );
};
