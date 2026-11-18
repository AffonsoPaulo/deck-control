import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "@/components/IconButton";
import { ContextMenuArea, MenuButton, type MenuEntry } from "@/components/Menu";
import { anyOverlayOpen } from "@/core/overlay";

afterEach(cleanup);

function setup(onRename = vi.fn(), onDelete = vi.fn()) {
  const items: MenuEntry[] = [
    { type: "head", label: "Página main" },
    { label: "Renomear", icon: Pencil, kbd: "F2", onSelect: onRename },
    { label: "Usar como inicial", disabled: true, onSelect: vi.fn() },
    { type: "separator" },
    {
      label: "Excluir página…",
      icon: Trash2,
      danger: true,
      confirm: { title: 'Excluir a página "main"?', text: "As 5 teclas vão junto.", confirmLabel: "Excluir página", onConfirm: onDelete },
    },
  ];
  render(<MenuButton label="Opções da página" items={items} trigger={<IconButton icon={Ellipsis} label="Opções da página" />} />);
  return { onRename, onDelete };
}

describe("MenuButton", () => {
  it("abre com cabeçalho, itens, atalho, desativado e separador", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole("button", { name: "Opções da página" });
    await user.click(trigger);
    expect(await screen.findByRole("menu", { name: "Opções da página" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual(["RenomearF2", "Usar como inicial", "Excluir página…"]);
    expect(screen.getByRole("menuitem", { name: /Usar como inicial/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Página main")).toBeTruthy();
    expect(anyOverlayOpen()).toBe(true); // os atalhos globais ficam quietos
  });

  it("escolher um item roda a ação e fecha", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.click(screen.getByRole("button", { name: "Opções da página" }));
    await user.click(await screen.findByRole("menuitem", { name: /Renomear/ }));
    expect(onRename).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(anyOverlayOpen()).toBe(false));
  });

  it("item desativado não roda", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Opções da página" }));
    const item = await screen.findByRole("menuitem", { name: /Usar como inicial/ });
    await user.click(item);
    expect(screen.queryByRole("menu")).toBeTruthy(); // continua aberto
  });

  it("setas andam pelos itens e Esc fecha", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Opções da página" }));
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/Renomear|Excluir/));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("item com confirmação: abre a confirmação com o foco em Cancelar; Cancelar não exclui", async () => {
    const user = userEvent.setup();
    const { onDelete } = setup();
    await user.click(screen.getByRole("button", { name: "Opções da página" }));
    await user.click(await screen.findByRole("menuitem", { name: /Excluir página/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain('Excluir a página "main"?');
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    expect(anyOverlayOpen()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("confirmar exclui", async () => {
    const user = userEvent.setup();
    const { onDelete } = setup();
    await user.click(screen.getByRole("button", { name: "Opções da página" }));
    await user.click(await screen.findByRole("menuitem", { name: /Excluir página/ }));
    await user.click(await screen.findByRole("button", { name: "Excluir página" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});

describe("ContextMenuArea", () => {
  it("abre no botão direito", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(
      <ContextMenuArea label="Tecla 3" items={[{ label: "Copiar", kbd: "Ctrl+C", onSelect: onCopy }]}>
        <div>tecla 3</div>
      </ContextMenuArea>,
    );
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("tecla 3") });
    await user.click(await screen.findByRole("menuitem", { name: /Copiar/ }));
    expect(onCopy).toHaveBeenCalledOnce();
  });
});
