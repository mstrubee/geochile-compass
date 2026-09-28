import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

interface Props {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  /** Texto a la derecha del campo: "%", "km/h". */
  suffix?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Campo numérico que se deja escribir.
 *
 * Acotar el valor en cada tecla hace imposible escribir varios números: con un
 * mínimo de 5, teclear "28" convierte el "2" en 5 y termina en 58. Acá el
 * texto se mantiene tal cual mientras se escribe y el rango se aplica al
 * salir del campo, que es cuando el valor ya está completo.
 */
export const NumberField = ({
  value, onChange, min, max, suffix, label, disabled, className,
}: Props) => {
  const [texto, setTexto] = useState(String(value));
  const editando = useRef(false);

  // Mientras el usuario escribe, el valor de afuera no pisa lo tecleado.
  useEffect(() => {
    if (!editando.current) setTexto(String(value));
  }, [value]);

  /** Se admite lo que puede llegar a ser un número: "-", "1.", "" incluidos. */
  const enCurso = (s: string) => /^-?\d*[.,]?\d*$/.test(s);

  const confirmar = () => {
    editando.current = false;
    const n = parseFloat(texto.replace(",", "."));
    const limpio = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : value;
    setTexto(String(limpio));
    if (limpio !== value) onChange(limpio);
  };

  return (
    <div className={className}>
      {label && <div className="mb-1 text-[10px] text-muted-foreground">{label}</div>}
      <div className="flex items-center gap-1">
        <Input
          // Texto y no number: un <input type="number"> normaliza a "" lo que
          // todavía no es un número válido, así que al teclear el "-" de un
          // negativo el signo desaparecía.
          type="text"
          inputMode="decimal"
          aria-valuemin={min}
          aria-valuemax={max}
          value={texto}
          disabled={disabled}
          onFocus={() => { editando.current = true; }}
          onChange={(e) => {
            if (!enCurso(e.target.value)) return;
            editando.current = true;
            setTexto(e.target.value);
            // El valor se propaga sin acotar: así el resto de la pantalla
            // reacciona mientras se escribe, y el rango se aplica al salir.
            const n = parseFloat(e.target.value.replace(",", "."));
            if (Number.isFinite(n)) onChange(n);
          }}
          onBlur={confirmar}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="h-8 text-right text-xs font-mono"
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
};
