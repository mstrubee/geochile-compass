import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Copy, Eye, EyeOff, Trash2, Pencil, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  AppSecret, deleteSecret, listSecrets, maskSecret, upsertSecret,
} from "@/services/appSecretsService";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—";

const SecretRow = ({
  s, onEdit, onAskDelete,
}: {
  s: AppSecret;
  onEdit: (s: AppSecret) => void;
  onAskDelete: (s: AppSecret) => void;
}) => {
  const [revealed, setRevealed] = useState(false);
  const hasValue = !!s.value && s.value.trim().length > 0;

  const copy = async () => {
    await navigator.clipboard.writeText(s.value);
    toast.success("Valor copiado");
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-surface/60 p-4 shadow-apple-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold text-foreground">{s.key}</div>
          {s.description && <div className="text-[11px] text-muted-foreground">{s.description}</div>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            hasValue ? "bg-brand-green/15 text-brand-green" : "bg-amber-500/15 text-amber-600"
          }`}
        >
          {hasValue ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />Configurado</> : <><AlertTriangle className="mr-1 inline h-3 w-3" />Vacío</>}
        </span>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border/60 bg-surface-2/60 px-2 py-1.5 font-mono text-[11px]">
        <span className="flex-1 truncate">{hasValue ? (revealed ? s.value : maskSecret(s.value)) : "— sin valor —"}</span>
        {hasValue && (
          <>
            <button onClick={() => setRevealed((v) => !v)} className="p-1 text-muted-foreground hover:text-foreground" title={revealed ? "Ocultar" : "Mostrar"}>
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button onClick={copy} className="p-1 text-muted-foreground hover:text-foreground" title="Copiar">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[10px] text-muted-foreground">Actualizado: {fmtDate(s.updated_at)}</span>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => onEdit(s)}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> {hasValue ? "Cambiar" : "Configurar"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onAskDelete(s)} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const SecretDialog = ({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: AppSecret | null;
  onSaved: () => void;
}) => {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const isNew = !initial;

  useEffect(() => {
    if (open) {
      setKey(initial?.key ?? "");
      setValue(initial?.value ?? "");
      setDescription(initial?.description ?? "");
    }
  }, [open, initial]);

  const submit = async () => {
    if (!key.trim()) { toast.error("El nombre (key) es requerido"); return; }
    setSaving(true);
    try {
      await upsertSecret({ key: key.trim(), value, description: description.trim() || null });
      toast.success("Secret guardado. Las funciones lo tomarán de inmediato.");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Nuevo secret" : `Editar ${initial?.key}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nombre (key)</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={!isNew} placeholder="OPENROUTESERVICE_API_KEY" className="font-mono" />
          </div>
          <div>
            <Label>Valor</Label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Pega aquí la API key / secret" className="font-mono" />
          </div>
          <div>
            <Label>Descripción (opcional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para qué sirve" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const SecretsAdminSection = () => {
  const [secrets, setSecrets] = useState<AppSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AppSecret | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<AppSecret | null>(null);

  const refresh = async () => {
    try {
      setSecrets(await listSecrets());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando secrets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Cargando…</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        API keys y secrets que usan las funciones del sistema (isócronas, sincronización, ingesta).
        Pega aquí el valor y las funciones lo toman de inmediato, sin necesidad de redeploy.
        Solo los administradores pueden ver y editar esta sección.
      </p>
      <div className="flex items-center justify-end">
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Agregar secret
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {secrets.map((s) => (
          <SecretRow
            key={s.key}
            s={s}
            onEdit={(ss) => { setEditing(ss); setDialogOpen(true); }}
            onAskDelete={(ss) => setToDelete(ss)}
          />
        ))}
        {secrets.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
            No hay secrets aún. Agrega uno con el botón de arriba.
          </div>
        )}
      </div>

      <SecretDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSaved={refresh} />

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar secret</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará "{toDelete?.key}" permanentemente. Las funciones que lo usen dejarán de tener ese valor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!toDelete) return;
                try { await deleteSecret(toDelete.key); toast.success("Eliminado"); refresh(); }
                catch (e) { toast.error(e instanceof Error ? e.message : "Error"); }
                finally { setToDelete(null); }
              }}
            >Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SecretsAdminSection;
