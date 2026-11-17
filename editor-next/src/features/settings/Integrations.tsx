// Config › Integrações (o setIntegrations do editor atual): um bloco por plugin (OBS, Discord e os de terceiros),
// todos no mesmo formato. Liga/desliga no topo (os dados ficam guardados quando desliga), "Como configurar" em
// passos e as configurações que o plugin declara no plugin.json. Plugin de terceiro: instalar (.zip, com
// confirmação: é um programa rodando no PC) e remover.
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, CircleAlert, Download, LayoutGrid, RefreshCw, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { catStyle } from "@/components/Library";
import { NamedIcon } from "@/components/NamedIcon";
import { NoteBox } from "@/components/NoteBox";
import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { Switch } from "@/components/Switch";
import { api } from "@/core/api";
import type { EditorSchema, PluginInspect } from "@/core/api-types";
import { cn } from "@/core/cn";
import { useT } from "@/core/i18n";
import { isObj, type Obj } from "@/core/obj";
import { useObs, useSchema, useStatus } from "@/core/queries";
import { useConfig, type Config } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { toast } from "@/core/toast";
import { otherPlaces, useValidationState } from "@/core/validation";
import { widgetDefs } from "@/features/keys/actions";
import { useLib } from "@/features/keys/libStore";
import { SendRow } from "@/features/keys/logic/BindField";
import { sizeColsRows } from "@/features/keys/actions";
import { useThumbs } from "@/features/keys/thumbs";
import { placeText } from "@/features/keys/validation";
import { WidgetThumb } from "@/features/keys/WidgetThumb";
import { HINT, LEAD, SetRow, SetSection, SetSwitch, pickFile, setOrDelete } from "@/features/settings/parts";

type T = ReturnType<typeof useT>;
type Plugin = Obj & { id: string; name: string };
interface Setting {
  name: string;
  kind?: string;
  label?: string;
  help?: string;
  placeholder?: string;
  default?: unknown;
  options?: [string, string][];
  style?: string;
  step?: number;
  half?: boolean;
  when?: Obj;
}

const settingsOf = (pl: Plugin): Setting[] => (Array.isArray(pl.settings) ? (pl.settings as Setting[]) : []);
const pathOf = (pl: Plugin): string[] => (Array.isArray(pl.config_path) ? (pl.config_path as string[]) : [pl.id]);

function cfgAt(cfg: Config | null, path: string[], create: boolean): Obj | null {
  let node: Obj | null = cfg;
  for (const k of path) {
    if (!node) return null;
    if (!isObj(node[k])) {
      if (!create) return null;
      node[k] = {};
    }
    node = node[k] as Obj;
  }
  return node;
}
const pluginOn = (cfg: Config | null, pl: Plugin) => {
  const sec = cfgAt(cfg, pathOf(pl), false);
  return sec ? sec.enabled !== false : !!pl.default_enabled;
};
const pluginValue = (cfg: Config | null, pl: Plugin, st: Setting) => cfgAt(cfg, pathOf(pl), false)?.[st.name] ?? st.default;
const setValue = (pl: Plugin, name: string, v: unknown, tag?: string) =>
  useConfig.getState().edit((d) => setOrDelete(cfgAt(d, pathOf(pl), true) as Obj, name, v), tag);
function setOn(pl: Plugin, on: boolean) {
  useConfig.getState().edit((d) => {
    const sec = cfgAt(d, pathOf(pl), true) as Obj;
    if (on) {
      for (const st of settingsOf(pl)) if (!(st.name in sec) && st.default !== undefined) sec[st.name] = st.default;
      Reflect.deleteProperty(sec, "enabled");
    } else sec.enabled = false;
  });
}
/** "when": {"mode": "rpc"} mostra o campo (ou passo) só quando a configuração mode for rpc. */
function pluginWhen(cfg: Config | null, pl: Plugin, when: unknown): boolean {
  if (!isObj(when)) return true;
  return Object.entries(when).every(([name, want]) => {
    const st = settingsOf(pl).find((x) => x.name === name) ?? { name };
    const v = pluginValue(cfg, pl, st);
    return Array.isArray(want) ? want.map(String).includes(String(v)) : String(v) === String(want);
  });
}
/** Texto dos passos: **assim** vira destaque e {nome} vira o valor da configuração. */
function RichStep({ text, cfg, pl }: { text: string; cfg: Config | null; pl: Plugin }) {
  const filled = text.replace(/\{(\w+)\}/g, (m, n: string) => {
    const st = settingsOf(pl).find((x) => x.name === n);
    return st ? String(pluginValue(cfg, pl, st) ?? "") : m;
  });
  return (
    <>
      {filled.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <b key={i} className="font-semibold text-fg">
            {part.slice(2, -2)}
          </b>
        ) : (
          part
        ),
      )}
    </>
  );
}

