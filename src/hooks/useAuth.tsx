import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const clearStoredAuthSession = () => {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("sb-") || key.includes("supabase"))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const isAuthScreen = window.location.pathname === "/auth";
    if (isAuthScreen && !window.location.hash && !window.location.search.includes("code=")) {
      clearStoredAuthSession();
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") setError(null);
    });

    supabase.auth
      .getSession()
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err) {
          setError(err.message);
          clearStoredAuthSession();
        } else {
          setSession(data.session);
          setUser(data.session?.user ?? null);
        }
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        clearStoredAuthSession();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback inocuo si por alguna razón se usa fuera del provider:
    // evita romper el árbol y permite que el caller maneje "loading".
    return { session: null, user: null, loading: true, error: null };
  }
  return ctx;
};
