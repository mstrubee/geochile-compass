import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NumberField } from "@/components/admin/NumberField";

/**
 * Acotar en cada tecla impedía escribir: con mínimo 5, teclear "28" convertía
 * el "2" en 5 y el campo terminaba en 58.
 */
describe("NumberField", () => {
  it("deja teclear un numero que empieza bajo el minimo", () => {
    const onChange = vi.fn();
    render(<NumberField value={90} onChange={onChange} min={5} max={140} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2" } });
    // Antes el campo se convertía en 5 y el siguiente dígito daba 58.
    expect(input.value).toBe("2");
    fireEvent.change(input, { target: { value: "28" } });
    expect(input.value).toBe("28");

    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(28);
  });

  it("aplica el rango al salir del campo", () => {
    const onChange = vi.fn();
    render(<NumberField value={90} onChange={onChange} min={5} max={140} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(input.value).toBe("140");
    expect(onChange).toHaveBeenLastCalledWith(140);
  });

  it("deja escribir un negativo digito a digito", () => {
    const onChange = vi.fn();
    render(<NumberField value={-20} onChange={onChange} min={-90} max={90} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-" } });
    expect(input.value).toBe("-");
    fireEvent.change(input, { target: { value: "-35" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(-35);
  });

  it("un campo vacio vuelve al valor que tenia", () => {
    const onChange = vi.fn();
    render(<NumberField value={28} onChange={onChange} min={5} max={140} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("28");
  });
});
