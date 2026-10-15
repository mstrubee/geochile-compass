import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, AlertTriangle, ShieldCheck, Lock, RefreshCw, PlusCircle } from "lucide-react";
import { useApiQuotaStatus } from "@/hooks/useApiQuotaStatus";
import { useGoogleMapsKey } from "@/hooks/useGoogleMapsKey";
import { THRESHOLD_CRITICAL, THRESHOLD_WARN } from "@/hooks/useMapProvider";
import {
  QUOTA_EXTENSION_STEP, extendApiQuota, hasApiQuotaPassword, listApiQuotaExtensions,
  setApiQuotaLimit, setApiQuotaPassword,
  type QuotaActionResult, type QuotaApiStatus, type QuotaExtensionLog,
} from "@/services/apiQuotaService";

const fmt = (n: number) => n.toLocaleString("es-CL");
const fmtDate = (s: string) =>
  new Date(s).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });

/** Qué hace cada API dentro de Geoplanet (se muestra bajo el título de cada módulo). */
const API_HELP: Record<string, string> = {
  maps_js: "Se mide en CARGAS DE MAPA (una por cada vez que se abre el mapa de Google; cambiar de mapa base no cuenta). Al agotarse, el mapa vuelve a OpenStreetMap.",
  places: "Detalle de un lugar elegido (coordenadas) y, más adelante, búsqueda de comercios.",
  autocomplete: "Sugerencias mientras se escribe en el buscador del mapa. Al agotarse, el buscador usa OpenStreetMap.",
  geocoding: "Conversión de una dirección escrita a coordenadas. Al agotarse, se geocodifica con OpenStreetMap.",
};

/** Unidad de cada API: el mapa se mide en cargas de mapa; el resto, en llamadas. */
const unitOf = (api: string) => (api === "maps_js" ? "cargas" : "llamadas");

const barColor = (pct: number) =>
  pct >= 1 ? "bg-destructive" : pct >= THRESHOLD_CRITICAL ? "bg-destructive/80"
    : pct >= THRESHOLD_WARN ? "bg-brand-yellow" : "bg-brand-green";

// ── Diálogo genérico de contraseña ────────────────────────────────────────────

const PasswordDialog = ({
  open, onOpenChange, title, description, confirmLabel, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (password: string) => Promise<QuotaActionResult>;
}) => {
  const pwId = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setPassword(""); setError(null); } }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await onConfirm(password);
      if (r.ok) onOpenChange(false);
      else setError(r.message ?? "No se pudo completar la acción.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={pwId}>Contraseña de ampliaciones</Label>
          <Input
            id={pwId}
            type="password"
            autoFocus
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && password && !busy) submit(); }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !password}>{busy ? "Verificando…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Módulo de una API ─────────────────────────────────────────────────────────

const ApiCard = ({
  a, hasKey, hasPassword, onChanged,
}: {
  a: QuotaApiStatus;
  hasKey: boolean;
  hasPassword: boolean;
  onChanged: () => void;
}) => {
  const unit = unitOf(a.api);
  const limitId = useId();
  const [limitInput, setLimitInput] = useState(String(a.free_limit));
  const [extendOpen, setExtendOpen] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const pct = a.limit > 0 ? Math.min(1, a.used / a.limit) : 1;
  const blocked = a.used >= a.limit;
  const parsed = Number(limitInput);
  const validLimit = Number.isInteger(parsed) && parsed >= 0;
  const dirty = validLimit && parsed !== a.free_limit;

  useEffect(() => { setLimitInput(String(a.free_limit)); }, [a.free_limit]);

  const saveLimit = async (password?: string): Promise<QuotaActionResult> => {
    const r = await setApiQuotaLimit(a.api, parsed, password);
    if (r.ok) { toast.success(`Límite de ${a.label} actualizado`); onChanged(); }
    return r;
  };

  const onSaveClick = async () => {
    if (parsed > a.free_limit) { setRaiseOpen(true); return; } // subir exige contraseña
    try {
      const r = await saveLimit();
      if (!r.ok) toast.error(r.message ?? "No se pudo guardar");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-surface/60 p-4 shadow-apple-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{a.label}</div>
          <div className="text-[11px] text-muted-foreground">{API_HELP[a.api]}</div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            hasKey ? "bg-brand-green/15 text-brand-green" : "bg-amber-500/15 text-amber-600"
          }`}
          title="Todas las APIs usan la clave GOOGLE_MAPS_API_KEY de más abajo"
        >
          {hasKey
            ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />Clave lista</>
            : <><AlertTriangle className="mr-1 inline h-3 w-3" />Falta la clave</>}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className={blocked ? "font-semibold text-destructive" : "text-foreground"}>
            {fmt(a.used)} / {fmt(a.limit)} {unit}
          </span>
          <span className="text-muted-foreground">{Math.round(pct * 100)}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
          <div className={`h-full rounded-full transition-all ${barColor(pct)}`} style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Gratis: {fmt(a.free_limit)}</span>
          <span>Autorizadas este mes: +{fmt(a.extra_authorized)}</span>
        </div>
        {blocked && (
          <div className="flex items-center gap-1 text-[11px] text-destructive">
            <Lock className="h-3 w-3" /> Bloqueada: no se harán más {unit} de Google hasta que se autorice más.
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-border/50 pt-3">
        <Label htmlFor={limitId} className="text-[11px]">Límite gratuito mensual</Label>
        <div className="flex gap-2">
          <Input
            id={limitId}
            type="number" min={0} step={100} value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)} className="h-8 font-mono text-xs"
          />
          <Button size="sm" variant="outline" disabled={!dirty} onClick={onSaveClick}>Guardar</Button>
        </div>
        <p className="text-[10px] text-muted-foreground">Bajarlo es libre; subirlo pide la contraseña de ampliaciones.</p>
      </div>

      <Button
        size="sm"
        disabled={!hasPassword}
        title={hasPassword ? undefined : "Define primero la contraseña de ampliaciones"}
        onClick={() => setExtendOpen(true)}
      >
        <PlusCircle className="mr-1 h-3.5 w-3.5" /> Autorizar +{fmt(QUOTA_EXTENSION_STEP)} {unit}
      </Button>

      <PasswordDialog
        open={extendOpen} onOpenChange={setExtendOpen}
        title={`Autorizar +${fmt(QUOTA_EXTENSION_STEP)} ${unit}`}
        description={`${a.label}. Las ${unit} adicionales pueden generar costo en Google Cloud. Vale solo para este mes.`}
        confirmLabel="Autorizar"
        onConfirm={async (pw) => {
          const r = await extendApiQuota(a.api, pw);
          if (r.ok) { toast.success(`+${fmt(QUOTA_EXTENSION_STEP)} ${unit} autorizadas`); onChanged(); }
          return r;
        }}
      />
      <PasswordDialog
        open={raiseOpen} onOpenChange={setRaiseOpen}
        title="Subir el límite gratuito"
        description={`Pasar de ${fmt(a.free_limit)} a ${fmt(parsed)} ${unit} por mes. Confirma con la contraseña.`}
        confirmLabel="Subir límite"
        onConfirm={saveLimit}
      />
    </div>
  );
};

// ── Contraseña de ampliaciones ────────────────────────────────────────────────

const PasswordCard = ({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => void }) => {
  const ids = { cur: useId(), next: useId(), rep: useId() };
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (next !== confirm) { setError("La confirmación no coincide."); return; }
    setBusy(true);
    try {
      const r = await setApiQuotaPassword(next, hasPassword ? current : undefined);
      if (!r.ok) { setError(r.message ?? "No se pudo guardar la contraseña."); return; }
      toast.success(hasPassword ? "Contraseña actualizada" : "Contraseña definida");
      setCurrent(""); setNext(""); setConfirm("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-surface/60 p-4 shadow-apple-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">Contraseña de ampliaciones</div>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
          hasPassword ? "bg-brand-green/15 text-brand-green" : "bg-amber-500/15 text-amber-600"
        }`}>
          {hasPassword ? "Definida" : "Sin definir"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Se pide para autorizar +{fmt(QUOTA_EXTENSION_STEP)} unidades (cargas o llamadas) o para subir un límite gratuito.
        Solo la guarda el servidor (cifrada); nadie, ni los administradores, puede verla. Tras 5 intentos
        fallidos se bloquea 15 minutos.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {hasPassword && (
          <div>
            <Label htmlFor={ids.cur} className="text-[11px]">Contraseña actual</Label>
            <Input id={ids.cur} type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
        )}
        <div>
          <Label htmlFor={ids.next} className="text-[11px]">{hasPassword ? "Nueva contraseña" : "Contraseña (mín. 8)"}</Label>
          <Input id={ids.next} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={ids.rep} className="text-[11px]">Repetir</Label>
          <Input id={ids.rep} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy || next.length < 8 || (hasPassword && !current)}>
          {busy ? "Guardando…" : hasPassword ? "Cambiar contraseña" : "Definir contraseña"}
        </Button>
      </div>
    </div>
  );
};

