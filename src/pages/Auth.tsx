import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { clearStoredAuthSession, useAuth } from "@/hooks/useAuth";

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
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
      return "Debes confirmar tu correo antes de iniciar sesión.";
    return msg;
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setLastError(null);
    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        toast.success("Cuenta creada. Revisa tu correo para confirmar.");
      } else {
        clearStoredAuthSession();
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) throw new Error("No se obtuvo sesión.");
        navigate("/", { replace: true });
      }
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

  const handleGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setLastError(null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (!result.redirected) navigate("/", { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = friendlyError(raw);
      setLastError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-surface/90 p-6 shadow-apple-lg backdrop-blur-2xl">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {tab === "signin" ? "Iniciar sesión" : "Crear cuenta"}
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Accede para guardar tus POIs de forma permanente.
        </p>

        <div className="mt-4 flex gap-0.5 rounded-lg bg-surface-2/60 p-0.5">
          {(["signin", "signup"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-all",
                tab === t
                  ? "bg-surface-3 text-foreground shadow-apple-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t === "signin" ? "Entrar" : "Registrarse"}
            </button>
          ))}
        </div>

        <form onSubmit={handleEmail} className="mt-4 space-y-2.5">
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
            {busy ? "…" : tab === "signin" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-2 text-[11px] text-text-muted">
          <span className="h-px flex-1 bg-border/60" />
          o
          <span className="h-px flex-1 bg-border/60" />
        </div>

        <button
          onClick={handleGoogle}
          disabled={busy}
          className="w-full rounded-lg border border-border/60 bg-surface-2/60 px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          Continuar con Google
        </button>

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
