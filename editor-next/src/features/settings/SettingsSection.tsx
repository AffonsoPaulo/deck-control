// Tela "Config" (o renderSettingsView do editor atual): as seções à esquerda (uma aberta por vez, no endereço) e a
// escolhida à direita. Geral, Aparência das teclas, Avançado (com Logs e diagnóstico), Backup e Sobre aqui;
// Integrações em Integrations.tsx.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Download, FileText, Folder, FolderOpen, Gauge, Info, Package, Palette, Plug, SlidersHorizontal, Upload, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { NoteBox } from "@/components/NoteBox";
import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { Stepper } from "@/components/Stepper";
import { Switch } from "@/components/Switch";
import { api } from "@/core/api";
import type { SetSection as SetSectionId } from "@/core/hash";
import { i18n, normalizeLang, setLang, useT } from "@/core/i18n";
import { normalizeIcon } from "@/core/obj";
import { useStatus } from "@/core/queries";
import { flushSave } from "@/core/store/autosave";
import { useConfig } from "@/core/store/config";
import { useUi } from "@/core/store/ui";
import { toast } from "@/core/toast";
import { useCurrentPage } from "@/features/keys/currentPage";
import { pageKeysOf, pagesOf } from "@/features/keys/model";
import { friendlyError } from "@/features/keys/validation";
import { logAreas } from "@/features/logs/LogsSection";
import { Integrations } from "@/features/settings/Integrations";
import { HINT, LEAD, SetRow, SetSection, SetSwitch, cfgIn, cfgTop, download, numFmt, pickFile, sub } from "@/features/settings/parts";
import { useSchema } from "@/core/queries";

type T = ReturnType<typeof useT>;

const sections = (t: T): [SetSectionId, string, LucideIcon][] => [
  ["general", t("General"), SlidersHorizontal],
  ["look", t("Key appearance"), Palette],
  ["integrations", t("Integrations"), Plug],
  ["advanced", t("Advanced"), Gauge],
  ["backup", t("Backup"), Download],
  ["about", t("About"), Info],
];

/** O que o app diz de si (firmware, iniciar com o Windows, onde ficam os arquivos). */
export function useAbout() {
  return useQuery({
    queryKey: ["about"],
    queryFn: async () => {
      try {
        return await api("GET /api/about");
      } catch {
        return { firmware: null, device: false, autostart: null, config: "?", log: "?" };
      }
    },
    staleTime: 30_000,
  });
}

