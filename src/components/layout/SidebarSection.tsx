import { ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import type { SectionKey } from "@/config/sections";

interface SidebarSectionProps {
  title: string;
  accent?: "primary" | "teal" | "purple" | "iso" | "orange";
  /** Estado por defecto en una sesión fresca. Por requerimiento UX, todas las
   *  secciones del sidebar arrancan colapsadas al recargar la página. */
  defaultOpen?: boolean;
  children: ReactNode;
  permissionKey?: SectionKey;
}

/**
 * Estado in-memory por título: persiste mientras dura la sesión del SPA,
 * pero se pierde al recargar la página (por diseño — el usuario pidió que
 * todas las secciones vuelvan a estar colapsadas tras un reload).
 */
const sessionOpenState = new Map<string, boolean>();

export const SidebarSection = ({ title, defaultOpen = false, children, permissionKey }: SidebarSectionProps) => {
  const { canView, loading } = usePermissions();
  const [open, setOpen] = useState<boolean>(() => {
    const v = sessionOpenState.get(title);
    return typeof v === "boolean" ? v : defaultOpen;
  });

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      sessionOpenState.set(title, next);
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
