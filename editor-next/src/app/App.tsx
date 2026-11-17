// Inicialização: lê o config e o schema uma vez, escolhe o idioma, liga a gravação automática e a URL,
// e mostra a casca. Sem token na URL, explica como abrir.
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { normalizeLang, setLang, useT } from "@/core/i18n";
import { queryClient, useInitialConfig, useSchema } from "@/core/queries";
import { startAutosave } from "@/core/store/autosave";
import { useConfig } from "@/core/store/config";
import { startHashSync } from "@/core/store/ui";
import { readToken } from "@/core/token";
import { Shell } from "@/app/Shell";

function Message({ title, text }: { title: string; text: string }) {
  return (
    <main className="flex h-dvh items-center justify-center bg-canvas p-6 text-fg">
      <section className="max-w-prose rounded-lg border border-border bg-surface p-6">
        <h1 className="m-0 text-lg font-bold">{title}</h1>
        <p className="mt-2 text-sm text-fg-muted">{text}</p>
      </section>
    </main>
  );
}

function Boot() {
  const t = useT();
  const config = useInitialConfig();
  const schema = useSchema();
  const loaded = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loaded.current || !config.data || !schema.data) return;
    loaded.current = true; // só uma vez: ler de novo apagaria a edição
    useConfig.getState().load(config.data.config);
    const lang = normalizeLang(config.data.config.language) ?? normalizeLang(schema.data.default_language);
    void (lang ? setLang(lang) : Promise.resolve()).then(() => setReady(true));
  }, [config.data, schema.data]);

  useEffect(() => {
    if (!ready) return;
    const stopSave = startAutosave();
    const stopHash = startHashSync();
    return () => {
      stopSave();
      stopHash();
    };
  }, [ready]);

  const error = config.error ?? schema.error;
  if (error) return <Message title={t("Couldn't open the editor")} text={error.message} />;
  if (!ready) return <main className="h-dvh bg-canvas" aria-busy="true" />;
  return <Shell />;
}

export function App() {
  const [token] = useState(readToken);
  const t = useT();
  if (!token) {
    return <Message title={t("Couldn't open the editor")} text={t("Open it from the app address (with the token at the end).")} />;
  }
  return (
    <ErrorBoundary fallbackRender={({ error }) => <Message title={t("Couldn't open the editor")} text={String(error)} />}>
      <QueryClientProvider client={queryClient}>
        <Boot />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
