// Galeria dos componentes (só em desenvolvimento: npm run dev, #...&dev=components). Serve para comparar com o
// editor atual, peça por peça. Não entra no build que o app serve.
import { Copy, Ellipsis, Grid2x2, House, List, MonitorUp, Moon, Pencil, Save, Sun, SunMoon, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Field, TextInput } from "@/components/Field";
import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { Stepper } from "@/components/Stepper";
import { Swatches, useKeySwatches } from "@/components/Swatches";
import { Switch } from "@/components/Switch";
import { IconButton } from "@/components/IconButton";
import { ContextMenuArea, MenuButton, type MenuEntry } from "@/components/Menu";
import { useT } from "@/core/i18n";

function Controls() {
  const t = useT();
  const keys = useKeySwatches();
  const [on, setOn] = useState(false);
  const [on2, setOn2] = useState(true);
  const [scale, setScale] = useState(0.9);
  const [theme, setTheme] = useState("system");
  const [style, setStyle] = useState("icon");
  const [view, setView] = useState("grid");
  const [size, setSize] = useState("m");
  const [color, setColor] = useState<string | null>(keys[1]?.value ?? null);
  const [lang, setLang] = useState("pt-BR");
  return (
    <section className="flex max-w-180 flex-col gap-6" data-gallery="controls">
      <h2 className="m-0 text-lg font-bold">Controles</h2>
      <div data-spec="switch" className="w-130">
        <Switch label={t("Start with Windows")} checked={on} onChange={setOn} />
      </div>
      <div className="w-130">
        <Switch label="Ligado" checked={on2} onChange={setOn2} />
      </div>
      <div data-spec="select" className="w-64">
        <Select aria-label={t("Language")} value={lang} onChange={setLang} options={[{ value: "pt-BR", label: "Português (Brasil)" }, { value: "en", label: "English" }]} />
      </div>
      <div data-spec="pills">
        <Segmented variant="pills" label={t("Theme")} value={theme} onChange={setTheme} options={[{ value: "system", label: t("Follow Windows"), icon: SunMoon }, { value: "dark", label: t("Dark"), icon: Moon }, { value: "light", label: t("Light"), icon: Sun }]} />
      </div>
      <div data-spec="stepper">
        <Stepper label={t("Scale")} value={scale} min={0.5} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={setScale} />
      </div>
      <div data-spec="input" className="w-64">
        <Field label="Host" hint={t("Default")}>{(id) => <TextInput id={id} defaultValue="localhost" />}</Field>
      </div>
      <div data-spec="seg-full" className="w-66">
        <Segmented variant="full" label={t("Style")} value={style} onChange={setStyle} options={[{ value: "icon", label: t("Icon") }, { value: "text", label: t("Text") }]} />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Segmented label={t("View")} value={view} onChange={setView} options={[{ value: "grid", label: t("Deck") }, { value: "list", label: t("List") }]} />
        <Segmented variant="icons" label={t("View")} value={view} onChange={setView} options={[{ value: "grid", label: t("Deck"), icon: Grid2x2 }, { value: "list", label: t("List"), icon: List }]} />
        <Segmented variant="small" label={t("Size")} value={size} onChange={setSize} options={[{ value: "s", label: "P" }, { value: "m", label: "M" }, { value: "l", label: "G" }]} />
      </div>
      <div data-spec="swatches" className="w-73">
        <Swatches label={t("Background")} value={color} onChange={setColor} colors={keys} />
      </div>
      <Swatches label={t("Border")} value={null} onChange={() => {}} colors={keys.slice(0, 4)} noneLabel={t("None")} />
    </section>
  );
}

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
      <Controls />
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
