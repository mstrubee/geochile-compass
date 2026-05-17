import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Copy, Eye, EyeOff, Trash2, Pencil, PlayCircle, CheckCircle2,
  AlertTriangle, ExternalLink, Link as LinkIcon,
} from "lucide-react";
import {
  GeminiApiKey, GeminiKeyLink, createGeminiKey, createGeminiLink, deleteGeminiKey,
  deleteGeminiLink, listGeminiKeys, listGeminiLinks, maskKey, testGeminiKeyById,
  updateGeminiKey, updateGeminiLink,
} from "@/services/geminiKeysService";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—";

const KeyCard = ({
  k, onChanged, onEdit, onAskDelete,
}: {
  k: GeminiApiKey;
  onChanged: () => void;
  onEdit: (k: GeminiApiKey) => void;
  onAskDelete: (k: GeminiApiKey) => void;
}) => {
  const [revealed, setRevealed] = useState(false);
  const [testing, setTesting] = useState(false);

  const toggleEnabled = async (v: boolean) => {
    try {
      await updateGeminiKey(k.id, { enabled: v });
      toast.success(v ? "Key activada" : "Key desactivada");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(k.api_key);
    toast.success("Key copiada al portapapeles");
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await testGeminiKeyById(k.id);
      if (r.ok) toast.success(`OK · ${r.latencyMs}ms`);
      else toast.error(`Falló (${r.reason ?? r.status}): ${r.message?.slice(0, 100) ?? ""}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error testando");
    } finally {
      setTesting(false);
    }
  };

  const statusBadge = !k.enabled
    ? { label: "Inactiva", cls: "bg-muted text-muted-foreground" }
    : k.last_error_at && (!k.last_used_at || new Date(k.last_error_at) > new Date(k.last_used_at))
      ? { label: `Error: ${k.last_error_reason ?? "desconocido"}`, cls: "bg-destructive/15 text-destructive" }
      : { label: "Activa", cls: "bg-brand-green/15 text-brand-green" };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-surface/60 p-4 shadow-apple-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">{k.alias}</div>
          <div className="text-[11px] text-muted-foreground">Prioridad: {k.priority}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge.cls}`}>
          {statusBadge.label}
        </span>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border/60 bg-surface-2/60 px-2 py-1.5 font-mono text-[11px]">
        <span className="flex-1 truncate">{revealed ? k.api_key : maskKey(k.api_key)}</span>
        <button onClick={() => setRevealed((v) => !v)} className="p-1 text-muted-foreground hover:text-foreground" title={revealed ? "Ocultar" : "Mostrar"}>
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button onClick={copy} className="p-1 text-muted-foreground hover:text-foreground" title="Copiar">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <div><CheckCircle2 className="mr-1 inline h-3 w-3 text-brand-green" />Éxitos: {k.success_count}</div>
        <div><AlertTriangle className="mr-1 inline h-3 w-3 text-destructive" />Errores: {k.error_count}</div>
        <div>Último uso: {fmtDate(k.last_used_at)}</div>
        <div title={k.last_error_message ?? ""}>Último error: {fmtDate(k.last_error_at)}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <Switch checked={k.enabled} onCheckedChange={toggleEnabled} />
          <span className="text-[11px] text-muted-foreground">{k.enabled ? "Activa" : "Inactiva"}</span>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={test} disabled={testing}>
            <PlayCircle className="mr-1 h-3.5 w-3.5" /> Testear
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEdit(k)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onAskDelete(k)} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const KeyDialog = ({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: GeminiApiKey | null;
  onSaved: () => void;
}) => {
  const [alias, setAlias] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAlias(initial?.alias ?? "");
      setApiKey(initial?.api_key ?? "");
      setPriority(initial?.priority ?? 100);
      setEnabled(initial?.enabled ?? true);
    }
  }, [open, initial]);

  const submit = async () => {
    if (!alias.trim() || !apiKey.trim()) {
      toast.error("Alias y API Key son requeridos");
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await updateGeminiKey(initial.id, { alias: alias.trim(), api_key: apiKey.trim(), priority, enabled });
      } else {
        await createGeminiKey({ alias: alias.trim(), api_key: apiKey.trim(), priority, enabled });
      }
      toast.success("Guardado");
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
          <DialogTitle>{initial ? "Editar API Key" : "Nueva API Key"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Alias</Label>
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="ej: Cuenta principal" />
          </div>
          <div>
            <Label>API Key</Label>
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIzaSy..." />
          </div>
          <div>
            <Label>Prioridad (menor = se intenta primero)</Label>
            <Input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value || "100", 10))} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span className="text-sm">Activa</span>
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

