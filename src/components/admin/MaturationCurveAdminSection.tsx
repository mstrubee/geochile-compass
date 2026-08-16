import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Save, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchMaturationCurve,
  saveCustomRamp,
  type MaturationCurve,
} from "@/services/maturationCurveService";

interface Folder { id: string; name: string }

/**
 * Curva de maduración por carpeta.
 *
 * Cada valor es la fracción del nivel EN RÉGIMEN que alcanza el local en ese
 * año de vida. La proyección de venta parte en el primero y sube hasta el
 * 100%: sin esto arrancaría ya en régimen y sobrestimaría el año de apertura.
 *
 * Se deriva de los locales con apertura observada, pero el admin puede fijarla
 * cuando conoce el negocio mejor que la muestra disponible.
 */
export const MaturationCurveAdminSection = () => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [curve, setCurve] = useState<MaturationCurve | null>(null);
  const [draft, setDraft] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("poi_folders")
        .select("id, name")
        .is("deleted_at", null)
        .order("name");
      const list = (data ?? []) as Folder[];
      setFolders(list);
      if (list.length > 0) setFolderId((prev) => prev || list[0].id);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!folderId) return;
    setLoading(true);
    try {
      const c = await fetchMaturationCurve(folderId);
      setCurve(c);
      setDraft(c.rampFactors.map((f) => Math.round(f * 1000) / 10));
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => { void load(); }, [load]);

  const setYear = (i: number, pct: number) =>
    setDraft((prev) => prev.map((v, j) => (j === i ? pct : v)));

  const handleSave = async () => {
    if (!folderId) return;
    // El último año define el régimen: si no es 100%, el resto de la curva
    // deja de ser "fracción del régimen" y los números pierden sentido.
    const ramp = draft.map((p) => p / 100);
    ramp[ramp.length - 1] = 1;
    setSaving(true);
    try {
      await saveCustomRamp(folderId, ramp);
      toast.success("Curva guardada");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!folderId) return;
    setSaving(true);
    try {
      await saveCustomRamp(folderId, null);
      toast.success("Vuelve a derivarse de los locales");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo restablecer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="h-8 rounded-md border border-border/50 bg-surface-2 px-2 text-xs"
        >
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {curve && !loading && (
          <span className="text-[11px] text-muted-foreground">
            {curve.isCustom
              ? "Fijada por admin"
              : curve.isFallback
                ? "Valores de respaldo — no hay aperturas observadas suficientes"
                : `Derivada de ${curve.sampleSize} locales con apertura observada`}
          </span>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Fracción del nivel <strong>en régimen</strong> que alcanza un local en cada
        año de vida. La proyección de venta parte en el primer valor y sube hasta
        el 100%. El último año es el régimen por definición, así que se guarda
        siempre como 100%.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        {draft.map((pct, i) => (
          <div key={i} className="w-24">
            <div className="mb-1 text-[10px] text-muted-foreground">
              {i === 0 ? "Apertura" : `Año ${i + 1}`}
              {i === draft.length - 1 ? " · régimen" : ""}
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={1}
                max={200}
                step={1}
                value={pct}
                disabled={i === draft.length - 1}
                onChange={(e) => setYear(i, Math.max(1, Math.min(200, parseFloat(e.target.value) || 1)))}
                className="h-8 text-right text-xs font-mono"
              />
              <span className="text-[11px] text-muted-foreground">%</span>
            </div>
          </div>
        ))}

        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            title="Agregar un año antes del régimen"
            onClick={() =>
              setDraft((prev) => {
                const next = [...prev];
                next.splice(Math.max(0, next.length - 1), 0, 80);
                return next;
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={draft.length <= 2}
            title="Quitar un año"
            onClick={() => setDraft((prev) => prev.filter((_, i) => i !== prev.length - 2))}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !folderId}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Guardar curva
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleReset}
          disabled={saving || !curve?.isCustom}
          title="Volver a derivarla de los locales de la red"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Volver a la derivada
        </Button>
      </div>
    </div>
  );
};
