import * as React from "react";
import { type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * AppDialog — Wrapper consistente y minimalista profesional para todos los
 * cuadros de diálogo del sistema.
 *
 * Estructura:
 *  - Header: ícono opcional en chip cuadrado + título + descripción
 *  - Body  : children con padding y scroll opcional
 *  - Footer: botones estandarizados (cancelar a la izquierda, primario a la derecha)
 */

type Tone = "default" | "primary" | "destructive" | "success" | "warning" | "info";

const toneStyles: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

const sizeMap: Record<NonNullable<AppDialogProps["size"]>, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl",
  "2xl": "sm:max-w-3xl",
  "3xl": "sm:max-w-4xl",
  "5xl": "sm:max-w-5xl",
};

export interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Encabezado */
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** Tamaño máximo (responsive) */
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "5xl";
  /** Body */
  children: React.ReactNode;
  bodyClassName?: string;
  /** Footer custom; si se omite y hay onConfirm/cancelLabel se renderiza uno por defecto */
  footer?: React.ReactNode;
  /** Helpers para footer estándar */
  cancelLabel?: string;
  confirmLabel?: string;
  onConfirm?: () => void | Promise<void>;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  confirmVariant?: React.ComponentProps<typeof Button>["variant"];
  /** Para diálogos sin padding (e.g. tabs full-bleed) */
  contentClassName?: string;
  hideClose?: boolean;
}

export const AppDialog = ({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  tone = "default",
  size = "md",
  children,
  bodyClassName,
  footer,
  cancelLabel,
  confirmLabel,
  onConfirm,
  confirmDisabled,
  confirmLoading,
  confirmVariant = "default",
  contentClassName,
}: AppDialogProps) => {
  const showDefaultFooter = !footer && (confirmLabel || cancelLabel);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "gap-0 p-0 overflow-hidden",
          sizeMap[size],
          contentClassName,
        )}
      >
        <DialogHeader className="space-y-2 border-b border-border/60 px-5 pb-4 pt-5 text-left">
          <div className="flex items-start gap-3">
            {Icon && (
              <div
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  toneStyles[tone],
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold leading-tight tracking-tight">
                {title}
              </DialogTitle>
              {description && (
                <DialogDescription className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>

        {footer && (
          <DialogFooter className="gap-2 border-t border-border/60 bg-muted/30 px-5 py-3">
            {footer}
          </DialogFooter>
        )}
        {showDefaultFooter && (
          <DialogFooter className="gap-2 border-t border-border/60 bg-muted/30 px-5 py-3">
            {cancelLabel && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={confirmLoading}
              >
                {cancelLabel}
              </Button>
            )}
            {confirmLabel && (
              <Button
                size="sm"
                variant={confirmVariant}
                onClick={() => onConfirm?.()}
                disabled={confirmDisabled || confirmLoading}
              >
                {confirmLoading ? "Procesando…" : confirmLabel}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

/** Footer helper para usos con botones custom dentro de AppDialog */
export const AppDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "-mx-5 -mb-4 mt-4 flex items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-5 py-3",
      className,
    )}
    {...props}
  />
);
