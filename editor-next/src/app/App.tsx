// Inicialização: lê o config e o schema uma vez, escolhe o idioma, liga a gravação automática e a URL,
// e mostra a casca. Sem token na URL, explica como abrir.
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ApiError } from "@/core/api";
import { normalizeLang, setLang, useT } from "@/core/i18n";
import { queryClient, useInitialConfig, useSchema } from "@/core/queries";
import { startAutosave } from "@/core/store/autosave";
import { useConfig } from "@/core/store/config";
import { startUrlSync } from "@/core/store/ui";
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
    const stopHash = startUrlSync();
    return () => {
      stopSave();
      stopHash();
    };
  }, [ready]);

  const error = config.error ?? schema.error;
  // token que o app não reconhece: link antigo (ou de outro computador); recarregar não resolve
  if (error instanceof ApiError && error.code === "token") {
    return <Message title={t("This link no longer opens the editor")} text={t("Open the editor from the Deck icon in the tray (or from the link shown in the terminal).")} />;
  }
  if (error) return <Message title={t("Couldn't open the editor")} text={error.message} />;
  if (!ready) return <main className="h-dvh bg-canvas" aria-busy="true" />;
  return <Shell />;
}

export function App() {
  const [token] = useState(readToken);
  const t = useT();
  if (!token) {
    return <Message title={t("Couldn't open the editor")} text={t("Open the editor from the Deck icon in the tray (or from the link shown in the terminal).")} />;
  }
  return (
    <ErrorBoundary fallbackRender={({ error }) => <Message title={t("Couldn't open the editor")} text={String(error)} />}>
      <QueryClientProvider client={queryClient}>
        <Boot />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
