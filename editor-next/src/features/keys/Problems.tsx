// Embaixo do Deck: o que impede salvar (com o texto do jeito da pessoa) e os atalhos repetidos (o #problems do
// editor atual). Some quando não há nada.
import { useT } from "@/core/i18n";
import type { Obj } from "@/core/obj";
import { useSchema } from "@/core/queries";
import { useValidationState } from "@/core/validation";
import { useConfig } from "@/core/store/config";
import { friendlyError, placeText } from "@/features/keys/validation";

export function Problems() {
  const t = useT();
  const schema = useSchema().data;
  const live = useValidationState();
  const saveErrors = useConfig((s) => s.errors); // o que o servidor recusou ao salvar
  const v = { errors: live.errors.length ? live.errors : saveErrors, conflicts: live.conflicts };
  if (!v.errors.length && !v.conflicts.length) return null;
  return (
    <div role="status" className="mt-4 w-full max-w-150 rounded-lg bg-danger-bg px-4 py-3 text-sm text-fg-label">
      {v.errors.length > 0 && (
        <>
          <p className="m-0 mb-1 font-semibold">{t("Fix before saving:")}</p>
          <ul className="m-0 pl-4.5">
            {v.errors.map((e) => (
              <li key={e}>{friendlyError(t, schema, e)}</li>
            ))}
          </ul>
        </>
      )}
      {v.conflicts.length > 0 && (
        <>
          <p className="m-0 mb-1 font-semibold">{t("Repeated shortcuts (saving still works):")}</p>
          <ul className="m-0 pl-4.5">
            {v.conflicts.map((c) => (
              <li key={c.combo}>
                {c.combo}: {(c.places as unknown as Obj[]).map((p) => placeText(t, schema, p)).join("; ")}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
