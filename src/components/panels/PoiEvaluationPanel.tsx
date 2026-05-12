// ============================================================================
// PoiEvaluationPanel.tsx
// 
// Panel para que el usuario asigne notas -5 a +10 por dimensión a un POI.
// Calcula el score global ponderado en vivo.
// Permanece estanco visualmente: no muestra ventas reales para evitar sesgo
// del evaluador.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Save } from "lucide-react";

interface Dimension {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  display_order: number;
}

interface Evaluation {
  id?: string;
  dimension_id: string;
  score: number;
  notes?: string;
}

interface Props {
  poiId: string;
  poiName: string;
  /** Si quieres que el panel se muestre como modal/sheet, controla la apertura desde afuera. */
  onSaved?: () => void;
}

export default function PoiEvaluationPanel({ poiId, poiName, onSaved }: Props) {
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);

      setLoading(true);
      const [{ data: dims }, { data: evals }] = await Promise.all([
        supabase
          .from("evaluation_dimensions")
          .select("*")
          .eq("is_active", true)
          .order("display_order"),
        supabase
          .from("poi_evaluations")
          .select("*")
          .eq("poi_id", poiId)
          .eq("evaluator_id", user?.id),
      ]);
      setDimensions(dims ?? []);
      const map: Record<string, Evaluation> = {};
      for (const d of (dims ?? [])) {
        const existing = (evals ?? []).find(e => e.dimension_id === d.id);
        map[d.id] = {
          id: existing?.id,
          dimension_id: d.id,
          score: existing?.score ?? 0,
          notes: existing?.notes ?? "",
        };
      }
      setEvaluations(map);
      setLoading(false);
    })();
  }, [poiId]);

  const weightedScore = useMemo(() => {
    let num = 0, den = 0;
    for (const d of dimensions) {
      const e = evaluations[d.id];
      if (!e) continue;
      num += e.score * d.weight;
      den += d.weight;
    }
    return den > 0 ? num / den : 0;
  }, [dimensions, evaluations]);

  const updateScore = (dimId: string, score: number) => {
    setEvaluations(prev => ({ ...prev, [dimId]: { ...prev[dimId], score } }));
  };

  const updateNotes = (dimId: string, notes: string) => {
    setEvaluations(prev => ({ ...prev, [dimId]: { ...prev[dimId], notes } }));
  };

  const saveAll = async () => {
    if (!userId) { toast.error("Debes iniciar sesión"); return; }
    setSaving(true);
    const rows = dimensions.map(d => ({
      poi_id: poiId,
      dimension_id: d.id,
      score: evaluations[d.id]?.score ?? 0,
      notes: evaluations[d.id]?.notes ?? null,
      evaluator_id: userId,
    }));
    const { error } = await supabase
      .from("poi_evaluations")
      .upsert(rows, { onConflict: "poi_id,dimension_id,evaluator_id" });
    setSaving(false);
    if (error) { toast.error("Error guardando: " + error.message); return; }
    toast.success(`Evaluación guardada (score ponderado ${weightedScore.toFixed(2)})`);
    onSaved?.();
  };

  if (loading) return <div className="p-4 text-muted-foreground">Cargando dimensiones…</div>;

  if (dimensions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p>No hay dimensiones de evaluación configuradas.</p>
          <p className="text-sm mt-2">Un administrador debe crearlas en la sección de admin antes de poder evaluar.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Evaluación cualitativa · {poiName}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Asigna una nota de -5 (problemas serios) a +10 (excepcional) en cada dimensión.
          0 = local promedio. Evita revisar las ventas antes de evaluar.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {dimensions.map(d => {
          const ev = evaluations[d.id];
          return (
            <div key={d.id} className="border-b pb-4 last:border-0">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="font-medium">{d.title}</div>
                  {d.description && (
                    <div className="text-xs text-muted-foreground mt-1">{d.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">Peso: ×{d.weight}</div>
                </div>
                <div className="text-2xl font-mono w-16 text-right">
                  {ev?.score >= 0 ? "+" : ""}{ev?.score ?? 0}
                </div>
              </div>
              <Slider
                min={-5}
                max={10}
                step={1}
                value={[ev?.score ?? 0]}
                onValueChange={v => updateScore(d.id, v[0])}
                className="mt-3"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>-5</span><span>0</span><span>+10</span>
              </div>
              <Textarea
                value={ev?.notes ?? ""}
                onChange={e => updateNotes(d.id, e.target.value)}
                placeholder="Notas opcionales para esta dimensión"
                rows={2}
                className="mt-2 text-xs"
              />
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-4 border-t">
          <div>
            <div className="text-xs text-muted-foreground">Score global ponderado</div>
            <div className="text-3xl font-mono">
              {weightedScore >= 0 ? "+" : ""}{weightedScore.toFixed(2)}
            </div>
          </div>
          <Button onClick={saveAll} disabled={saving}>
            <Save className="mr-2 h-4 w-4" /> {saving ? "Guardando…" : "Guardar evaluación"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
