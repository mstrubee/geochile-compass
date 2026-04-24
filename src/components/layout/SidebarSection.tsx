import { ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

interface SidebarSectionProps {
  title: string;
  accent?: "primary" | "teal" | "purple" | "iso" | "orange";
  defaultOpen?: boolean;
  children: ReactNode;
}

const ACCENT_BG: Record<string, string> = {
  primary: "before:bg-primary",
  teal: "before:bg-brand-teal",
  purple: "before:bg-brand-purple",
  iso: "before:bg-iso-1",
  orange: "before:bg-brand-orange",
};

export const SidebarSection = ({ title, accent = "primary", defaultOpen = true, children }: SidebarSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          "relative flex w-full items-center gap-2 px-3.5 py-2.5 font-mono text-[9px] uppercase tracking-[2px] text-text-muted transition-colors hover:text-muted-foreground",
          "before:mr-1 before:h-2.5 before:w-[3px] before:rounded-sm before:content-['']",
          ACCENT_BG[accent],
        ].join(" ")}
      >
        <span className="flex-1 text-left">{title}</span>
        <ChevronDown
          className={["h-3 w-3 transition-transform", open ? "" : "-rotate-90"].join(" ")}
        />
      </button>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </section>
  );
};