const LinksSection = ({ links, onChanged }: { links: GeminiKeyLink[]; onChanged: () => void }) => {
  const [editing, setEditing] = useState<GeminiKeyLink | null>(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [order, setOrder] = useState(0);

  const openNew = () => {
    setEditing(null);
    setLabel(""); setUrl(""); setOrder((links[links.length - 1]?.order_index ?? 0) + 10);
    setOpen(true);
  };
  const openEdit = (l: GeminiKeyLink) => {
    setEditing(l);
    setLabel(l.label); setUrl(l.url); setOrder(l.order_index);
    setOpen(true);
  };
  const submit = async () => {
    if (!label.trim() || !url.trim()) { toast.error("Etiqueta y URL requeridas"); return; }
    try {
      if (editing) await updateGeminiLink(editing.id, { label: label.trim(), url: url.trim(), order_index: order });
      else await createGeminiLink({ label: label.trim(), url: url.trim(), order_index: order });
      toast.success("Guardado");
      onChanged();
      setOpen(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); }
  };
  const remove = async (id: string) => {
    try { await deleteGeminiLink(id); toast.success("Eliminado"); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-surface/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Enlaces "Obtener más API Keys"</h2>
          <p className="text-[11px] text-muted-foreground">Accesos rápidos para generar nuevas API Keys. Se abren en pestaña nueva.</p>
        </div>
        <Button size="sm" onClick={openNew}><Plus className="mr-1 h-3.5 w-3.5" /> Agregar enlace</Button>
      </div>
      <div className="space-y-2">
        {links.length === 0 && <p className="text-xs text-muted-foreground">Sin enlaces aún.</p>}
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-2 rounded-md border border-border/40 bg-surface-2/60 px-3 py-2">
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm">{l.label}</div>
              <div className="truncate text-[10px] text-muted-foreground">{l.url}</div>
            </div>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Button variant="ghost" size="sm" onClick={() => openEdit(l)}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" onClick={() => remove(l.id)} className="text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar enlace" : "Nuevo enlace"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Etiqueta</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            <div><Label>URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></div>
            <div><Label>Orden</Label><Input type="number" value={order} onChange={(e) => setOrder(parseInt(e.target.value || "0", 10))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const GeminiKeysAdminSection = () => {
  const [keys, setKeys] = useState<GeminiApiKey[]>([]);
  const [links, setLinks] = useState<GeminiKeyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GeminiApiKey | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<GeminiApiKey | null>(null);

  const refresh = async () => {
    try {
      const [a, b] = await Promise.all([listGeminiKeys(), listGeminiLinks()]);
      setKeys(a); setLinks(b);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const stats = useMemo(() => {
    const active = keys.filter((k) => k.enabled).length;
    const failing = keys.filter((k) =>
      k.enabled && k.last_error_at && (!k.last_used_at || new Date(k.last_error_at) > new Date(k.last_used_at)),
    ).length;
    return { total: keys.length, active, failing };
  }, [keys]);

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Cargando…</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Las keys se prueban en orden de prioridad. Si una falla por cuota, rate limit o no disponible, se intenta automáticamente la siguiente.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>Total: {stats.total}</span>
          <span className="text-brand-green">Activas: {stats.active}</span>
          {stats.failing > 0 && <span className="text-destructive">Con error reciente: {stats.failing}</span>}
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Agregar nueva key
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map((k) => (
          <KeyCard
            key={k.id}
            k={k}
            onChanged={refresh}
            onEdit={(kk) => { setEditing(kk); setDialogOpen(true); }}
            onAskDelete={(kk) => setToDelete(kk)}
          />
        ))}
        {keys.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
            No hay keys configuradas. Agrega al menos una para que el asistente IA funcione.
          </div>
        )}
      </div>

      <LinksSection links={links} onChanged={refresh} />

      <KeyDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSaved={refresh} />

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará "{toDelete?.alias}" permanentemente. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!toDelete) return;
                try { await deleteGeminiKey(toDelete.id); toast.success("Eliminada"); refresh(); }
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

export default GeminiKeysAdminSection;