const byLine = (t: T, author: unknown, version: unknown) =>
  author ? t("By {0}, version {1}", [String(author), String(version ?? "?")]) : t("Version {0}", [String(version ?? "?")]);

function Head({ name, icon, color, meta, children }: { name: string; icon: unknown; color: unknown; meta: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3" style={catStyle(typeof color === "string" ? color : "var(--cat-gray)")}>
      <span className="grid size-control-xl flex-none place-items-center rounded-md bg-cat-chip text-cat-ink">
        <NamedIcon name={typeof icon === "string" ? icon : "plug"} size="lg" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-lg font-bold text-fg">{name}</h3>
        <small className="mt-px block text-sm text-fg-subtle">{meta}</small>
      </div>
      {children}
    </div>
  );
}

export function Integrations() {
  const t = useT();
  const schema = useSchema().data;
  const plugins = (schema?.plugins ?? []) as Plugin[];
  const [install, setInstall] = useState<{ file: string; data: string; info: PluginInspect } | null>(null);
  const qc = useQueryClient();
  const applySchema = (s: EditorSchema) => qc.setQueryData(["schema"], s);
  const pick = () =>
    pickFile(".zip", async (file, data) => {
      try {
        setInstall({ file, data, info: await api("POST /api/plugins/inspect", { data }) });
      } catch (e) {
        toast((e as Error).message, { bad: true });
        setInstall(null);
      }
    });
  return (
    <>
      {plugins
        .filter((p) => p.builtin)
        .map((p) => (
          <PluginBlock key={p.id} pl={p} applySchema={applySchema} />
        ))}
      <SetSection title={t("Third-party plugins")}>
        <p className={HINT}>
          {t("Plugins add actions and integrations with other programs. Each one runs as a separate program: if it freezes, the Deck keeps working. Only install plugins from people you trust.")}
        </p>
      </SetSection>
      {plugins
        .filter((p) => !p.builtin)
        .map((p) => (
          <PluginBlock key={p.id} pl={p} applySchema={applySchema} />
        ))}
      {(schema?.plugin_errors ?? []).map((err) => (
        <NoteBox key={err.folder} icon={CircleAlert} tone="bad">
          {t('The folder "{0}" didn\'t load: {1}', [err.folder, err.error])}
        </NoteBox>
      ))}
      {install ? (
        <InstallConfirm
          file={install.file}
          info={install.info}
          onCancel={() => setInstall(null)}
          onInstall={async () => {
            try {
              const r = await api("POST /api/plugins/install", { data: install.data, replace: !!install.info.installed });
              applySchema(r.schema);
              const name = String(install.info.manifest.name ?? r.id);
              setInstall(null);
              toast(t("{0} installed. Enable the plugin to use it.", [name]));
            } catch (e) {
              toast((e as Error).message, { bad: true });
            }
          }}
        />
      ) : (
        <div>
          <Button icon={Upload} onClick={pick}>
            {t("Install plugin (.zip)")}
          </Button>
        </div>
      )}
    </>
  );
}

const BLOCK = "flex flex-col gap-5 rounded-xl bg-surface px-5.5 py-5 inset-ring inset-ring-border";

