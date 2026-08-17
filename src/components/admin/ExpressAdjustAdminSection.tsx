import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_EXPRESS_ADJUST_PCT,
  fetchExpressAdjustPct,
  saveExpressAdjustPct,
} from "@/services/commercialSettingsService";

interface Folder { id: string; name: string }

/**
 * Castigo del formato Express.
 *
 * El botón "Local Express" de la proyección de venta fija el ajuste manual en
 * este valor. Es un parámetro de negocio, no un resultado del modelo: la
 * superficie del local todavía no es una variable, así que el menor tamaño se
 * corrige por fuera.
 */
export const ExpressAdjustAdminSection = () => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [saved, setSaved] = useState<number>(DEFAULT_EXPRESS_ADJUST_PCT);
  const [draft, setDraft] = useState<number>(DEFAULT_EXPRESS_ADJUST_PCT);
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
      const pct = await fetchExpressAdjustPct(folderId);
      setSaved(pct);
      setDraft(pct);
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => { void load(); }, [load]);

  const persist = async (pct: number | null) => {
    if (!folderId) return;
    setSaving(true);
    try {
      await saveExpressAdjustPct(folderId, pct);
      toast.success(pct === null ? `Vuelve a ${DEFAULT_EXPRESS_ADJUST_PCT}%` : "Ajuste guardado");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
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
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Porcentaje que aplica el botón <strong>Local Express</strong> de la
        proyección de venta. No se suma al ajuste que hubiera: lo reemplaza.
        Negativo castiga la estimación, positivo la premia.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-28">
          <div className="mb-1 text-[10px] text-muted-foreground">Ajuste Express</div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={-90}
              max={90}
              step={1}
              value={draft}
              onChange={(e) =>
                setDraft(Math.max(-90, Math.min(90, parseFloat(e.target.value) || 0)))
              }
              className="h-8 text-right text-xs font-mono"
            />
            <span className="text-[11px] text-muted-foreground">%</span>
          </div>
        </div>

        <Button size="sm" onClick={() => void persist(draft)} disabled={saving || !folderId}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Guardar
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void persist(null)}
          disabled={saving || !folderId || saved === DEFAULT_EXPRESS_ADJUST_PCT}
          title={`Volver al valor por defecto (${DEFAULT_EXPRESS_ADJUST_PCT}%)`}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Volver a {DEFAULT_EXPRESS_ADJUST_PCT}%
        </Button>
      </div>
    </div>
  );
};
