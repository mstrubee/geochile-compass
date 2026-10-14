import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckState } from "@/types/layerNodes";

interface Props {
  state: CheckState;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}

/** Casilla de tres estados: marcada, vacía o intermedia (solo algunas de las capas de la carpeta). */
export const TriStateCheckbox = ({ state, onToggle, label, disabled }: Props) => (
  <CheckboxPrimitive.Root
    checked={state === "mixed" ? "indeterminate" : state === "checked"}
    // El siguiente valor lo decide la carpeta (marcada → apaga todo; intermedia → enciende todo).
    onCheckedChange={() => onToggle()}
    // El clic no debe seleccionar la fila ni abrir la carpeta.
    onClick={(e) => e.stopPropagation()}
    disabled={disabled}
    aria-label={label}
    className={cn(
      "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] border border-muted-foreground/60 transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary/70 data-[state=indeterminate]:text-primary-foreground",
      "disabled:cursor-not-allowed disabled:opacity-40",
    )}
  >
    <CheckboxPrimitive.Indicator>
      {state === "mixed" ? <Minus className="h-3 w-3" strokeWidth={3} /> : <Check className="h-3 w-3" strokeWidth={3} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);
