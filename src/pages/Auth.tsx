import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        toast.success("Cuenta creada. Iniciando sesión…");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate("/", { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (!result.redirected) navigate("/", { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
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
      </div>
    </div>
  );
};

export default Auth;
