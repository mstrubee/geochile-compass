import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const useAuth = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

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
          // Sesión local corrupta: limpiar para evitar bucle de refresh
          supabase.auth.signOut({ scope: "local" }).catch(() => {});
        } else {
          setSession(data.session);
          setUser(data.session?.user ?? null);
        }
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user, loading, error };
};
