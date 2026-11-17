// Aba Aparência da tecla simples: a prévia grande, "Ativa quando" e qual aparência editar (normal ou ligada), e o
// editor do ícone: o que vai no centro (ícone, imagem ou só texto), texto e posição, cores (fundo liso ou degradê,
// texto, borda) e tamanhos. Mesmas regras do editor atual (lookTab, iconEditor, backgroundEditor, sizesSection).
// Cada campo que muda a cada tecla/arrasto junta as mudanças numa entrada do desfazer (tag).
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  CircleDot,
  Image as ImageIcon,
  RotateCcw,
  Search,
  Shapes,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/Card";
import { TextArea } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { RangeRow } from "@/components/RangeRow";
import { IconPicker, useLucideIndex, usePopularIcons } from "@/components/IconPicker";
import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { Swatches, useKeySwatches } from "@/components/Swatches";
import { Switch } from "@/components/Switch";
import { api } from "@/core/api";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { glyphChar, luChar } from "@/core/icons/lucide";
import { isObj, normalizeIcon, type Obj } from "@/core/obj";
import { useObs, useSchema } from "@/core/queries";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { toast } from "@/core/toast";
import { darker } from "@/features/keys/actions";
import { draftKeys, uploadImage } from "@/features/keys/keys";
import { LAYOUT_DEFAULTS, activeWhenOptions, borderSwatches, centerMode, fgSwatches, keyHasState, patchIcon, type CenterMode, type GradDir } from "@/features/keys/look";
import type { KeySpec } from "@/features/keys/model";
import { isCells, type KeyPreview } from "@/features/keys/previews";
import { useSession } from "@/features/keys/session";

// ---------------------------------------------------------------------------- peças pequenas

export function SectionHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="text-base font-bold text-fg">{title}</span>
      {sub && <span className="text-sm text-fg-subtle">{sub}</span>}
      {children}
    </div>
  );
}

export const Hint = ({ children }: { children: ReactNode }) => <p className="m-0 text-xs leading-4.25 text-fg-subtle">{children}</p>;

export function ColorRow({ label, children, flush }: { label: string; children: ReactNode; flush?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-23 flex-none text-sm leading-7.5 text-fg-muted">{label}</span>
      <div className={cn("min-w-0 flex-1", !flush && "pt-0.75")}>{children}</div>
    </div>
  );
}

/** Escolher um arquivo de imagem e mandar para o app. */
function useImagePick(onPath: (path: string) => void) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const el = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        uploadImage(f)
          .then(onPath)
          .catch((err: unknown) => toast(t("Error sending the image: ") + (err as Error).message, { bad: true }));
      }}
    />
  );
  return { el, open: () => input.current?.click() };
}

// ---------------------------------------------------------------------------- a aba

interface LookTabProps {
  page: string;
  k: string;
  spec: KeySpec;
  preview: KeyPreview;
}

