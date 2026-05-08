import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, HelpCircle, Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Imperative dialog service — reemplaza `window.confirm` y `window.prompt`
 * con cuadros de diálogo consistentes con el sistema de diseño.
 *
 * Uso:
 *   const ok = await confirmDialog({ title: "¿Eliminar?", description: "..." });
 *   const value = await promptDialog({ title: "Renombrar", defaultValue: "x" });
 */

let mountNode: HTMLDivElement | null = null;
let root: Root | null = null;

const ensureRoot = (): Root => {
  if (!mountNode) {
    mountNode = document.createElement("div");
    mountNode.setAttribute("data-dialog-service", "");
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
  }
  return root!;
};

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "destructive" | "primary" | "warning";
  icon?: LucideIcon;
}

export const confirmDialog = (opts: ConfirmOptions): Promise<boolean> =>
  new Promise((resolve) => {
    const r = ensureRoot();
    const close = (value: boolean) => {
      r.render(null);
      resolve(value);
    };
    r.render(
      <ConfirmHost
        opts={opts}
        onResolve={close}
      />,
    );
  });

const ConfirmHost = ({
  opts,
  onResolve,
}: {
  opts: ConfirmOptions;
  onResolve: (v: boolean) => void;
}) => {
  const [open, setOpen] = useState(true);
  const tone = opts.tone ?? "destructive";
  const Icon =
    opts.icon ??
    (tone === "destructive" ? AlertTriangle : tone === "warning" ? AlertTriangle : HelpCircle);

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setOpen(false);
          onResolve(false);
        }
      }}
      icon={Icon}
      tone={tone}
      title={opts.title}
      description={opts.description}
      cancelLabel={opts.cancelLabel ?? "Cancelar"}
      confirmLabel={opts.confirmLabel ?? "Confirmar"}
      confirmVariant={tone === "destructive" ? "destructive" : "default"}
      onConfirm={() => {
        setOpen(false);
        onResolve(true);
      }}
      size="sm"
    >
      <div className="text-sm text-muted-foreground">
        {opts.description ?? "¿Estás seguro de continuar?"}
      </div>
    </AppDialog>
  );
};

interface PromptOptions {
  title: string;
  description?: React.ReactNode;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
  icon?: LucideIcon;
}

export const promptDialog = (opts: PromptOptions): Promise<string | null> =>
  new Promise((resolve) => {
    const r = ensureRoot();
    const close = (value: string | null) => {
      r.render(null);
      resolve(value);
    };
    r.render(<PromptHost opts={opts} onResolve={close} />);
  });

const PromptHost = ({
  opts,
  onResolve,
}: {
  opts: PromptOptions;
  onResolve: (v: string | null) => void;
}) => {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(opts.defaultValue ?? "");
  }, [opts.defaultValue]);

  const handleConfirm = () => {
    const trimmed = value.trim();
    const err = opts.validate ? opts.validate(trimmed) : trimmed ? null : "Campo obligatorio";
    if (err) {
      setError(err);
      return;
    }
    setOpen(false);
    onResolve(trimmed);
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setOpen(false);
          onResolve(null);
        }
      }}
      icon={opts.icon ?? Pencil}
      tone="primary"
      title={opts.title}
      description={opts.description}
      cancelLabel={opts.cancelLabel ?? "Cancelar"}
      confirmLabel={opts.confirmLabel ?? "Aceptar"}
      onConfirm={handleConfirm}
      size="sm"
    >
      <div className="space-y-1.5">
        {opts.label && <Label className="text-xs">{opts.label}</Label>}
        <Input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleConfirm();
            }
          }}
          placeholder={opts.placeholder}
        />
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </AppDialog>
  );
};

interface SelectOption {
  value: string;
  label: string;
}

interface SelectOptions {
  title: string;
  description?: React.ReactNode;
  label?: string;
  options: SelectOption[];
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: LucideIcon;
}

export const selectDialog = (opts: SelectOptions): Promise<string | null> =>
  new Promise((resolve) => {
    const r = ensureRoot();
    const close = (value: string | null) => {
      r.render(null);
      resolve(value);
    };
    r.render(<SelectHost opts={opts} onResolve={close} />);
  });

const SelectHost = ({
  opts,
  onResolve,
}: {
  opts: SelectOptions;
  onResolve: (v: string | null) => void;
}) => {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState(opts.defaultValue ?? opts.options[0]?.value ?? "");

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setOpen(false);
          onResolve(null);
        }
      }}
      icon={opts.icon ?? HelpCircle}
      tone="primary"
      title={opts.title}
      description={opts.description}
      cancelLabel={opts.cancelLabel ?? "Cancelar"}
      confirmLabel={opts.confirmLabel ?? "Aceptar"}
      onConfirm={() => {
        setOpen(false);
        onResolve(value);
      }}
      size="sm"
    >
      <div className="space-y-1.5">
        {opts.label && <Label className="text-xs">{opts.label}</Label>}
        <select
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {opts.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </AppDialog>
  );
};
