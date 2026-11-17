import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetHead } from "@/components/Sheet";
import { Toaster } from "@/components/Toaster";
import { anyOverlayOpen } from "@/core/overlay";
import { hideToast, pauseToast, resumeToast, toast, useToast } from "@/core/toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useToast.setState({ current: null, leaving: false });
});

describe("Sheet", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>abrir</button>
        <Sheet open={open} onOpenChange={setOpen} label="Escolher ícone">
          <SheetHead>
            <input type="search" aria-label="Buscar" />
          </SheetHead>
          <p>grade</p>
        </Sheet>
      </>
    );
  }

  it("abre como diálogo com nome, trava os atalhos e fecha no X devolvendo o foco", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "abrir" });
    await user.click(opener);
    expect(await screen.findByRole("dialog", { name: "Escolher ícone" })).toBeTruthy();
    expect(anyOverlayOpen()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(anyOverlayOpen()).toBe(false);
  });

  it("Esc fecha", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "abrir" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("toast", () => {
  const shown = () => screen.queryByRole("status")?.textContent ?? "";

  it("some sozinho em 2,6 s; o novo troca o anterior", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => toast("Salvo"));
    expect(shown()).toBe("Salvo");
    act(() => toast("Copiado"));
    expect(shown()).toBe("Copiado");
    act(() => vi.advanceTimersByTime(2599));
    expect(shown()).toBe("Copiado");
    act(() => vi.advanceTimersByTime(1 + 160));
    expect(shown()).toBe("");
  });

  it("com botão fica 6 s; o botão roda e fecha", () => {
    vi.useFakeTimers();
    const undo = vi.fn();
    render(<Toaster />);
    act(() => toast("Tecla apagada", { undo: { label: "Desfazer", run: undo } }));
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(undo).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(160));
    expect(shown()).toBe("");
  });

  it("com o mouse em cima o tempo para; ao sair volta com pelo menos 1,5 s", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => toast("Página apagada", { long: true }));
    act(() => vi.advanceTimersByTime(9500));
    act(() => pauseToast());
    act(() => vi.advanceTimersByTime(60000));
    expect(shown()).toBe("Página apagada");
    act(() => resumeToast());
    act(() => vi.advanceTimersByTime(1499));
    expect(shown()).toBe("Página apagada");
    act(() => vi.advanceTimersByTime(1 + 160));
    expect(shown()).toBe("");
  });

  it("o fixo não some sozinho", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => toast("Sem conexão", { bad: true, sticky: true }));
    act(() => vi.advanceTimersByTime(60000));
    expect(shown()).toBe("Sem conexão");
    act(() => hideToast());
    act(() => vi.advanceTimersByTime(160));
    expect(shown()).toBe("");
  });
});
