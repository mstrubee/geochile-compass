import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clearStoredAuthSession, useAuth } from "@/hooks/useAuth";

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  const friendlyError = (msg: string): string => {
    if (/failed to fetch|networkerror|load failed/i.test(msg))
      return "No se pudo contactar al servidor de autenticación. Revisa tu conexión y reintenta.";
    if (/invalid login credentials/i.test(msg))
      return "Email o contraseña incorrectos.";
    if (/email not confirmed/i.test(msg))
      return "Tu cuenta no está confirmada. Contacta al administrador.";
    return msg;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setLastError(null);
    try {
      clearStoredAuthSession();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error("No se obtuvo sesión.");
      navigate("/", { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = friendlyError(raw);
      setLastError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleResetSession = async () => {
    setBusy(true);
    try {
      clearStoredAuthSession();
      setLastError(null);
      toast.success("Sesión local limpiada. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-surface/90 p-6 shadow-apple-lg backdrop-blur-2xl">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Iniciar sesión</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Acceso restringido. Si no tienes una cuenta, solicítala al administrador.
        </p>

        <form onSubmit={handleLogin} className="mt-4 space-y-2.5">
          <input
            type="email"
            required
            placeholder="email@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-surface-2/60 px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-surface-2/60 px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "…" : "Entrar"}
          </button>
        </form>

        {lastError && (
          <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[12px] text-destructive">
            <p>{lastError}</p>
            <button
              type="button"
              onClick={handleResetSession}
              disabled={busy}
              className="mt-1.5 text-[11px] font-medium underline hover:no-underline"
            >
              Limpiar sesión y reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auth;