export function SettingsSection() {
  const t = useT();
  const sec = useUi((s) => s.setSection);
  const go = useUi((s) => s.go);
  const list = sections(t);
  const title = list.find(([k]) => k === sec)?.[1] ?? "";
  return (
    <main className="flex min-h-0 flex-1 items-start gap-10 overflow-auto px-8 pt-7 pb-12 scrollbar-stable max-lg:flex-col">
      <nav aria-label={t("Settings sections")} className="sticky top-0 flex w-57.5 flex-none flex-col gap-0.5 max-lg:static max-lg:w-full">
        {list.map(([k, l, icon]) => (
          <button
            key={k}
            type="button"
            aria-current={k === sec ? "page" : "false"}
            data-current={k === sec ? "" : undefined}
            onClick={() => go({ setSection: k })}
            className="group flex h-control-2xl cursor-pointer items-center gap-3 rounded-md px-3 text-left text-base font-medium text-fg-muted transition-colors duration-(--duration-fast) hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-accent data-current:bg-sunken data-current:font-semibold data-current:text-fg data-current:inset-ring data-current:inset-ring-border"
          >
            <Icon icon={icon} size="lg" className="text-fg-subtle group-data-current:text-accent" />
            {l}
          </button>
        ))}
      </nav>
      <div className="flex max-w-180 min-w-0 flex-1 flex-col gap-7">
        <h2 className="m-0 mb-1 text-2xl font-bold text-fg">{title}</h2>
        {sec === "general" ? <General /> : sec === "look" ? <Look /> : sec === "integrations" ? <Integrations /> : sec === "advanced" ? <Advanced /> : sec === "backup" ? <Backup /> : <About />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------- Geral

function General() {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const about = useAbout();
  const qc = useQueryClient();
  const names = Object.keys(pagesOf(cfg));
  const home = typeof cfg?.home === "string" ? cfg.home : (names[0] ?? "");
  const lang = normalizeLang(i18n.language) ?? "pt-BR";
  const auto = about.data?.autostart;
  return (
    <>
      <SetRow label={t("Language")} hint={t("The language of the editor, the tray menu and the plugins.")}>
        <Segmented
          variant="pills"
          label={t("Language")}
          value={lang}
          onChange={(v) => {
            if (v === lang) return;
            cfgTop("language", v);
            void flushSave().then(() => setLang(v));
          }}
          options={[
            { value: "pt-BR", label: "Português" },
            { value: "en", label: "English" },
          ]}
        />
      </SetRow>
      <SetRow label={t("Screen brightness")} hint={t("The brightness of the 15 screens. The ring light has its own, in Light.")}>
        <Stepper value={Number(cfg?.brightness ?? 100)} min={0} max={100} step={10} label={t("screen brightness")} format={(v) => `${v}%`} onChange={(v) => cfgTop("brightness", v)} />
      </SetRow>
      <SetRow label={t("Home page")} hint={t("The one shown when the app opens.")}>
        {names.length <= 8 ? (
          <Segmented variant="pills" label={t("Home page")} value={home} onChange={(v) => cfgTop("home", v)} options={names.map((p) => ({ value: p, label: p }))} />
        ) : (
          <Select aria-label={t("Home page")} value={home} onChange={(v) => cfgTop("home", v)} options={names.map((p) => ({ value: p, label: p }))} className="max-w-105" />
        )}
      </SetRow>
      {auto !== null && auto !== undefined && (
        <SetSwitch
          label={t("Start with Windows")}
          checked={auto}
          hint={t("The app opens on its own when you turn on the PC, straight to the tray.")}
          onChange={(on) =>
            void api("POST /api/autostart", { enabled: on })
              .then((r) => qc.setQueryData(["about"], { ...about.data, autostart: r.autostart }))
              .catch((e: Error) => toast(e.message, { bad: true }))
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------- Aparência das teclas

function Look() {
  const t = useT();
  const qc = useQueryClient();
  const cfg = useConfig((s) => s.cfg);
  const page = useCurrentPage();
  const icons = sub(cfg, "icons");
  const textPos = typeof icons.style === "string" ? icons.style : "below";
  const size = Number(icons.text_size || 16);
  // exemplo: as três primeiras teclas da página, com o estilo e o tamanho escolhidos; enquanto a prévia nova não
  // chega, fica a anterior (nada pisca)
  const keys = Object.entries(pageKeysOf(cfg, page))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(0, 3)
    .map(([, k]) => k);
  const body = JSON.stringify({
    keys: (keys.length ? keys : [{ icon: { lucide: "mic", text: t("Example"), bg: "#5865F2" } }]).map((k) => ({ icon: normalizeIcon(k.icon) })),
    icons: cfg?.icons ?? null,
  });
  const [srcs, setSrcs] = useState<string[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    api("POST /api/preview", JSON.parse(body) as never)
      .then((r) => {
        if (n === seq.current) setSrcs(r.images.filter(Boolean).map((x) => (x as { normal: string }).normal));
      })
      .catch(() => {});
  }, [body]);
  // mudou o estilo das teclas: as prévias da grade ficam velhas
  const refresh = () => void qc.invalidateQueries({ queryKey: ["preview"] });
  return (
    <>
      <SetRow label={t("Example")} hint={t("The first keys of this page, the way they'll look on the Deck.")}>
        <div aria-label={t("Example")} className="deck-set-sample">
          {srcs.map((src, i) => (
            <img key={i} src={src} alt="" />
          ))}
        </div>
      </SetRow>
      <SetRow label={t("Style")} hint={t("Applies to all keys. You can change it for a specific key in the Appearance tab.")}>
        <Segmented
          variant="pills"
          label={t("Style")}
          value={textPos}
          onChange={(v) => {
            cfgIn("icons", "style", v === "below" ? null : v);
            refresh();
          }}
          options={[
            { value: "below", label: t("Icon and text below") },
            { value: "top", label: t("Text above") },
            { value: "big", label: t("Icon only") },
          ]}
        />
      </SetRow>
      <SetRow label={t("Text size")} hint={t("The same on every key. Long text wraps onto two lines before shrinking.")}>
        <Stepper
          value={size}
          min={10}
          max={28}
          step={1}
          label={t("text size")}
          onChange={(v) => {
            cfgIn("icons", "text_size", v === 16 ? null : v);
            refresh();
          }}
        />
      </SetRow>
      <SetSwitch
        label={t("Shrink the key when pressed")}
        checked={icons.press_shrink !== false}
        onChange={(on) => cfgIn("icons", "press_shrink", on ? null : false)}
        hint={t("While you hold a key, its screen gets a bit smaller, like a real button.")}
      />
    </>
  );
}

// ---------------------------------------------------------------------------- Avançado

function Advanced() {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const dev = sub(cfg, "device");
  const lang = i18n.language;
  return (
    <>
      <SetSection title={t("Keys")} />
      <SetRow label={t("Double tap time")} hint={t("How long the key waits for a second tap. Less = faster keys on pages with double tap; more = easier to double tap.")}>
        <Stepper
          value={Number(cfg?.double_tap_ms ?? 250)}
          min={150}
          max={600}
          step={25}
          label={t("double tap time")}
          format={(v) => `${v} ms`}
          onChange={(v) => cfgTop("double_tap_ms", v === 250 ? null : v)}
        />
      </SetRow>
      <SetSection title={t("Sending images")} />
      <p className={LEAD}>{t("Sending images to the screens. Only change this if some key stops updating.")}</p>
      <SetRow label={t("Pause between commands")} hint={t("Higher = slower and safer.")}>
        <Stepper value={Number(dev.settle ?? 1)} min={0} max={2} step={0.05} label={t("pause between commands")} format={(v) => numFmt(lang, v, 2)} onChange={(v) => cfgIn("device", "settle", v)} />
      </SetRow>
      <SetRow label={t("Pause per key")}>
        <Stepper value={Number(dev.key_delay ?? 0.3)} min={0} max={1} step={0.01} label={t("pause per key")} format={(v) => `${numFmt(lang, v, 2)} s`} onChange={(v) => cfgIn("device", "key_delay", v)} />
      </SetRow>
      <SetSwitch label={t("Send one image at a time")} checked={dev.per_key_session !== false} onChange={(on) => cfgIn("device", "per_key_session", on)} hint={t("Much slower, but the safest mode.")} />
      <Logging />
    </>
  );
}

const fmtBytes = (lang: string, b: number) => (b >= 1e6 ? `${numFmt(lang, b / 1e6, 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

function Logging() {
  const t = useT();
  const cfg = useConfig((s) => s.cfg);
  const c = sub(cfg, "logging");
  const detail = !!c.detail;
  const areas = new Set(Array.isArray(c.areas) ? (c.areas as string[]) : []);
  const names = logAreas(t);
  const lang = i18n.language;
  const info = useQuery({ queryKey: ["log-files"], queryFn: () => api("GET /api/logs", { after: "999999999" }), retry: false, staleTime: 10_000 });
  const files = info.data?.files;
  const set = (k: string, v: unknown) => cfgIn("logging", k, v);
  return (
    <>
      <SetSection title={t("Logs and diagnostics")} />
      {info.data?.detail.force && <NoteBox icon={Bug}>{t("The app was started with --debug: everything is detailed, whatever is chosen here.")}</NoteBox>}
      <SetSwitch
        label={t("Show the Logs tab in the menu")}
        checked={!!c.show_tab}
        onChange={(on) => set("show_tab", on || null)}
        hint={t("The tab only shows what's already in the file. Hidden, the app keeps recording the same way.")}
      />
      <SetRow
        label={t("Detail")}
        hint={t("Errors, warnings and the main events (page, connections, saves) are always recorded. Detailed adds the step by step of the areas checked below.")}
      >
        <Segmented
          variant="pills"
          label={t("Detail")}
          value={detail ? "detailed" : "normal"}
          onChange={(v) => set("detail", v === "detailed" || null)}
          options={[
            { value: "normal", label: t("Normal") },
            { value: "detailed", label: t("Detailed") },
          ]}
        />
      </SetRow>
      <SetRow label={t("Detailed in")} hint={detail ? undefined : t("Choose Detailed to pick the areas.")}>
        <div className={detail ? "grid grid-cols-2 gap-x-6 gap-y-3" : "grid grid-cols-2 gap-x-6 gap-y-3 opacity-55"}>
          {names.map(([id, label, desc]) => (
            <label key={id} className="flex max-w-65 cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={areas.has(id)}
                disabled={!detail}
                className="mt-0.75 accent-accent"
                onChange={(e) => {
                  const next = new Set(areas);
                  if (e.target.checked) next.add(id);
                  else next.delete(id);
                  set("areas", next.size ? names.map((a) => a[0]).filter((a) => next.has(a)) : null);
                }}
              />
              <span className="flex flex-col gap-px">
                <b className="text-base font-semibold">{label}</b>
                <small className="text-sm text-fg-subtle">{desc}</small>
              </span>
            </label>
          ))}
        </div>
      </SetRow>
      <SetSwitch
        label={t("Show error on the key")}
        checked={c.key_error !== false}
        onChange={(on) => set("key_error", on ? null : false)}
        hint={t("When an action fails, the key shows an ✕ for 1 second and goes back to normal.")}
      />
      <SetSwitch
        label={t("Notify in Windows")}
        checked={!!c.notify}
        onChange={(on) => set("notify", on || null)}
        hint={t("Once per problem (OBS that doesn't connect, plugin that stopped, Deck disconnected). Off by default: the notification can show up on the live.")}
      />
      <SetRow
        label={t("Files")}
        hint={t("Keeps up to 5 files of 2 MB. The package is a .zip with the logs, the config without passwords and the versions, to send when something goes wrong.")}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-md border border-border-strong bg-field px-2.5 py-1.75 font-mono text-xs text-fg-muted">{files ? files.folder : info.isError ? t("couldn't read") : "…"}</span>
          {files && <span className="text-sm text-fg-subtle">{files.count === 1 ? t("1 file, {0}", [fmtBytes(lang, files.bytes)]) : t("{0} files, {1}", [files.count, fmtBytes(lang, files.bytes)])}</span>}
        </div>
      </SetRow>
      <div className="flex flex-wrap gap-2">
        <Button icon={FolderOpen} onClick={() => void api("POST /api/open", { what: "logs" }).catch((e: Error) => toast(e.message, { bad: true }))}>
          {t("Open folder")}
        </Button>
        <Button
          icon={Package}
          onClick={async () => {
            await flushSave();
            try {
              const r = await api("POST /api/logs/diagnostics", {});
              download(r.name, r.data);
              toast(t("File {0} downloaded.", [r.name]));
            } catch (e) {
              toast(t("Couldn't create the package: {0}", [(e as Error).message]), { bad: true });
            }
          }}
        >
          {t("Create diagnostics package")}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- Backup

/** Depois de restaurar ou importar: o servidor já gravou; o editor recomeça desse config. */
export function useReplaceConfig() {
  const qc = useQueryClient();
  return (cfg: Record<string, unknown>) => {
    useConfig.getState().load(cfg);
    useUi.getState().go({ key: null, expanded: false });
    qc.removeQueries({ queryKey: ["preview"] });
  };
}

function Backup() {
  const t = useT();
  const schema = useSchema().data;
  const replace = useReplaceConfig();
  // o interruptor só decide o que vai no arquivo exportado; não mexe no config
  const [secrets, setSecrets] = useState(false);
  const [pending, setPending] = useState<{ name: string; data: string; pages: string[]; keys: number; images: number } | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);

  const exportCfg = async () => {
    await flushSave();
    try {
      const r = await api("POST /api/export", { include_secrets: secrets });
      download(r.name, r.data);
      toast(t("File {0} downloaded.", [r.name]));
    } catch (e) {
      toast(t("Error exporting: ") + (e as Error).message, { bad: true });
    }
  };
  const importCfg = () =>
    pickFile(".zip,.yaml,.yml,.json", async (name, data) => {
      setErrors(null);
      setUnreadable(null);
      setPending(null);
      try {
        const r = await api("POST /api/import", { name, data, dry_run: true });
        // arquivo que não é config do Deck: vem como {ok: false, errors}, não como erro
        if ("ok" in r && r.ok === false) return setUnreadable(r.errors.join(" "));
        if (!("summary" in r)) return setUnreadable("?");
        setPending({ name, data, ...r.summary });
      } catch (e) {
        setUnreadable((e as Error).message);
      }
    });
  const run = async (mode: "replace" | "merge") => {
    if (!pending) return;
    await flushSave();
    try {
      const r = await api("POST /api/import", { name: pending.name, data: pending.data, mode });
      if (!("ok" in r) || !r.ok) {
        setErrors("errors" in r ? r.errors : []);
        return;
      }
      replace(r.config);
      setPending(null);
      toast(mode === "replace" ? t("Setup imported. If you don't like it, go back through the history.") : t("Pages added. If you don't like it, go back through the history."));
    } catch (e) {
      toast(t("Error importing: ") + (e as Error).message, { bad: true });
    }
  };
  const n = pending?.pages.length ?? 0;
  return (
    <>
      <p className={LEAD}>{t("Take your setup to another PC or keep a copy. The .zip file includes the key images.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button icon={Download} onClick={() => void exportCfg()}>
          {t("Export")}
        </Button>
        <Button icon={Upload} onClick={importCfg}>
          {t("Import…")}
        </Button>
      </div>
      <Switch label={t("Include the OBS password in the exported file")} checked={secrets} onChange={setSecrets} className="w-full max-w-130" />
      {unreadable !== null && <p className="m-0 text-danger-fg">{t("Couldn't read the file: ") + unreadable}</p>}
      {errors && (
        <div>
          <p className="m-0 text-danger-fg">{t("The file has problems:")}</p>
          <ul className="m-0">
            {errors.map((e) => (
              <li key={e}>{friendlyError(t, schema, e)}</li>
            ))}
          </ul>
        </div>
      )}
      {pending && (
        <div className="grid gap-2 rounded-md bg-sunken p-3">
          <b>{pending.name}</b>
          <p className="m-0 text-fg-muted">
            {(n === 1 ? t("1 page ({0}), {1} keys", [pending.pages.join(", "), pending.keys]) : t("{0} pages ({1}), {2} keys", [n, pending.pages.join(", "), pending.keys])) +
              (pending.images ? t(", {0} images", [pending.images]) : "") +
              "."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void run("replace")}>
              {t("Replace everything")}
            </Button>
            <Button size="sm" onClick={() => void run("merge")}>
              {t("Only add the pages")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t("Cancel")}
            </Button>
          </div>
          <p className={HINT}>{t("The current version stays in the history, so you can go back.")}</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------- Sobre

function About() {
  const t = useT();
  const about = useAbout();
  const status = useStatus();
  if (!about.data) return null;
  const a = about.data;
  const line = (label: string, value: string) => (
    <div className="flex justify-between gap-4 border-border px-4.5 py-3.5 text-base not-first:border-t">
      <span className="text-fg-muted">{label}</span>
      <b className="text-right font-semibold wrap-anywhere">{value}</b>
    </div>
  );
  const device = status.engine && status.device;
  return (
    <>
      <div className="flex flex-col rounded-xl bg-surface inset-ring inset-ring-border">
        {line(t("Device"), t("Fifine AmpliGame D6"))}
        {line(t("Firmware"), a.firmware || (device ? "lendo…" : t("Deck disconnected")))}
        {line(t("Settings file"), a.config || "?")}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={Folder} onClick={() => void api("POST /api/open", { what: "folder" }).catch((e: Error) => toast(e.message, { bad: true }))}>
          {t("Open the app folder")}
        </Button>
        <Button icon={FileText} onClick={() => void api("POST /api/open", { what: "log" }).catch((e: Error) => toast(e.message, { bad: true }))}>
          {t("View the log")}
        </Button>
      </div>
      <p className={HINT}>{t("Icons: Lucide (lucide.dev), ISC license. Font: Figtree.")}</p>
    </>
  );
}
