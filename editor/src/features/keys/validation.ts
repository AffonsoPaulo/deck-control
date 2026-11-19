// Os textos da conferência do jeito da pessoa (friendlyError e placeText do editor atual).
import type { EditorSchema } from "@/core/api-types";
import type { Obj } from "@/core/obj";
import { actionDefs } from "@/features/keys/actions";

type T = (s: string, a?: unknown[]) => string;

export function placeText(t: T, schema: EditorSchema | undefined, p: Obj): string {
  if (p.plugin) {
    const pl = ((schema?.plugins ?? []) as Obj[]).find((x) => x.id === p.plugin);
    const st = ((pl?.settings as Obj[] | undefined) ?? []).find((x) => x.name === p.setting);
    return `${pl ? String(pl.name) : String(p.plugin)} › ${st ? String(st.label) : String(p.setting)}`;
  }
  const d = actionDefs(schema)[String(p.type)];
  return t("page {0}, key {1} ({2})", [p.page, p.key, d ? t(d.label) : p.type]);
}

export function friendlyError(t: T, schema: EditorSchema | undefined, e: string): string {
  const labels = schema?.field_labels ?? {};
  // o servidor responde no idioma do app: cada padrão aceita o texto em inglês (o original) e em português
  const where = (p: string, k: string, w: string | undefined): string =>
    w === "hold"
      ? t("Page {0}, key {1} (on hold): ", [p, k])
      : w === "release"
        ? t("Page {0}, key {1} (on release): ", [p, k])
        : w === "double"
          ? t("Page {0}, key {1} (on double tap): ", [p, k])
          : t("Page {0}, key {1}: ", [p, k]);
  return e
    .replace(/^pages\.([^.]+)\.(\d+)(\.(action|double|hold|release))?[^:]*:\s*/, (_m, p: string, k: string, _2, w: string | undefined) =>
      where(p, k, w),
    )
    .replace(/(?:action '[^']+' needs the field|ação '[^']+' precisa do campo) '(\w+)'/, (_m, f: string) =>
      t('fill in "{0}"', [labels[f] ? t(labels[f]) : f]),
    )
    .replace(/(?:'page' action points to|ação 'page' aponta para) '([^']+)', (?:which doesn't exist|que não existe)/, t('goes to page "$1", which doesn\'t exist'))
    .replace(/(?:unknown action type|tipo de ação desconhecido) '([^']+)'.*/, t('unknown action "$1"'))
    .replace(/^home: (?:page|página) '([^']+)' (?:doesn't exist|não existe)/, t('The home page "$1" doesn\'t exist'));
}
