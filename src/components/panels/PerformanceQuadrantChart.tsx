// ============================================================================
// PerformanceQuadrantChart.tsx
//
// Scatter de cuadrantes para análisis cruzado:
//   X = residuo del Modelo A (sobre/sub-rendimiento vs entorno territorial+parque)
//   Y = score de gestión (-5 a +10)
//
// Cuadrantes:
//   - Sup-Der: Outperformer explicado por gestión   (replicar best practice)
//   - Sup-Izq: Subrendir pese a buena gestión        (investigar a fondo)
//   - Inf-Der: Outperformer pese a mala gestión     (misterio)
//   - Inf-Izq: Subrendir + mala gestión              (intervenir)
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";

interface Point {
  poi_id: string;
  name: string;
  residual_pct: number;
  score: number;
  ventas_uf: number;
}

interface Props { folderId: string; }

export default function PerformanceQuadrantChart({ folderId }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // 1) POIs de la carpeta
      const { data: pois } = await supabase
        .from("pois").select("id, name").eq("folder_id", folderId);
      const ids = (pois ?? []).map(p => p.id);
      const nameById = new Map((pois ?? []).map(p => [p.id, p.name]));

      // 2) Análisis
      const { data: an } = await supabase
        .from("poi_performance_analysis")
        .select("poi_id, actual_monthly_uf, residual_pct_model_a")
        .in("poi_id", ids);

      // 3) Scores
      const { data: ev } = await supabase
        .from("poi_evaluation_summary")
        .select("poi_id, weighted_score")
        .in("poi_id", ids);
      const scoreById = new Map((ev ?? []).map(e => [e.poi_id, Number(e.weighted_score)]));

      const pts: Point[] = (an ?? [])
        .filter(a => a.residual_pct_model_a != null && scoreById.has(a.poi_id))
        .map(a => ({
          poi_id: a.poi_id,
          name: nameById.get(a.poi_id) ?? "?",
          residual_pct: Number(a.residual_pct_model_a),
          score: scoreById.get(a.poi_id) ?? 0,
          ventas_uf: Number(a.actual_monthly_uf ?? 0),
        }));
      setPoints(pts);
      setLoading(false);
    })();
  }, [folderId]);

  const quadrantSummary = useMemo(() => {
    const s = { sd: 0, si: 0, id: 0, ii: 0 };
    for (const p of points) {
      if (p.residual_pct > 0 && p.score >= 0) s.sd++;
      else if (p.residual_pct < 0 && p.score >= 0) s.si++;
      else if (p.residual_pct > 0 && p.score < 0) s.id++;
      else s.ii++;
    }
    return s;
  }, [points]);

  const colorFor = (p: Point) => {
    if (p.residual_pct > 0 && p.score >= 0) return "#22c55e";   // verde
    if (p.residual_pct < 0 && p.score >= 0) return "#f59e0b";   // ámbar
    if (p.residual_pct > 0 && p.score < 0) return "#a78bfa";    // morado
    return "#ef4444";                                            // rojo
  };

  if (loading) return <div className="text-muted-foreground p-4">Cargando cuadrantes…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cuadrantes · Residuo territorial vs Gestión observada</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          X: cuánto rinde el POI por encima/debajo de lo que el entorno predice (Modelo A).
          Y: nota de gestión que asignaron los evaluadores. Solo se muestran POIs con nota.
        </p>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            No hay POIs con análisis y nota de gestión todavía.
          </div>
        ) : (
          <>
            <div style={{ width: "100%", height: 480 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 20, right: 24, bottom: 40, left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="residual_pct"
                    name="Residuo A %"
                    domain={["dataMin - 5", "dataMax + 5"]}
                    label={{ value: "Residuo Modelo A (%)", position: "insideBottom", offset: -10 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="score"
                    name="Score gestión"
                    domain={[-5, 10]}
                    label={{ value: "Score gestión", angle: -90, position: "insideLeft" }}
                  />
                  <ZAxis dataKey="ventas_uf" range={[60, 300]} name="UF/mes" />
                  <ReferenceLine x={0} stroke="#888" strokeDasharray="5 5" />
                  <ReferenceLine y={0} stroke="#888" strokeDasharray="5 5" />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const p = payload[0].payload as Point;
                      return (
                        <div className="bg-white border rounded p-2 text-xs shadow">
                          <div className="font-semibold">{p.name}</div>
                          <div>Ventas: {Math.round(p.ventas_uf).toLocaleString("es-CL")} UF/mes</div>
                          <div>Residuo A: {p.residual_pct.toFixed(1)}%</div>
                          <div>Score gestión: {p.score >= 0 ? "+" : ""}{p.score.toFixed(2)}</div>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={points}>
                    {points.map(p => (
                      <Cell key={p.poi_id} fill={colorFor(p)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-4 gap-3 mt-4 text-xs">
              <div className="border-l-4 border-l-green-500 pl-3">
                <div className="font-semibold text-green-700">Outperformer explicado por gestión</div>
                <div className="text-muted-foreground">{quadrantSummary.sd} POIs · best practice replicable</div>
              </div>
              <div className="border-l-4 border-l-amber-500 pl-3">
                <div className="font-semibold text-amber-700">Subrendir pese a buena gestión</div>
                <div className="text-muted-foreground">{quadrantSummary.si} POIs · investigar a fondo</div>
              </div>
              <div className="border-l-4 border-l-violet-500 pl-3">
                <div className="font-semibold text-violet-700">Outperformer + gestión baja</div>
                <div className="text-muted-foreground">{quadrantSummary.id} POIs · entender qué falta medir</div>
              </div>
              <div className="border-l-4 border-l-red-500 pl-3">
                <div className="font-semibold text-red-700">Subrendir + gestión baja</div>
                <div className="text-muted-foreground">{quadrantSummary.ii} POIs · candidato a intervenir</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