function PluginBlock({ pl, applySchema }: { pl: Plugin; applySchema: (s: EditorSchema) => void }) {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const obs = useObs();
  const status = useStatus();
  const on = pluginOn(cfg, pl);
  const [helpOpen, setHelpOpen] = useState<boolean | null>(null);
  const [removing, setRemoving] = useState(false);
  const open = helpOpen ?? !on; // desligada: o passo a passo já vem aberto
  const steps = (Array.isArray(pl.steps) ? (pl.steps as unknown[]) : [])
    .map((x) => (isObj(x) ? x : { text: x }))
    .filter((x) => pluginWhen(cfg, pl, x.when))
    .map((x) => String(x.text));
  const fields = settingsOf(pl).filter((x) => pluginWhen(cfg, pl, x.when));
  const rows: Setting[][] = [];
  for (let i = 0; i < fields.length; i++) {
    const a = fields[i] as Setting;
    const b = fields[i + 1];
    if (a.half && b?.half) {
      rows.push([a, b]);
      i++;
    } else rows.push([a]);
  }
  const meta = pl.builtin ? String(pl.description ?? "") : (
    <>
      {String(pl.description ?? "")}
      <span className="mt-0.5 block">{byLine(t, pl.author, pl.version)}</span>
    </>
  );
  const perms = Array.isArray(pl.permissions) ? (pl.permissions as string[]) : [];
  return (
    <section data-plugin={pl.id} className={BLOCK}>
      <Head name={pl.name} icon={pl.icon} color={pl.color} meta={meta}>
        <PluginState pl={pl} on={on} status={status} />
        <Switch hideLabel label={t("Enable {0}", [pl.name])} checked={on} onChange={(v) => setOn(pl, v)} className="ml-1" />
      </Head>
      {steps.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg bg-sunken px-3.5 py-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setHelpOpen(!open)}
            className="group inline-flex cursor-pointer items-center gap-2 self-start text-base font-semibold text-fg-label focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon icon={ChevronRight} className="text-fg-subtle transition-transform duration-(--duration-fast) group-aria-expanded:rotate-90 motion-reduce:transition-none" />
            {t("How to set up")}
          </button>
          {open && (
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {steps.map((s, i) => (
                <li key={i} className="relative pl-8.5 text-base leading-5.25 text-fg-muted">
                  <span aria-hidden className="absolute top-0 left-0 grid size-5.5 place-items-center rounded-full bg-raised text-xs font-bold text-fg">
                    {i + 1}
                  </span>
                  <RichStep text={s} cfg={cfg} pl={pl} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {on && fields.length > 0 && (
        <div className="flex flex-col gap-5">
          {rows.map((r) =>
            r.length === 2 ? (
              <div key={r[0]?.name} className="grid w-full max-w-130 grid-cols-2 items-start gap-2.5">
                <PluginField pl={pl} st={r[0] as Setting} />
                <PluginField pl={pl} st={r[1] as Setting} />
              </div>
            ) : (
              <PluginField key={r[0]?.name} pl={pl} st={r[0] as Setting} />
            ),
          )}
          {pl.id === "obs" && status.engine && status.obs && obs.scenes.length > 0 && (
            <p className={HINT}>{obs.scenes.length === 1 ? t("1 scene found. It shows up in the OBS actions.") : t("{0} scenes found. They show up in the OBS actions.", [obs.scenes.length])}</p>
          )}
        </div>
      )}
      <PluginWidgets pl={pl} />
      {!pl.builtin && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-1">
          {perms.length ? <p className={cn(HINT, "min-w-55 flex-1")}>{t("This plugin can: ") + perms.join("; ") + "."}</p> : <span />}
          {removing ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setRemoving(false)}>
                {t("Cancel")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                onClick={async () => {
                  try {
                    const r = await api("POST /api/plugins/remove", { id: pl.id });
                    applySchema(r.schema);
                    toast(`${pl.name} removido.`);
                  } catch (e) {
                    toast((e as Error).message, { bad: true });
                  }
                }}
              >
                {t("Remove for good")}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving(true)}>
              {t("Remove plugin")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function PluginState({ pl, on, status }: { pl: Plugin; on: boolean; status: ReturnType<typeof useStatus> }) {
  const t = useT();
  const BASE = "inline-flex h-control-sm items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap";
  if (!on) return <span className={cn(BASE, "bg-sunken text-fg-muted")}>{t("Off")}</span>;
  if (!status.engine)
    return (
      <span className={cn(BASE, "bg-warning-bg text-warning-fg")} title={t("The Deck app is not running")}>
        <Icon icon={CircleAlert} size="sm" />
        {t("App closed")}
      </span>
    );
  const ps = status.plugins[pl.id];
  const state = ps?.state;
  const cls = state === "ok" ? "bg-success-bg text-success-fg" : state === "error" ? "bg-danger-bg text-danger-fg" : state === "wait" ? "bg-warning-bg text-warning-fg" : "bg-sunken text-fg-muted";
  const icon = state === "ok" ? Check : state === "error" ? CircleAlert : state === "wait" ? RefreshCw : null;
  return (
    <span className={cn(BASE, cls)} title={ps?.error || (typeof ps?.detail === "string" ? ps.detail : "") || ""}>
      {icon && <Icon icon={icon} size="sm" />}
      {ps?.label || t("On")}
    </span>
  );
}

function PluginField({ pl, st }: { pl: Plugin; st: Setting }) {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const conflicts = useValidationState((s) => s.conflicts);
  const schema = useSchema().data;
  const v = pluginValue(cfg, pl, st);
  const label = st.label ? t(st.label) : st.name;
  const hint = st.help ? t(st.help) : undefined;
  const tag = `plugin:${pl.id}:${st.name}`;
  const set = (x: unknown, typed = false) => setValue(pl, st.name, x, typed ? tag : undefined);
  const text = (type: string) => (
    <TextInput
      type={type}
      autoComplete={type === "password" ? "off" : undefined}
      value={v === undefined || v === null ? "" : String(v)}
      placeholder={st.placeholder ?? ""}
      aria-label={label}
      onChange={(e) => set(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value, true)}
      step={type === "number" ? (st.step ?? "any") : undefined}
      className="w-full max-w-105"
    />
  );
  if (st.kind === "bool") return <SetSwitch label={label} checked={!!v} onChange={(on) => set(on)} hint={hint} />;
  if (st.kind === "enum" && st.style === "pills")
    return (
      <SetRow label={label} hint={hint}>
        <Segmented variant="pills" label={label} value={String(v ?? "")} onChange={(x) => set(x)} options={(st.options ?? []).map(([ov, ol]) => ({ value: String(ov), label: t(ol) }))} />
      </SetRow>
    );
  if (st.kind === "enum")
    return (
      <SetRow label={label} hint={hint}>
        <Select aria-label={label} value={String(v ?? "")} onChange={(x) => set(x)} options={(st.options ?? []).map(([ov, ol]) => ({ value: String(ov), label: t(ol) }))} className="w-full max-w-105" />
      </SetRow>
    );
  if (st.kind === "shortcut") {
    const combo = typeof v === "string" && v ? v : typeof st.default === "string" ? st.default : "";
    const others = combo ? otherPlaces(conflicts, combo, (x) => x.plugin === pl.id && x.setting === st.name) : [];
    const regen = async () => {
      // a atual não conta como ocupada na hora de gerar outra
      const probe = structuredClone(useConfig.getState().cfg ?? {});
      Reflect.deleteProperty(cfgAt(probe, pathOf(pl), true) as Obj, st.name);
      try {
        const { combos } = await api("POST /api/free_bind", { config: probe, count: 1, rules: (pl.shortcut_rules as Obj | undefined) ?? null, taken: [] });
        if (combos[0]) set(combos[0]);
      } catch (e) {
        toast(t("No free shortcuts left: ") + (e as Error).message, { bad: true });
      }
    };
    return (
      <SetRow label={label} hint={hint}>
        <div className="flex w-full max-w-105 flex-col gap-2">
          <div className="relative flex items-center">
            <TextInput
              value={typeof v === "string" ? v : ""}
              placeholder={st.placeholder ?? ""}
              aria-label={label}
              onChange={(e) => set(e.target.value, true)}
              className="w-full max-w-none pr-11"
            />
            <IconButton
              icon={RefreshCw}
              label={t("Make another")}
              title={`${t("Make another")}: ${t("A new combination with F13–F24, which no keyboard has")}`}
              className="absolute top-1/2 right-0.75 size-7.5 -translate-y-1/2 rounded-sm"
              onClick={() => void regen()}
            />
          </div>
          <div className="-mt-2">
            <SendRow combo={combo} />
          </div>
        </div>
        {others.length > 0 && (
          <NoteBox icon={TriangleAlert} tone="bad">
            {t("This shortcut is also used in {0}. Click ↻ to make another, so each one does only one thing.", [others.map((p) => placeText(t, schema, p)).join("; ")])}
          </NoteBox>
        )}
      </SetRow>
    );
  }
  return (
    <SetRow label={label} hint={hint}>
      {text(st.kind === "password" ? "password" : st.kind === "number" ? "number" : "text")}
    </SetRow>
  );
}

/** Os widgets que o plugin traz (mesmo desligado), com "Ver na biblioteca". */
function PluginWidgets({ pl }: { pl: Plugin }) {
  const t = useT();
  const schema = useSchema().data;
  const cfg = useConfig((s) => s.cfg);
  const go = useUi((s) => s.go);
  const list = Object.entries(widgetDefs(schema, cfg)).filter(([, d]) => d.plugin === pl.id);
  const firsts = list.map(([id, d]) => ({ widget: id, size: Object.keys(d.sizes as Obj)[0] ?? "1x1", options: null, colors: null }));
  const thumbs = useThumbs(firsts);
  if (!list.length) return null;
  const label = (s: string) => s.replace("x", "×");
  return (
    <div className="flex flex-col gap-2.5 border-t border-border pt-4">
      <h4 className="m-0 text-sm font-bold">{t("Widgets from this plugin")}</h4>
      <div className="flex flex-wrap gap-2.5">
        {list.map(([id, d], i) => {
          const sizes = Object.keys(d.sizes as Obj);
          const first = firsts[i] as (typeof firsts)[number];
          const [cols, rows] = sizeColsRows(first.size);
          return (
            <div key={id} className="flex min-w-30 flex-col gap-1.5 rounded-lg border border-border p-2.5">
              <WidgetThumb srcs={thumbs(first)} cols={cols} rows={rows} unit={30} />
              <b className="text-sm">{String(d.label)}</b>
              <small className="text-xs text-fg-subtle">
                {sizes.length === 1 ? label(sizes[0] ?? "") : t("{0} to {1}, {2} sizes", [label(sizes[0] ?? ""), label(sizes[sizes.length - 1] ?? ""), sizes.length])}
              </small>
            </div>
          );
        })}
      </div>
      <Button
        size="sm"
        icon={LayoutGrid}
        className="self-start"
        onClick={() => {
          useLib.getState().setTab("widgets");
          useLib.getState().setOrigin(pl.id);
          go({ section: "keys" });
        }}
      >
        {t("See in the library")}
      </Button>
    </div>
  );
}

function InstallConfirm({ file, info, onCancel, onInstall }: { file: string; info: PluginInspect; onCancel: () => void; onInstall: () => void }) {
  const t = useT();
  const m = info.manifest;
  const perms = Array.isArray(m.permissions) ? (m.permissions as string[]) : [];
  // só link http(s): o manifesto é de quem fez o plugin
  const home = typeof m.homepage === "string" && /^https?:\/\//i.test(m.homepage) ? m.homepage : null;
  return (
    <section className={cn(BLOCK, "inset-ring-accent")}>
      <Head name={String(m.name ?? m.id)} icon={m.icon} color={m.color} meta={byLine(t, m.author, m.version)} />
      {typeof m.description === "string" && m.description && <p className={LEAD}>{m.description}</p>}
      {info.actions.length > 0 && (
        <SetRow label={t("Actions")}>
          <p className={LEAD}>{info.actions.map(String).join(", ")}</p>
        </SetRow>
      )}
      <SetRow label={t("Where it comes from")}>
        <p className={LEAD}>
          {file}
          {home && (
            <>
              {" · "}
              <a href={home} target="_blank" rel="noopener noreferrer" className="font-semibold text-fg underline">
                {home}
              </a>
            </>
          )}
        </p>
      </SetRow>
      <SetRow
        label={t("What runs")}
        hint={info.runtime === "deck-python" ? t("A Python script, run by the Deck app.") : t("A program that comes with the plugin.")}
      >
        <code className="rounded-md border border-border-strong bg-field px-2.5 py-1.75 font-mono text-xs break-all text-fg-muted">{info.run.join(" ") || "?"}</code>
      </SetRow>
      <SetRow label={t("What it can do")} hint={t("The plugin runs as a program on your PC. Only install it if you trust whoever made it.")}>
        <p className={LEAD}>{perms.length ? perms.join("; ") + "." : t("The plugin didn't say.")}</p>
      </SetRow>
      {info.builtin_conflict && <p className={cn(HINT, "text-danger-fg")}>{t("There's already a built-in plugin with this name. It can't be installed.")}</p>}
      {info.installed && <p className={HINT}>{t("Version {0} is already installed; installing replaces it with {1}.", [info.installed, String(m.version ?? t("the new one"))])}</p>}
      <div className="flex gap-2">
        <Button onClick={onCancel}>{t("Cancel")}</Button>
        <Button variant="primary" icon={Download} disabled={info.builtin_conflict} onClick={onInstall}>
          {info.installed ? t("Update") : t("Install")}
        </Button>
      </div>
    </section>
  );
}
