// Peças da tela Config (o set-row, set-switch, int-section do editor atual) e o jeito de gravar nela: valor vazio
// (null, "", lista vazia) tira a chave do config, como o setOrDelete do atual.
import type { ReactNode } from "react";
import { Switch } from "@/components/Switch";
import { isObj, type Obj } from "@/core/obj";
import { useConfig, type Config } from "@/core/store/config";

export const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

export function setOrDelete(obj: Obj, key: string, v: unknown) {
  if (empty(v)) Reflect.deleteProperty(obj, key);
  else obj[key] = v;
}

/** Uma chave do topo do config (brightness, home, double_tap_ms...). */
export const cfgTop = (k: string, v: unknown, tag?: string) => useConfig.getState().edit((d) => setOrDelete(d, k, v), tag);

/** Uma chave dentro de uma seção (icons.style, device.settle, logging.detail...). */
export const cfgIn = (sec: string, k: string, v: unknown, tag?: string) =>
  useConfig.getState().edit((d) => {
    if (!isObj(d[sec])) d[sec] = {};
    setOrDelete(d[sec] as Obj, k, v);
  }, tag);

export const sub = (cfg: Config | null, k: string): Obj => (cfg && isObj(cfg[k]) ? (cfg[k] as Obj) : {});

export const HINT = "m-0 max-w-140 text-sm leading-4.5 text-fg-subtle";
export const LEAD = "m-0 text-base leading-5 text-fg-muted";

export function SetRow({ label, hint, children }: { label?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {label && <span className="text-base font-semibold text-fg-label">{label}</span>}
      {children}
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

export function SetSwitch({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (on: boolean) => void; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled ?? false} className="w-full max-w-130" />
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

export function SetSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <h3 className="m-0 text-lg font-bold text-fg">{title}</h3>
      {children}
    </div>
  );
}

/** Baixa um arquivo que veio em base64 do app (exportar, pacote de diagnóstico). */
export function download(name: string, base64: string, type = "application/zip") {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Escolher um arquivo e ler como data URL (importar config, instalar plugin). */
export function pickFile(accept: string, onRead: (name: string, dataUrl: string) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.hidden = true;
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => onRead(f.name, String(rd.result));
    rd.readAsDataURL(f);
  });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}

export const numFmt = (lang: string, v: number, digits = 0) => Number(v).toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
