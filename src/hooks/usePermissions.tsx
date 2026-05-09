import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { SectionKey } from "@/config/sections";

type SectionPerm = { view: boolean; edit: boolean };
type PermissionMap = Partial<Record<SectionKey, SectionPerm>> & { __admin?: boolean };

interface PermissionsContextValue {
  loading: boolean;
  isAdmin: boolean;
  perms: PermissionMap;
  canView: (key: SectionKey) => boolean;
  canEdit: (key: SectionKey) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PermissionsContextValue | undefined>(undefined);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [perms, setPerms] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) {
      setPerms({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("user_section_permissions", { _user_id: user.id });
    if (error) {
      console.warn("[permissions]", error.message);
      setPerms({});
    } else {
      setPerms((data as PermissionMap) ?? {});
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const isAdmin = !!perms.__admin;
  const canView = (k: SectionKey) => isAdmin || !!perms[k]?.view;
  const canEdit = (k: SectionKey) => isAdmin || !!perms[k]?.edit;

  return (
    <Ctx.Provider value={{ loading, isAdmin, perms, canView, canEdit, refresh: load }}>
      {children}
    </Ctx.Provider>
  );
};

export const usePermissions = () => {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      loading: true,
      isAdmin: false,
      perms: {} as PermissionMap,
      canView: () => true,
      canEdit: () => true,
      refresh: async () => {},
    } as PermissionsContextValue;
  }
  return ctx;
};
