import { ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

interface SidebarSectionProps {
  title: string;
  accent?: "primary" | "teal" | "purple" | "iso" | "orange";
  defaultOpen?: boolean;
  children: ReactNode;
}

export const SidebarSection = ({ title, defaultOpen = true, children }: SidebarSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border/40">
      <button
        onClick={() => setOpen((o) => !o)}
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
