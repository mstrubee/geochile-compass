import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_DRIVE_SPEEDS,
  defaultCommercialFolder,
  fetchDriveSpeeds,
  saveDriveSpeeds,
  type DriveSpeeds,
} from "@/services/commercialSettingsService";

interface Folder { id: string; name: string }

/**
 * Velocidades con las que se estima el tiempo en auto a los locales de la red.
 *
 * El ruteador entrega la distancia real por calle y cuánto de la ruta es
 * autopista; el tiempo sale de acá. Se separa del ruteador a propósito: su
 * modelo supone tránsito libre, que para una decisión de inversión es
 * optimista.
 */
export const DriveSpeedsAdminSection = () => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const folderId = pickedId ?? defaultCommercialFolder(folders)?.id ?? "";
  const [draft, setDraft] = useState<DriveSpeeds>(DEFAULT_DRIVE_SPEEDS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("poi_folders")
        .select("id, name")
        .is("deleted_at", null)
        .order("name");
      setFolders((data ?? []) as Folder[]);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!folderId) return;
    setLoading(true);
    try {
      setDraft(await fetchDriveSpeeds(folderId));
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => { void load(); }, [load]);

  const persist = async () => {
    if (!folderId) return;
    setSaving(true);
    try {
      await saveDriveSpeeds(folderId, draft);
      toast.success("Velocidades guardadas");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const campo = (
    key: keyof DriveSpeeds,
    label: string,
  ) => (
    <div className="w-32">
      <div className="mb-1 text-[10px] text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={5}
          max={140}
          step={1}
          value={draft[key]}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              [key]: Math.max(5, Math.min(140, parseFloat(e.target.value) || 0)),
            }))
          }
          className="h-8 text-right text-xs font-mono"
        />
        <span className="text-[11px] text-muted-foreground">km/h</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={folderId}
          onChange={(e) => setPickedId(e.target.value)}
          className="h-8 rounded-md border border-border/50 bg-surface-2 px-2 text-xs"
        >
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Con estas velocidades se calcula el tiempo en auto desde la isócrona
        hasta los locales de la red. La ruta y los kilómetros son los reales
        por calle; lo que se define acá es a qué ritmo se recorren.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        {campo("urbanKmh", "Zona urbana")}
        {campo("highwayKmh", "Autopista")}
        <Button size="sm" onClick={() => void persist()} disabled={saving || !folderId}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Guardar
        </Button>
      </div>
    </div>
  );
};
