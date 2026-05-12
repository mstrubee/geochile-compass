// ============================================================================
// PerformanceComparisonPanel.tsx
//
// Vista lado a lado: Modelo A (sin nota) vs Modelo B (con nota de gestión).
// Siempre muestra los dos con sus residuos y la interpretación auto-generada.
// ============================================================================
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Analysis {
  poi_id: string;
  actual_monthly_uf: number;
  predicted_monthly_uf_model_a: number | null;
  residual_uf_model_a: number | null;
  residual_pct_model_a: number | null;
  predicted_monthly_uf_model_b: number | null;
  residual_uf_model_b: number | null;
  residual_pct_model_b: number | null;
  model_a_r2: number | null;
  model_b_r2: number | null;
  model_b_n_evaluated: number | null;
  interpretation: string | null;
}

interface Props {
  poiId: string;
  poiName: string;
  managementScore: number | null;
}

const fmtUf = (v: number | null | undefined) =>
  v == null ? "—" : Math.round(v).toLocaleString("es-CL");

const fmtPct = (v: number | null | undefined) => {
  if (v == null) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
};

const pctColor = (v: number | null | undefined) => {
  if (v == null) return "text-muted-foreground";
  if (v > 15) return "text-green-600";
  if (v < -15) return "text-red-600";
  return "text-foreground";
};

export default function PerformanceComparisonPanel({ poiId, poiName, managementScore }: Props) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("poi_performance_analysis")
        .select("*")
        .eq("poi_id", poiId)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) setAnalysis(data as Analysis);
      setLoading(false);
    })();
  }, [poiId]);

  if (loading) return <div className="text-sm text-muted-foreground p-4">Cargando análisis…</div>;
  if (!analysis) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Aún no se ha calculado el análisis para este POI. Corre "Recalcular performance" desde la carpeta.
        </CardContent>
      </Card>
    );
  }

  const hasModelB = analysis.predicted_monthly_uf_model_b != null;

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle>Performance · {poiName}</CardTitle>
        <div className="text-sm text-muted-foreground mt-1">
          Ventas reales (UF/mes promedio): <span className="font-mono font-medium">{fmtUf(analysis.actual_monthly_uf)}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          Score gestión:{" "}
          {managementScore != null ? (
            <Badge variant="outline" className="font-mono">
              {managementScore >= 0 ? "+" : ""}{managementScore.toFixed(2)}
            </Badge>
          ) : (
            <span className="text-amber-600">sin evaluar</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Modelo A */}
          <div className="border rounded-lg p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-3">
              Modelo A · Sin nota
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              Predicción basada en entorno territorial + parque automotor.
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Predicción</span>
                <span className="font-mono">{fmtUf(analysis.predicted_monthly_uf_model_a)} UF</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Residuo</span>
                <span className="font-mono">{fmtUf(analysis.residual_uf_model_a)} UF</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>%</span>
                <span className={`font-mono ${pctColor(analysis.residual_pct_model_a)}`}>
                  {fmtPct(analysis.residual_pct_model_a)}
                </span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-3 pt-2 border-t">
              R² del modelo (chain): {analysis.model_a_r2 != null ? `${(analysis.model_a_r2 * 100).toFixed(1)}%` : "—"}
            </div>
          </div>

          {/* Modelo B */}
          <div className={`border rounded-lg p-4 ${hasModelB ? "" : "opacity-60"}`}>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-3">
              Modelo B · Con nota
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              Predicción incorporando la nota cualitativa de gestión.
            </div>
            {hasModelB ? (
              <>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Predicción</span>
                    <span className="font-mono">{fmtUf(analysis.predicted_monthly_uf_model_b)} UF</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Residuo</span>
                    <span className="font-mono">{fmtUf(analysis.residual_uf_model_b)} UF</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>%</span>
                    <span className={`font-mono ${pctColor(analysis.residual_pct_model_b)}`}>
                      {fmtPct(analysis.residual_pct_model_b)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-3 pt-2 border-t">
                  R² del modelo (chain): {analysis.model_b_r2 != null ? `${(analysis.model_b_r2 * 100).toFixed(1)}%` : "—"}
                  {analysis.model_b_n_evaluated != null && (
                    <> · n={analysis.model_b_n_evaluated} POIs evaluados</>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                Modelo B requiere al menos 15 POIs con nota de gestión.
                Actualmente: {analysis.model_b_n_evaluated ?? 0}.
              </div>
            )}
          </div>
        </div>

        {analysis.interpretation && (
          <div className="bg-muted/50 border rounded-lg p-3 text-sm">
            <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">
              Interpretación automática
            </div>
            {analysis.interpretation}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
