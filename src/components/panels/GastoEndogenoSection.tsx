/**
 * GastoEndogenoSection.tsx
 * ========================
 * Sección del Analysis Panel que muestra el Gasto Potencial Mensual Endógeno
 * de hogares en Autoplanet para el área de la isócrona seleccionada.
 */

import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import {
  calcGastoEndogeno,
  fmtCLPMillones,
  fmtCLPK,
  GSE_COLORS,
  GSE_TARGET,
} from "@/utils/gastoEndogeno";
import type { GseClass } from "@/types/gse";

const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));

interface Props {
  analysis: IsochroneAnalysis;
}

export const GastoEndogenoSection = ({ analysis }: Props) => {
  const result = calcGastoEndogeno(analysis);

  const targetRows = result.rows.filter(r => r.esObjetivo && r.hogares > 0);
  const hasData    = result.totalHogaresObjetivo > 0;

  return (
    <div className="space-y-3">

      {/* KPIs principales */}
      <div className="grid grid-cols-2 gap-2">
        <KPICard
          label="Gasto mensual objetivo"
          value={fmtCLPMillones(result.gastoMensualObjetivo)}
          sub="ABC1 + C2 + C3 + D"
          highlight
        />
        <KPICard
          label="Hogares objetivo"
          value={fmt(result.totalHogaresObjetivo)}
          sub={`de ${fmt(result.totalHogaresTotales)} totales`}
        />
        <KPICard
          label="Gasto prom. por hogar"
          value={fmtCLPK(result.gastoPromPorHogar)}
          sub="CLP / mes"
        />
        <KPICard
          label="Fuente datos"
          value={result.source === "gse" ? "Manzanas GSE" : result.source === "nse_fallback" ? "NSE estimado" : "Sin datos"}
          sub={result.source === "gse" ? "Censo 2024" : "Approx. comunal"}
        />
      </div>

      {/* Barra de distribución visual */}
      {hasData && (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Distribución del gasto por GSE
          </div>
          <div className="flex h-5 w-full overflow-hidden rounded-md">
            {result.rows
              .filter(r => r.esObjetivo && r.gastoMensual > 0)
              .map(r => (
                <div
                  key={r.gse}
                  title={`${r.gse}: ${fmtCLPMillones(r.gastoMensual)} (${r.pctDelTotal.toFixed(1)}%)`}
                  style={{
                    width: `${r.pctDelTotal}%`,
                    background: GSE_COLORS[r.gse as GseClass] ?? "#888",
                    transition: "width 0.3s",
                  }}
                />
              ))}
          </div>
        </div>
      )}

      {/* Tabla detallada por GSE */}
      {hasData && (
        <div className="rounded-xl overflow-hidden border border-white/8">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-surface-2/60">
                <th className="py-1.5 px-3 text-left text-[10px] text-muted-foreground font-medium">GSE</th>
                <th className="py-1.5 px-2 text-right text-[10px] text-muted-foreground font-medium">Hogares</th>
                <th className="py-1.5 px-2 text-right text-[10px] text-muted-foreground font-medium">$/hogar/mes</th>
                <th className="py-1.5 px-2 text-right text-[10px] text-muted-foreground font-medium">Total/mes</th>
                <th className="py-1.5 px-2 text-right text-[10px] text-muted-foreground font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {targetRows.map((r, i) => (
                <tr
                  key={r.gse}
                  className={i % 2 === 0 ? "bg-surface-1/30" : "bg-surface-2/20"}
                >
                  <td className="py-1.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                        style={{ background: GSE_COLORS[r.gse as GseClass] ?? "#888" }}
                      />
                      <span className="font-semibold">{r.gse}</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmt(r.hogares)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {fmtCLPK(r.coeficiente)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                    {fmtCLPMillones(r.gastoMensual)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {r.pctDelTotal.toFixed(1)}%
                  </td>
                </tr>
              ))}
              {/* Fila total */}
              <tr className="border-t border-white/10 bg-surface-2/50 font-bold">
                <td className="py-2 px-3 text-xs">Total objetivo</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(result.totalHogaresObjetivo)}</td>
                <td className="py-2 px-2 text-right text-muted-foreground text-[10px]">prom. {fmtCLPK(result.gastoPromPorHogar)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-green-400">
                  {fmtCLPMillones(result.gastoMensualObjetivo)}
                </td>
                <td className="py-2 px-2 text-right">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!hasData && (
        <div className="rounded-lg border border-dashed border-white/15 p-3 text-center text-[11px] text-muted-foreground">
          Sin datos de hogares para esta área.<br />
          Activa la capa <strong>GSE por manzana</strong> para enriquecer el análisis.
        </div>
      )}

      {/* Nota metodológica */}
      <div className="rounded-md bg-surface-2/30 px-2.5 py-1.5 text-[9px] leading-relaxed text-muted-foreground/70">
        <strong className="text-muted-foreground">Metodología:</strong> EPF INE 2021-2022 actualizado.
        Gasto mensual declarado en productos y servicios automotrices (canasta Autoplanet)
        por hogares de los grupos ABC1, C2, C3 y D. Mercado objetivo excluye grupo E.
        Coef. ABC1 $49.237 · C2 $25.057 · C3 $12.732 · D $4.117 / hogar / mes.
      </div>
    </div>
  );
};

// ── Sub-componentes ───────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, highlight = false,
}: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={[
      "rounded-xl p-3",
      highlight
        ? "bg-gradient-to-br from-green-900/30 to-emerald-900/20 border border-green-500/20"
        : "bg-surface-2/40",
    ].join(" ")}>
      <div className={["text-xs font-bold tabular-nums", highlight ? "text-green-400" : "text-foreground"].join(" ")}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-[9px] text-muted-foreground/60">{sub}</div>}
    </div>
  );
}
