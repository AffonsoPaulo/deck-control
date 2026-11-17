// Galeria dos componentes (só em desenvolvimento: npm run dev, #...&dev=components). Serve para comparar com o
// editor atual, peça por peça. Não entra no build que o app serve.
import { Copy, Ellipsis, House, MonitorUp, Pencil, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { ContextMenuArea, MenuButton, type MenuEntry } from "@/components/Menu";
import { useT } from "@/core/i18n";

export function Gallery() {
  const t = useT();
  const pageMenu: MenuEntry[] = [
    { type: "head", label: t("Page {0}", ["main"]) },
    { label: t("Rename"), icon: Pencil },
    { label: t("Use as home page"), icon: House, disabled: true },
    { label: t("Show on Deck"), icon: MonitorUp },
    { type: "separator" },
    {
      label: t("Delete page…"),
      icon: Trash2,
      danger: true,
      confirm: {
        title: t('Delete page "{0}"?', ["main"]),
        text: t("Its {0} keys go with it. You can undo right after, or from the history.", [15]),
        confirmLabel: t("Delete page"),
        confirmIcon: Trash2,
        onConfirm: () => {},
      },
    },
  ];
  const keyMenu: MenuEntry[] = [
    { label: t("Copy"), icon: Copy, kbd: "Ctrl+C" },
    { label: t("Paste"), icon: Copy, kbd: "Ctrl+V", disabled: true },
    { label: t("Save key"), icon: Save },
    { type: "separator" },
    { label: t("Delete key"), icon: Trash2, kbd: "Del", danger: true },
  ];
  return (
    <main className="flex min-h-dvh flex-col gap-8 bg-canvas p-8 text-fg">
      <section className="flex flex-col gap-3" data-gallery="buttons">
        <h2 className="m-0 text-lg font-bold">Botões</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Normal</Button>
          <Button variant="primary">Primário</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="danger" icon={Trash2}>Texto vermelho</Button>
          <Button variant="solidDanger" icon={Trash2}>Vermelho</Button>
          <Button disabled>Desativado</Button>
          <Button size="sm">Pequeno</Button>
          <Button size="sm" variant="solidDanger" icon={Trash2}>Excluir página</Button>
        </div>
      </section>
      <section className="flex flex-col gap-3" data-gallery="menus">
        <h2 className="m-0 text-lg font-bold">Menus</h2>
        <div className="flex items-center gap-6">
          <MenuButton label={t("Page options")} items={pageMenu} trigger={<IconButton icon={Ellipsis} label={t("Page options")} size="sm" />} />
          <ContextMenuArea label={t("Key {0}", [1])} items={keyMenu} className="grid size-21 place-items-center rounded-lg bg-key-graphite text-sm">
            botão direito
          </ContextMenuArea>
        </div>
      </section>
    </main>
  );
}
