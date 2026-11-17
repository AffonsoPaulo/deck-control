import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chip, LibGroup, LibSub, SizeTile } from "@/components/Library";

afterEach(cleanup);

describe("LibGroup", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <LibGroup label="Teclado e texto" color="var(--cat-blue)" count={3} open={open} onToggle={() => setOpen(!open)}>
        <p>Atalho de teclado</p>
      </LibGroup>
    );
  }

  it("fechado não mostra os filhos; o cabeçalho abre e diz se está aberto", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const head = screen.getByRole("button", { name: /Teclado e texto/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(head.textContent).toContain("3");
    expect(screen.queryByText("Atalho de teclado")).toBeNull();
    await user.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Atalho de teclado")).toBeTruthy();
  });

  it("a cor da categoria vai no --cat do grupo", () => {
    render(<Harness />);
    const section = screen.getByRole("button", { name: /Teclado/ }).closest("section");
    expect(section?.style.getPropertyValue("--cat")).toBe("var(--cat-blue)");
  });
});

describe("LibSub e Chip", () => {
  it("o subtítulo mostra a origem", () => {
    render(<LibSub origin="plugin" label="Clima" />);
    expect(screen.getByText("Clima")).toBeTruthy();
  });
  it("o chip mostra o caractere do ícone e some para o leitor de tela", () => {
    const { container } = render(<Chip glyph="" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("");
  });
});

describe("SizeTile", () => {
  it("altura da miniatura acompanha as linhas (mínimo 2) e o escolhido sai em aria-pressed", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <>
        <SizeTile label="1×2" rows={1} unit={18} pressed={false} onClick={onClick}>
          <i />
        </SizeTile>
        <SizeTile label="3×3" rows={3} unit={22} pressed note="tira 2 teclas">
          <i />
        </SizeTile>
        <SizeTile label="2×5" rows={2} disabled>
          <i />
        </SizeTile>
      </>,
    );
    const small = screen.getByRole("button", { name: "1×2" });
    expect((small.firstElementChild as HTMLElement).style.height).toBe(`${2 * 18 + 2}px`);
    const big = screen.getByRole("button", { name: /3×3/ });
    expect((big.firstElementChild as HTMLElement).style.height).toBe(`${3 * 22 + 4}px`);
    expect(big.getAttribute("aria-pressed")).toBe("true");
    expect(big.textContent).toContain("tira 2 teclas");
    await user.click(small);
    expect(onClick).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "2×5" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
