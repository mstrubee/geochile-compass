import { ReactNode, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import type { SectionKey } from "@/config/sections";
import {
  ensurePrefsLoaded,
  getPref,
  setPref,
  subscribePrefs,
} from "@/services/userUiPrefs";

interface SidebarSectionProps {
  title: string;
  accent?: "primary" | "teal" | "purple" | "iso" | "orange";
  defaultOpen?: boolean;
  children: ReactNode;
  /** Si se pasa, la sección se oculta cuando el usuario no tiene permiso de view. */
  permissionKey?: SectionKey;
}

const STORAGE_KEY = "sidebar_sections_collapsed_v1";

const readMap = (): Record<string, boolean> =>
  (getPref<Record<string, boolean>>(STORAGE_KEY) ?? {}) as Record<string, boolean>;

export const SidebarSection = ({ title, defaultOpen = true, children, permissionKey }: SidebarSectionProps) => {
  const { canView, loading } = usePermissions();
  const [open, setOpen] = useState<boolean>(() => {
    const map = readMap();
    return typeof map[title] === "boolean" ? map[title] : defaultOpen;
  });

  // On first mount: kick off remote prefs fetch + subscribe so we re-render
  // when the server snapshot arrives (overwrites local guess if different).
  useEffect(() => {
    void ensurePrefsLoaded();
    const unsub = subscribePrefs(() => {
      const map = readMap();
      if (typeof map[title] === "boolean") setOpen(map[title]);
    });
    return unsub;
  }, [title]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      const map = { ...readMap(), [title]: next };
      setPref(STORAGE_KEY, map);
      return next;
    });
  };

  if (permissionKey && !loading && !canView(permissionKey)) return null;

  return (
    <section className="border-b border-border/40">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex-1 text-left">{title}</span>
        <ChevronDown
          className={["h-3.5 w-3.5 transition-transform", open ? "" : "-rotate-90"].join(" ")}
        />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
};
