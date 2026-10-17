import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermitSeries } from "@/hooks/usePermits";
import type { PermitDestination, PermitMetric, PermitSeriesRow } from "@/types/permits";
import { formatPermitValue, METRIC_LABEL } from "@/utils/permitsScale";

interface Props {
  comuna: { cut: string; name: string } | null;
  metric: PermitMetric;
  destination: PermitDestination;
  onClose: () => void;
}

const fmtDate = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("-") : "—");
const label = (r: PermitSeriesRow) => (r.granularity === "year" ? r.period.slice(0, 4) : r.period.slice(0, 7));

const SeriesTab = ({ cut, granularity, metric, destination }: { cut: string; granularity: "year" | "month"; metric: PermitMetric; destination: PermitDestination }) => {
  const { data, isLoading, error } = usePermitSeries(cut, granularity, metric, destination);
  if (isLoading) return <p className="text-xs">Cargando…</p>;
  if (error) return <p role="alert" className="text-xs text-destructive">No se pudo leer la serie: {(error as Error).message}</p>;
  const rows = data ?? [];
  if (!rows.length) return <p role="status" className="text-xs">No hay datos cargados de esta comuna en esta serie.</p>;
  const first = rows[0];
  const verified = first.verification_status === "comprobado";
  return (
    <div className="space-y-3">
      <div className="h-40" aria-label="Gráfico de la serie">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows.map((r) => ({ p: label(r), v: r.value, prov: r.is_provisional }))}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="p" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={44} />
            <Tooltip formatter={(v: number) => formatPermitValue(v, metric, "value")} />
            <Bar dataKey="v" fill="#3b82f6" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {verified
          ? <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" />Fuente verificada</Badge>
          : <Badge variant="destructive" className="gap-1" data-testid="ficha-unverified"><ShieldAlert className="h-3 w-3" />Fuente no verificada</Badge>}
        <a className="underline" href={first.landing_url} target="_blank" rel="noopener noreferrer">Página de la fuente<ExternalLink className="ml-0.5 inline h-3 w-3" /></a>
        <a className="underline" href={first.first_origin_url} target="_blank" rel="noopener noreferrer">Archivo de origen<ExternalLink className="ml-0.5 inline h-3 w-3" /></a>
      </div>
      <p className="text-xs text-muted-foreground">
        Serie declarada: «{first.destination_declared}» / «{first.work_type_declared}» · hoja {first.source_sheet ?? "—"} ·
        último archivo cargado: capturado {fmtDate(first.latest_captured_at)}, hasta {fmtDate(first.latest_period_end)}.
      </p>
      <div className="max-h-56 overflow-auto rounded border">
        <table className="w-full text-xs" data-testid="ficha-table">
          <thead className="sticky top-0 bg-muted text-left">
            <tr><th className="p-1">Período</th><th className="p-1 text-right">Valor</th><th className="p-1">Estado</th><th className="p-1">Celda</th><th className="p-1">Capturado</th></tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.period} className="border-t">
                <td className="p-1">{label(r)}</td>
                <td className="p-1 text-right tabular-nums">{formatPermitValue(r.value, metric, "value")}</td>
                <td className="p-1">{r.is_provisional ? <Badge variant="outline" className="border-amber-500 text-amber-700" title={r.quality_note ?? undefined}>Preliminar</Badge> : "Definitivo"}</td>
                <td className="p-1 font-mono">{r.cell_ref ?? "—"}</td>
                <td className="p-1">{fmtDate(r.first_captured_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">«Celda» = dónde nació el valor en el archivo original; «Capturado» = cuándo se bajó por primera vez ese valor.</p>
    </div>
  );
};

/** Ficha de una comuna: serie anual/mensual y la procedencia de CADA valor. */
export const PermitsFichaDialog = ({ comuna, metric, destination, onClose }: Props) => {
  const [tab, setTab] = useState<"year" | "month">("year");
  return (
    <Dialog open={comuna != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{comuna?.name} · Permisos de edificación</DialogTitle>
          <DialogDescription>{METRIC_LABEL[metric]} · CUT {comuna?.cut}. Fuente: MINVU CEDOC (datos como los publica el origen).</DialogDescription>
        </DialogHeader>
        {comuna && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "year" | "month")}>
            <TabsList>
              <TabsTrigger value="year">Anual</TabsTrigger>
              <TabsTrigger value="month">Mensual</TabsTrigger>
            </TabsList>
            <TabsContent value="year"><SeriesTab cut={comuna.cut} granularity="year" metric={metric} destination={destination} /></TabsContent>
            <TabsContent value="month"><SeriesTab cut={comuna.cut} granularity="month" metric={metric} destination={destination} /></TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};