// ── Sección ───────────────────────────────────────────────────────────────────

export const ApiQuotaAdminSection = () => {
  const { status, error, refresh } = useApiQuotaStatus(30_000);
  const googleKey = useGoogleMapsKey();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [log, setLog] = useState<QuotaExtensionLog[]>([]);

  const reload = async () => {
    refresh();
    try { setHasPassword(await hasApiQuotaPassword()); } catch { setHasPassword(false); }
    try { setLog(await listApiQuotaExtensions()); } catch { /* solo informativo */ }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  if (error && !status) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        No se pudo leer la cuota de las APIs: {error}
      </div>
    );
  }
  if (!status || hasPassword === null) return <div className="p-4 text-sm text-muted-foreground">Cargando…</div>;

  const periodEnd = new Date(status.period_end + "T00:00:00");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-xs text-muted-foreground">
          Geoplanet no llama a Google si una API agotó su límite gratuito del mes. Para seguir usándola, un
          administrador debe autorizar más de a +{fmt(QUOTA_EXTENSION_STEP)} con la contraseña de
          ampliaciones. El consumo se cuenta en el servidor (todos los usuarios suman) y se reinicia el{" "}
          <b>{periodEnd.toLocaleDateString("es-CL", { day: "numeric", month: "long" })}</b> (ciclo mensual de
          Google, hora del Pacífico).
        </p>
        <Button size="sm" variant="outline" onClick={reload}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Actualizar
        </Button>
      </div>

      <PasswordCard hasPassword={hasPassword} onChanged={reload} />

      <div className="grid gap-3 lg:grid-cols-2">
        {status.apis.map((a) => (
          <ApiCard key={a.api} a={a} hasKey={!!googleKey} hasPassword={hasPassword} onChanged={reload} />
        ))}
      </div>

      {log.length > 0 && (
        <details className="rounded-xl border border-border/60 bg-surface/60 p-3 text-xs">
          <summary className="cursor-pointer font-medium">Ampliaciones autorizadas ({log.length})</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {log.map((l, i) => (
              <li key={i}>
                {fmtDate(l.created_at)} · {status.apis.find((a) => a.api === l.api)?.label ?? l.api} · +{fmt(l.amount)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export default ApiQuotaAdminSection;
