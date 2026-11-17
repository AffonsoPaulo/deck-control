import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Grid2x2, List } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field, TextInput } from "@/components/Field";
import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { Stepper } from "@/components/Stepper";
import { Swatches } from "@/components/Swatches";
import { Switch } from "@/components/Switch";

afterEach(cleanup);

describe("Field + TextInput", () => {
  it("o rótulo aponta para o campo e a dica aparece", () => {
    render(<Field label="Host" hint="O endereço do OBS">{(id) => <TextInput id={id} defaultValue="localhost" />}</Field>);
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("localhost");
    expect(screen.getByText("O endereço do OBS")).toBeTruthy();
  });
});

describe("Stepper", () => {
  function Harness({ onChange }: { onChange: (v: number) => void }) {
    const [v, setV] = useState(0.9);
    return <Stepper label="Escala" value={v} min={0.5} max={1} step={0.05} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => { setV(x); onChange(x); }} />;
  }
  it("soma no passo sem erro de ponto flutuante e para no limite", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const plus = screen.getByRole("button", { name: "Increase Escala" });
    await user.click(plus);
    await user.click(plus);
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([0.95, 1]);
    expect(screen.getByText("100%")).toBeTruthy();
    expect((plus as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("group", { name: "Escala" })).toBeTruthy();
  });
});

describe("Switch", () => {
  it("clicar no rótulo liga e o estado sai em aria-checked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Abrir com o Windows" checked={false} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Abrir com o Windows" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByText("Abrir com o Windows"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Segmented", () => {
  it("marca o escolhido com aria-pressed; o de ícones tem nome", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        label="Vista"
        variant="icons"
        value="grid"
        onChange={onChange}
        options={[{ value: "grid", label: "Grade", icon: Grid2x2 }, { value: "list", label: "Lista", icon: List }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Grade" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Lista" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });
});

describe("Select", () => {
  it("devolve o valor escolhido", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select aria-label="Idioma" value="pt-BR" onChange={onChange} options={[{ value: "pt-BR", label: "Português" }, { value: "en", label: "English" }]} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Idioma" }), "en");
    expect(onChange).toHaveBeenCalledWith("en");
  });
});

describe("Swatches", () => {
  const colors = [{ value: "#22336E", label: "Azul" }, { value: "#1d4d37", label: "Verde" }];
  it("marca a cor igual sem ligar para maiúsculas; nenhuma vale null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Swatches label="Fundo" value="#22336e" colors={colors} noneLabel="Nenhuma" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Azul" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Nenhuma" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Nenhuma" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
  it("cor fora da lista acende o 'outra cor' e a janela de cor devolve o valor", () => {
    const onChange = vi.fn();
    render(<Swatches label="Fundo" value="#123456" colors={colors} onChange={onChange} />);
    const input = screen.getByLabelText("Other color") as HTMLInputElement;
    expect(input.value).toBe("#123456");
    expect(input.closest("label")?.hasAttribute("data-pressed")).toBe(true);
    fireEvent.change(input, { target: { value: "#abcdef" } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });
});
