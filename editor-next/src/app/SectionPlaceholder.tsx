// Seção que o editor novo ainda não tem: explica e leva para o mesmo lugar no editor atual.
import { ExternalLink } from "lucide-react";
import { Icon } from "@/components/Icon";
import { formatPlace, type Place } from "@/core/hash";
import { useT } from "@/core/i18n";
import { readToken } from "@/core/token";

export function SectionPlaceholder({ place }: { place: Place }) {
  const t = useT();
  const token = readToken() ?? "";
  return (
    <div className="flex flex-1 items-start justify-center overflow-auto p-6">
      <section className="mt-12 max-w-prose rounded-lg border border-border bg-surface p-6">
        <h2 className="m-0 text-md font-semibold">{t("Still in the current editor")}</h2>
        <p className="mt-2 text-sm text-fg-muted">
          {t("This part of the new editor isn't ready yet. Keep using the current editor for it: what you change there shows up here too.")}
        </p>
        <a
          href={`/${formatPlace(place, token)}`}
          className="mt-4 inline-flex h-control-md items-center gap-2 rounded-md bg-sunken px-3 text-sm font-medium text-fg hover:bg-selected focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Icon icon={ExternalLink} size="sm" />
          {t("Open in the current editor")}
        </a>
      </section>
    </div>
  );
}