export function LookTab({ page, k, spec, preview }: LookTabProps) {
  const t = useT();
  const schema = useSchema().data;
  const cfg = useConfig((s) => s.cfg);
  const obs = useObs();
  const lookModeUi = useUi((s) => s.lookMode);
  const go = useUi((s) => s.go);
  const edit = useConfig((s) => s.edit);
  const hasState = keyHasState(schema, spec);
  const lookMode = hasState ? lookModeUi : "normal";
  const big = preview && !isCells(preview) ? (lookMode === "active" && preview.active ? preview.active : preview.normal) : null;
  const setKey = (recipe: (s: KeySpec) => void, tag?: string) =>
    edit((d) => {
      const s = draftKeys(d, page)[k];
      if (s) recipe(s);
    }, tag);

  return (
    <div className="grid gap-6 p-4">
      <div className="flex items-center gap-5">
        {big ? <img className="deck-look-img" src={big} alt={t("Key preview")} /> : <span className="deck-look-img" />}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {hasState && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-fg-subtle">{t("Editing the appearance")}</span>
              <Segmented
                variant="full"
                label={t("Which appearance to edit")}
                value={lookMode}
                onChange={(v) => go({ lookMode: v })}
                options={[
                  { value: "normal", label: t("Normal") },
                  { value: "active", label: t("When active") },
                ]}
              />
            </div>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-fg-subtle">{t("Active when")}</span>
            <Select
              aria-label={t("When the key becomes active")}
              value={typeof spec.state === "string" ? spec.state : ""}
              onChange={(v) =>
                setKey((s) => {
                  if (v) s.state = v;
                  else Reflect.deleteProperty(s, "state");
                })
              }
              options={activeWhenOptions(t, schema, cfg, obs, spec).map(([value, label]) => ({ value, label }))}
            />
          </label>
        </div>
      </div>
      {lookMode === "active" ? (
        <IconEditor
          key={`${page}:${k}:active`}
          id={`${page}:${k}`}
          icon={normalizeIcon(spec.active_icon)}
          override
          base={normalizeIcon(spec.icon)}
          onChange={(v, tag) =>
            setKey((s) => {
              if (Object.keys(v).length) s.active_icon = v;
              else Reflect.deleteProperty(s, "active_icon");
            }, tag)
          }
        />
      ) : (
        <IconEditor key={`${page}:${k}:normal`} id={`${page}:${k}`} icon={normalizeIcon(spec.icon)} onChange={(v, tag) => setKey((s) => (s.icon = v), tag)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- o editor do ícone

interface IconEditorProps {
  id: string; // "página:tecla" (a lembrança do ícone/imagem e as tags do desfazer)
  icon: Obj;
  onChange: (icon: Obj, tag?: string) => void;
  override?: boolean; // aparência "quando ativa": só o que muda
  base?: Obj; // a aparência normal (para mostrar o que vale quando o campo fica vazio)
}

function IconEditor({ id, icon, onChange, override: ov = false, base = {} }: IconEditorProps) {
  const t = useT();
  const remember = useSession((s) => s.remember);
  const [picker, setPicker] = useState<((name: string) => void) | null>(null);
  const set = (k: string, v: unknown, tag?: string) => onChange(patchIcon(icon, { [k]: v }), tag);
  const setMany = (patch: Obj) => onChange(patchIcon(icon, patch));
  const imageDone = useRef<((path: string) => void) | null>(null);
  const image = useImagePick((path) => imageDone.current?.(path));
  const pickImage = (done: (path: string) => void) => {
    imageDone.current = done;
    image.open();
  };
  const openPicker = (done: (name: string) => void) => setPicker(() => done);
  const mode: CenterMode | null = ov ? null : centerMode(icon);
  const filled = !ov && !!icon.image && !!icon.image_fill;
  const tag = (field: string) => `look:${id}:${ov ? "active" : "normal"}:${field}`;

  const pickMode = (m: CenterMode) => {
    if (m === mode) return;
    const mem = useSession.getState().lookMem[id] ?? {};
    // guarda o que estava, para voltar sem perder
    if (icon.lucide || icon.glyph) remember(id, { icon: { lucide: icon.lucide ?? null, glyph: icon.glyph ?? null } });
    if (icon.image) remember(id, { image: icon.image, fill: icon.image_fill });
    if (m === "text") return setMany({ lucide: null, glyph: null, image: null, image_fill: null });
    if (m === "icon") {
      if (mem.icon) return setMany({ image: null, image_fill: null, ...mem.icon });
      return openPicker((c) => setMany({ image: null, image_fill: null, lucide: c, glyph: null }));
    }
    if (mem.image) return setMany({ lucide: null, glyph: null, image: mem.image, image_fill: mem.fill ?? null });
    pickImage((p) => setMany({ lucide: null, glyph: null, image: p }));
  };

  return (
    <div className="flex flex-col gap-6">
      {image.el}
      <IconPicker open={picker !== null} onOpenChange={(o) => !o && setPicker(null)} onPick={(name) => picker?.(name)} />
      {ov && <Hint>{t("Fill in only what changes when the key is active. Everything else stays the same as normal.")}</Hint>}

      {/* o que vai no centro da tecla */}
      {!ov ? (
        <section className="flex flex-col gap-2.5">
          <SectionHead title={t("In the center of the key")} />
          <Segmented
            variant="full"
            label={t("What goes in the center of the key")}
            value={mode ?? "text"}
            onChange={pickMode}
            options={[
              { value: "icon", label: t("Icon"), icon: Shapes },
              { value: "image", label: t("Image"), icon: ImageIcon },
              { value: "text", label: t("Text only"), icon: Type },
            ]}
          />
          {mode === "icon" && <GlyphCard icon={icon} onChoose={() => openPicker((c) => setMany({ lucide: c, glyph: null }))} />}
          {mode === "image" && (
            <>
              <ImageCard
                path={String(icon.image)}
                onChange={() => pickImage((p) => setMany({ image: p }))}
                onRemove={() => {
                  remember(id, { image: null });
                  setMany({ image: null, image_fill: null });
                }}
              />
              <Switch label={t("Fill the whole key")} checked={!!icon.image_fill} onChange={(on) => setMany({ image_fill: on || null })} />
              {!!icon.image_fill && (
                <Hint>{t("The image covers the whole key, so text, background and sizes don't show. Turn this off to use the image as an icon, with text below.")}</Hint>
              )}
            </>
          )}
          {mode === "text" && <Hint>{t("Without an icon, the text sits in the center of the key, larger, in up to 3 lines.")}</Hint>}
        </section>
      ) : (
        <section className="flex flex-col gap-2.5">
          <SectionHead title={t("Icon")} />
          {icon.lucide || icon.glyph ? (
            <GlyphCard icon={icon} onChoose={() => openPicker((c) => setMany({ lucide: c, glyph: null }))} onRemove={() => setMany({ lucide: null, glyph: null })} />
          ) : (
            <Card
              onClick={() => openPicker((c) => setMany({ lucide: c, glyph: null }))}
              thumb={<Icon icon={Shapes} size="lg" className="text-fg-muted" />}
              title={t("Same as normal")}
              sub={t("Click to use a different one when active")}
              actions={
                <span aria-hidden className="grid size-control-sm place-items-center text-fg-muted">
                  <Icon icon={Search} />
                </span>
              }
            />
          )}
        </section>
      )}

      {/* texto */}
      {!filled && (
        <section className="flex flex-col gap-2.5">
          <SectionHead title={t("Text")} />
          <TextArea
            rows={mode === "text" ? 3 : 2}
            aria-label={t("Key text")}
            placeholder={ov ? t("same as normal{0}", [base.text ? ` (${String(base.text).replace(/\n/g, " ")})` : ""]) : t("Enter adds a line")}
            value={typeof icon.text === "string" ? icon.text : icon.text === undefined ? "" : String(icon.text)}
            onChange={(e) => set("text", e.target.value || null, tag("text"))}
          />
          {!ov && mode !== "text" && <PositionPicker value={typeof icon.style === "string" ? icon.style : null} onPick={(v) => setMany({ style: v })} />}
        </section>
      )}

      {/* cores */}
      <section className="flex flex-col gap-2.5">
        <SectionHead title={filled ? t("Border") : t("Colors")} />
        {filled ? (
          <Swatches label={t("Border")} value={str(icon.border)} onChange={(v) => set("border", v)} colors={borderSwatches(t)} noneLabel={t("None")} />
        ) : (
          <>
            <ColorRow label={t("Background")} flush>
              <BackgroundEditor icon={icon} base={base} override={ov} set={set} setMany={setMany} tag={tag} />
            </ColorRow>
            <ColorRow label={mode === "text" ? t("Text") : t("Text and icon")}>
              <Swatches label={mode === "text" ? t("Text") : t("Text and icon")} value={str(icon.fg)} onChange={(v) => set("fg", v)} colors={fgSwatches(t)} noneLabel={ov ? t("Same as normal") : t("White (default)")} />
            </ColorRow>
            <ColorRow label={t("Border")}>
              <Swatches label={t("Border")} value={str(icon.border)} onChange={(v) => set("border", v)} colors={borderSwatches(t)} noneLabel={ov ? t("Same as normal") : t("None")} />
            </ColorRow>
          </>
        )}
      </section>

      {/* tamanhos */}
      {!ov && !filled && mode && <SizesSection icon={icon} mode={mode} set={set} setMany={setMany} tag={tag} />}
    </div>
  );
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// ---------------------------------------------------------------------------- ícone e imagem

export function GlyphCard({ icon, onChoose, onRemove }: { icon: Obj; onChoose: () => void; onRemove?: () => void }) {
  const t = useT();
  const idx = useLucideIndex();
  const popular = usePopularIcons();
  const lucide = typeof icon.lucide === "string" ? icon.lucide : null;
  const legacy = !lucide && !!icon.glyph; // formato antigo (Segoe): ainda aparece, até trocar
  const name = lucide ? (popular.names[lucide] ?? lucide.replace(/-/g, " ")) : t("Old icon");
  const choose = t("Choose another icon");
  return (
    <Card
      thumb={
        <button type="button" title={choose} aria-label={choose} onClick={onChoose} className="grid size-full cursor-pointer place-items-center">
          <span aria-hidden className={cn("text-(length:--icon-xl) leading-none", legacy ? "font-glyph" : "font-lucide")}>
            {legacy ? glyphChar(icon.glyph) : idx && lucide ? luChar(idx, lucide) : ""}
          </span>
        </button>
      }
      title={name}
      sub={legacy ? t("Segoe {0}: replace it with a Lucide one", [String(icon.glyph).toUpperCase()]) : lucide}
      actions={
        <>
          <IconButton icon={Search} size="sm" label={choose} onClick={onChoose} />
          {onRemove && <IconButton icon={Trash2} size="sm" label={t("Remove icon")} onClick={onRemove} />}
        </>
      }
    />
  );
}

export function ImageCard({ path, onChange, onRemove }: { path: string; onChange: () => void; onRemove: () => void }) {
  const t = useT();
  const info = useQuery({ queryKey: ["image_info", path], queryFn: () => api("POST /api/image_info", { path }), staleTime: Infinity, retry: false }).data;
  const missing = !!info && "missing" in info;
  const sub = !info ? "" : "missing" in info ? t("File not found") : info.frames > 1 ? t("Animated GIF, {0} frames", [info.frames]) : t("{0} × {1} px", [info.width, info.height]);
  return (
    <Card
      thumb={info && "thumb" in info && info.thumb ? <img src={info.thumb} alt="" className="block size-11 object-cover" /> : <Icon icon={ImageIcon} size="lg" className="text-fg-muted" />}
      title={path.split(/[\\/]/).pop()}
      sub={sub}
      subBad={missing}
      actions={
        <>
          <IconButton icon={Upload} size="sm" label={t("Change image")} onClick={onChange} />
          <IconButton icon={Trash2} size="sm" label={t("Remove image")} onClick={onRemove} />
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------- posição do texto

function PositionPicker({ value, onPick }: { value: string | null; onPick: (v: string | null) => void }) {
  const t = useT();
  const icons = useConfig((s) => s.cfg?.icons);
  const def = (isObj(icons) && typeof icons.style === "string" && icons.style) || "below";
  const cur = value ?? def;
  const dot = <i className="block size-4 rounded-full bg-key-fg" />;
  const bar = <i className="block h-1 w-6 rounded-xs bg-key-fg" />;
  const art: Record<string, ReactNode> = {
    below: (
      <>
        {dot}
        {bar}
      </>
    ),
    top: (
      <>
        {bar}
        {dot}
      </>
    ),
    big: <i className="block size-6 rounded-full bg-key-fg" />,
  };
  const items: [string, string][] = [
    ["below", t("Below")],
    ["top", t("Above")],
    ["big", t("Hide")],
  ];
  return (
    <div role="group" aria-label={t("Text position")} className="grid grid-cols-3 gap-2">
      {items.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={cur === v}
          title={v === "big" ? t("Hides the text and enlarges the icon") : t("Text {0}", [l.toLowerCase()])}
          onClick={() => onPick(v === def ? null : v)}
          className="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-border bg-surface pt-2 pb-1.75 text-xs font-semibold text-fg-muted hover:border-border-strong aria-pressed:border-accent aria-pressed:text-fg aria-pressed:inset-ring aria-pressed:inset-ring-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden className="flex size-10 flex-col items-center justify-center gap-1 rounded-sm bg-key-graphite">
            {art[v]}
          </span>
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------- fundo

interface BgProps {
  icon: Obj;
  base: Obj;
  override: boolean;
  set: (k: string, v: unknown, tag?: string) => void;
  setMany: (patch: Obj) => void;
  tag: (field: string) => string;
}

function BackgroundEditor({ icon, base, override: ov, set, setMany, tag }: BgProps) {
  const t = useT();
  const keys = useKeySwatches();
  const keyBg = keys[0]?.value ?? "#1D2330";
  const grad = !!icon.bg_to || (ov && icon.bg_to === undefined && !!base.bg_to && icon.bg === undefined);
  const from = str(icon.bg) ?? str(base.bg) ?? keyBg;
  const to = str(icon.bg_to) ?? str(base.bg_to) ?? "#000000";
  const dir = (str(icon.bg_dir) ?? str(base.bg_dir) ?? "down") as GradDir;
  return (
    <div className="flex flex-col items-start gap-2.5">
      <Segmented
        variant="small"
        label={t("Background type")}
        value={grad ? "gradient" : "solid"}
        onChange={(v) => {
          if (v === "solid" && grad) setMany({ bg_to: ov && base.bg_to ? "" : null, bg_dir: null });
          if (v === "gradient" && !grad) setMany({ bg: from, bg_to: darker(from), bg_dir: str(icon.bg_dir) });
        }}
        options={[
          { value: "solid", label: t("Solid color") },
          { value: "gradient", label: t("Gradient") },
        ]}
      />
      {!grad ? (
        <Swatches label={t("Background")} value={str(icon.bg)} onChange={(v) => set("bg", v)} colors={keys} {...(ov ? { noneLabel: t("Same as normal") } : {})} />
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <ColorPill value={from} label={t("Start color")} onPick={(v) => set("bg", v, tag("bg"))} />
            <IconButton icon={ArrowLeftRight} size="sm" label={t("Swap the colors")} onClick={() => setMany({ bg: to, bg_to: from })} />
            <ColorPill value={to} label={t("End color")} onPick={(v) => set("bg_to", v, tag("bg_to"))} />
          </div>
          <Segmented
            variant="icons"
            label={t("Gradient direction")}
            value={dir}
            onChange={(v) => setMany({ bg_dir: v === "down" ? null : v })}
            options={[
              { value: "down", label: t("Top to bottom"), icon: ArrowDown },
              { value: "right", label: t("Left to right"), icon: ArrowRight },
              { value: "diagonal", label: t("Diagonal"), icon: ArrowDownRight },
              { value: "radial", label: t("From the center out"), icon: CircleDot },
            ]}
          />
        </>
      )}
    </div>
  );
}

/** Uma cor do degradê: a amostra, o código e a janela de cor do sistema por cima. */
function ColorPill({ value, label, onPick }: { value: string; label: string; onPick: (v: string) => void }) {
  return (
    <label
      title={label}
      className="relative inline-flex h-control-md cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface pr-2.5 pl-1 text-sm font-medium tabular-nums"
    >
      <i className="block size-6 rounded-sm inset-ring inset-ring-tint-line" style={{ background: value }} />
      <span>{value.replace("#", "").toUpperCase()}</span>
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#888888"}
        onChange={(e) => onPick(e.target.value.toUpperCase())}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------- tamanhos

interface SizesProps {
  icon: Obj;
  mode: CenterMode;
  set: (k: string, v: unknown, tag?: string) => void;
  setMany: (patch: Obj) => void;
  tag: (field: string) => string;
}

function SizesSection({ icon, mode, set, setMany, tag }: SizesProps) {
  const t = useT();
  const icons = useConfig((s) => s.cfg?.icons);
  const sizesOpen = useSession((s) => s.sizesOpen);
  const setSizesOpen = useSession((s) => s.setSizesOpen);
  const cfgIcons = isObj(icons) ? icons : {};
  const textPos = str(icon.style) ?? str(cfgIcons.style) ?? "below";
  const layout = LAYOUT_DEFAULTS[textPos] ?? { glyph: 48, image: 0.5 };
  const textDef = Number(cfgIcons.text_size || 16) * (mode === "text" ? 1.4 : 1);
  const custom = !!(icon.text_size || icon.glyph_size || icon.image_scale);
  const open = sizesOpen ?? custom;
  const slider = (label: string, key: string, min: number, max: number, step: number, def: number, fmt: (v: number) => string) => {
    const raw = icon[key];
    const val = typeof raw === "number" ? raw : def;
    return <RangeRow key={key} label={label} min={min} max={max} step={step} value={val} onChange={(v) => set(key, v, tag(key))} shown={raw == null ? "auto" : fmt(val)} />;
  };
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex min-h-7 items-center gap-2">
        <button type="button" aria-expanded={open} onClick={() => setSizesOpen(!open)} className="inline-flex cursor-pointer items-center gap-2">
          <span className="text-base font-bold text-fg">{t("Sizes")}</span>
          <span className="text-sm text-fg-subtle">{custom ? t("adjusted") : t("automatic")}</span>
        </button>
        <span className="flex-1" />
        {custom && <IconButton icon={RotateCcw} size="sm" label={t("Back to automatic")} onClick={() => setMany({ text_size: null, glyph_size: null, image_scale: null })} />}
        <IconButton
          icon={ChevronDown}
          size="sm"
          label={open ? t("Hide sizes") : t("Show sizes")}
          onClick={() => setSizesOpen(!open)}
          className={cn("motion-safe:transition-transform", open && "rotate-180")}
        />
      </div>
      {open && (
        <>
          {(icon.text || mode === "text") && slider(t("Text"), "text_size", 9, 40, 1, Math.round(textDef), String)}
          {mode === "icon" && slider(t("Icon"), "glyph_size", 20, 96, 1, layout.glyph, String)}
          {mode === "image" && slider(t("Image"), "image_scale", 0.2, 1, 0.05, layout.image, (v) => `${Math.round(v * 100)}%`)}
        </>
      )}
    </section>
  );
}
