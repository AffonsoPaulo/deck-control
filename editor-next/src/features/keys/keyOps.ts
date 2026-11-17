// As ferramentas da tecla (cabeçalho do inspetor e atalhos): testar, copiar, colar, guardar e apagar. Mesmos
// textos e regras do editor atual (testKey, copyKey, pasteKey, saveCurrentKey, clearKey).
import { api } from "@/core/api";
import { useT } from "@/core/i18n";
import { clone } from "@/core/obj";
import { useSchema } from "@/core/queries";
import { flushSave } from "@/core/store/autosave";
import { isDirty, useConfig } from "@/core/store/config";
import { undoButton } from "@/core/store/undo";
import { toast } from "@/core/toast";
import { MOMENTS, collapse, toList } from "@/features/keys/actions";
import { draftKeys } from "@/features/keys/keys";
import { pageKeysOf } from "@/features/keys/model";
import { fillBinds, saveSpec } from "@/features/keys/place";
import { useSession } from "@/features/keys/session";

export function useKeyOps(page: string) {
  const t = useT();
  const schema = useSchema().data;

  const specOf = (key: string) => pageKeysOf(useConfig.getState().cfg, page)[key];

  /** Roda a versão gravada da tecla (grava antes, se tem mudança; o app relê o config em até 1 s). */
  const test = async (key: string) => {
    const wasDirty = isDirty(useConfig.getState());
    if (!(await flushSave())) return toast(t("Fix the errors first: the key hasn't been saved yet."), { bad: true });
    if (wasDirty) await new Promise((r) => setTimeout(r, 1200));
    try {
      await api("POST /api/press", { page, key: Number(key) });
      toast(t("Action run."));
    } catch (e) {
      toast((e as Error).message, { bad: true });
    }
  };

  const copy = (key: string) => {
    const spec = specOf(key);
    if (!spec) return;
    useSession.getState().setClipboard(clone(spec));
    toast(t("Key {0} copied.", [key]));
  };

  /** Cola a tecla copiada; atalhos gerados ganham uma combinação nova (duas teclas não mandam a mesma). */
  const paste = async (key: string) => {
    const copied = useSession.getState().clipboard;
    if (!copied) return;
    const spec = clone(copied);
    const lists = MOMENTS.map((m) => toList(spec[m]));
    const n = await fillBinds(lists.flat(), t, schema);
    if (n) {
      MOMENTS.forEach((m, i) => {
        const v = collapse(lists[i]);
        if (v) spec[m] = v;
        else Reflect.deleteProperty(spec, m);
      });
    }
    useConfig.getState().edit((d) => {
      draftKeys(d, page)[key] = spec;
    });
    toast(n ? t("Key pasted with a new shortcut: link it again in the other program.") : t("Key pasted."), { undo: undoButton(t) });
  };

  const save = (key: string) => {
    const spec = specOf(key);
    if (!spec) return;
    saveSpec(spec, t, schema);
    toast(t("Saved in Saved keys, in the library. Drag it from there to use it on any page."));
  };

  const remove = (key: string) => {
    if (!specOf(key)) return;
    useConfig.getState().edit((d) => {
      Reflect.deleteProperty(draftKeys(d, page), key);
    });
    toast(t("Key {0} deleted.", [key]), { undo: undoButton(t) });
  };

  return { test, copy, paste, save, remove };
}
