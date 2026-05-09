import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = "admin" | "moderator" | "user";

/**
 * Devuelve el conjunto de roles del usuario autenticado.
 * Refresca cuando cambia el user. No bloquea el render del árbol.
 */
export const useUserRoles = () => {
  const { user } = useAuth();
  const [roles, setRoles] = useState<Set<AppRole>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (!user) {
      setRoles(new Set());
      return;
    }
    setLoading(true);
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (cancel) return;
        if (error) {
          console.warn("[useUserRoles]", error.message);
          setRoles(new Set());
        } else {
          setRoles(new Set((data ?? []).map((r) => r.role as AppRole)));
        }
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [user]);

  return {
    roles,
    isAdmin: roles.has("admin"),
    isModerator: roles.has("moderator"),
    loading,
  };
};
