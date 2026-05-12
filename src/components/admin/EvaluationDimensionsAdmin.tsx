// ============================================================================
// EvaluationDimensionsAdmin.tsx
// 
// Vista admin para gestionar el catálogo de dimensiones de evaluación.
// Solo accesible para usuarios con role 'admin'.
// ============================================================================
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, GripVertical, Save } from "lucide-react";
import { toast } from "sonner";

interface Dimension {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  display_order: number;
  is_active: boolean;
}

export default function EvaluationDimensionsAdmin() {
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("evaluation_dimensions")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) { toast.error("Error cargando dimensiones"); console.error(error); }
    setDimensions(data ?? []);
    setLoading(false);
    setDirty(new Set());
  };

  useEffect(() => { load(); }, []);

  const markDirty = (id: string) => setDirty(prev => new Set(prev).add(id));

  const update = (id: string, patch: Partial<Dimension>) => {
    setDimensions(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
    markDirty(id);
  };

  const save = async (d: Dimension) => {
    const { error } = await supabase
      .from("evaluation_dimensions")
      .update({
        title: d.title,
        description: d.description,
        weight: d.weight,
        display_order: d.display_order,
        is_active: d.is_active,
      })
      .eq("id", d.id);
    if (error) { toast.error(`Error guardando ${d.title}: ${error.message}`); return; }
    toast.success(`${d.title} guardado`);
    setDirty(prev => {
      const next = new Set(prev);
      next.delete(d.id);
      return next;
    });
  };

  const saveAll = async () => {
    const toSave = dimensions.filter(d => dirty.has(d.id));
    for (const d of toSave) await save(d);
  };

  const addNew = async () => {
    const maxOrder = Math.max(0, ...dimensions.map(d => d.display_order));
    const { data, error } = await supabase
      .from("evaluation_dimensions")
      .insert({
        title: "Nueva dimensión",
        description: "",
        weight: 1.0,
        display_order: maxOrder + 1,
        is_active: true,
      })
      .select()
      .single();
    if (error) { toast.error("Error creando dimensión"); return; }
    setDimensions(prev => [...prev, data]);
    toast.success("Dimensión creada. Edítala y guarda.");
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`¿Eliminar dimensión "${title}"?\n\nLas evaluaciones existentes asociadas también se borrarán.`)) return;
    const { error } = await supabase.from("evaluation_dimensions").delete().eq("id", id);
    if (error) { toast.error("Error eliminando"); return; }
    setDimensions(prev => prev.filter(d => d.id !== id));
    toast.success("Dimensión eliminada");
  };

  const move = (id: string, dir: -1 | 1) => {
    const sorted = [...dimensions].sort((a, b) => a.display_order - b.display_order);
    const idx = sorted.findIndex(d => d.id === id);
    const target = idx + dir;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[idx], b = sorted[target];
    update(a.id, { display_order: b.display_order });
    update(b.id, { display_order: a.display_order });
  };

  if (loading) return <div className="p-4 text-muted-foreground">Cargando…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dimensiones de evaluación</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Estas son las dimensiones cualitativas que los evaluadores asignarán por POI.
            El score global de cada POI se computa como promedio ponderado por <code>weight</code>.
          </p>
        </div>
        <div className="flex gap-2">
          {dirty.size > 0 && (
            <Button onClick={saveAll} variant="default">
              <Save className="mr-2 h-4 w-4" /> Guardar {dirty.size}
            </Button>
          )}
          <Button onClick={addNew} variant="outline">
            <Plus className="mr-2 h-4 w-4" /> Nueva dimensión
          </Button>
        </div>
      </div>

      {dimensions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="mb-4">No hay dimensiones definidas.</p>
            <p className="text-sm mb-4">
              Crea dimensiones como "Visibilidad", "Equipo y gerencia", "Mix de productos", etc.
              Los evaluadores asignarán una nota -5 a +10 en cada una de las dimensiones activas.
            </p>
            <Button onClick={addNew}><Plus className="mr-2 h-4 w-4" /> Crear primera dimensión</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {dimensions
            .sort((a, b) => a.display_order - b.display_order)
            .map((d, idx) => (
              <Card key={d.id} className={dirty.has(d.id) ? "ring-2 ring-amber-300" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button
                        onClick={() => move(d.id, -1)}
                        disabled={idx === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >▲</button>
                      <button
                        onClick={() => move(d.id, 1)}
                        disabled={idx === dimensions.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >▼</button>
                    </div>
                    <Input
                      value={d.title}
                      onChange={e => update(d.id, { title: e.target.value })}
                      className="text-base font-semibold flex-1"
                      placeholder="Título de la dimensión"
                    />
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={d.is_active}
                        onCheckedChange={v => update(d.id, { is_active: v })}
                      />
                      <span className="text-xs text-muted-foreground">
                        {d.is_active ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => remove(d.id, d.title)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Descripción (qué evaluar concretamente)</label>
                    <Textarea
                      value={d.description ?? ""}
                      onChange={e => update(d.id, { description: e.target.value })}
                      placeholder="Ej: Ubicación física, semáforos, estacionamiento, exposición a flujo vehicular"
                      rows={2}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-xs text-muted-foreground">
                      Ponderación
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="10"
                        value={d.weight}
                        onChange={e => update(d.id, { weight: Number(e.target.value) })}
                        className="w-24 mt-1"
                      />
                    </label>
                    <p className="text-xs text-muted-foreground flex-1">
                      Peso relativo en el score global. Suma de pesos no necesita ser 1.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
