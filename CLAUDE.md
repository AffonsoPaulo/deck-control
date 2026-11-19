# Deck (substituto do app do Fifine AmpliGame D6)

## Design system
- Tokens em `app/editor/static/tokens.css` (a fonte única; o editor importa no Tailwind). Nada de cor, raio,
  tamanho de fonte, ícone, sombra, duração ou z-index escritos direto: o lint barra.
  Exceção: o desenho do aparelho (`editor/src/features/keys/deck.css`: o Deck, as teclas, a tela Luz, a peça
  arrastada), que usa `--device-*` e medidas próprias.
- Dois blocos no `tokens.css`: escalas e paleta de tecla (fixos) e o tema (`[data-theme]`, só cores e sombras).
  Um tema novo redefine só o bloco do tema.
- Escalas: raio 3/6/9/12/16/redondo (peça de dentro = raio de fora − folga); texto 11/12/13/14/15/18/22/28;
  ícone 12/14/16/20/24/28; controles 24/28/32/36/40/44; espaço em múltiplos de 2 (base 4).
- Trilhos (abas, segmentado, pílulas): um estilo só, o escolhido em `--selected` com texto `--fg`.
- Cores de categoria: só a base (`--cat-<matiz>`); chip, ícone e bloco saem das fórmulas com `color-mix`.
- Paleta de tecla (`--key-*`) é o que vai para o Deck e não muda com o tema. No editor: `useKeySwatches()`.
- Contraste WCAG medido antes de mostrar cor nova: texto 4,5:1, peça 3:1. Exceção combinada: borda de campo.
- Estado sempre com ícone e texto. Sem bolinha verde/vermelha e sem borda tracejada. Ícones Lucide.
- Apareceu em dois lugares: vira componente na hora.
- Mudança visual passa primeiro pelo canvas (artifact "Editor do D6", página "Design system").

## Editor (React, `editor/`)
- Vite + React 19 + TypeScript 6 (estrito) + Tailwind v4. O Python serve o build (`editor/dist`) na raiz, com o
  token no caminho (`/XXXX-XXXX-XXXX/teclas/...`); sem o build, a página explica que falta o `npm run build`.
  O editor antigo (JS puro) saiu; de `app/editor/static` ficaram os tokens, as traduções, as fontes, o índice do
  Lucide e os favicons, que o editor e o Python usam.
  Em desenvolvimento, `npm run dev` (porta 5173) manda a `/api` para o servidor de teste (8799), nunca para o app real.
- Tailwind só com os tokens do `app/editor/static/tokens.css` (importado, nunca copiado), em `src/styles/app.css`.
  O lint barra valor escrito direto (`rounded-[7px]`) e classe que não é token (`bg-blue-500`).
- Tipos da API gerados do contrato: `npm run gen:api` (depois de `python -m app.editor.contract`).
- Antes de commitar: `npm run check` (lint, tipos, contrato em dia, testes) e `npx vite build`.
- Textos com `t("English")` (`src/core/i18n.ts`), traduzidos em `app/editor/static/locales/pt-BR.json`.
- O config só muda por `useConfig().edit(...)` (entra no desfazer e grava sozinho). Seleção e abas: `useUi`.
- Nunca escrever as chaves do localStorage do editor antigo (`d6-pendente`, `d6-lang`, `d6-lib-*`): podem ter sobrado
  no navegador. O editor usa as suas (`deck-next-*`).
- Versões exatas no `package.json`, instaladas com `npm install --before=<data de 2 semanas atrás>`.

## Python
- Testes: `python -m pytest` (só a pasta `tests/`; os scripts de `tools/` falam com o D6 de verdade).
  Teste novo nunca usa o `config.yaml` de verdade: config sintético ou o `config.example.yaml`, em `tmp_path`.
- `config.example.yaml` (português) e `config.example.en.yaml` andam juntos: mudou um, mude o outro. Só o texto das
  teclas e os nomes de página e de cena podem mudar (`tests/test_example_configs.py` confere). A primeira abertura
  copia o do idioma do Windows.
- `python -m ruff check .`, `python -m ruff format .` e `python -m mypy` antes de commitar. Formatação vai em
  commit separado de mudança de lógica.
- Importar um módulo não liga nada. Plugins carregam e as peças compartilhadas saem de `app.bootstrap.services()`;
  quem precisa recebe por parâmetro (`Engine(..., plugins=, values=)`). Caminhos passam por `app/paths.py`.
- API do editor: uma função por rota em `app/editor/api/<assunto>.py`, com os tipos do pedido e da resposta em
  `app/editor/contract.py` e a entrada em `ROUTES` (`app/editor/api/__init__.py`). Mudou o formato: rode
  `python -m app.editor.contract` (o teste avisa). O servidor (`server.py`) só cuida do HTTP.
- Bug achado em teste de caracterização: registrar com `xfail(strict=True)` e avisar, sem corrigir junto.
- Planos de trabalho em `docs/plano-*.md` (só na máquina: o `.gitignore` deixa entrar no git só o `guide/` (guia de
  uso, em inglês), o `development.md`, o `design-system.md`, o `plugins.md` e o `roadmap.md` de `docs/`).
- O `README.md` é a vitrine do projeto, em inglês, para quem vai usar; o que é de desenvolvimento vai no
  `docs/development.md`.

## Trabalho
- Responder em português do Brasil.
- `config.yaml` tem a senha do OBS: nunca mostrar, logar nem commitar. O repositório é público.
- Testes manuais no servidor de teste (porta 8799, com cópia do config), nunca no app real (8765). Desligar depois.
- Commit só quando pedirem. Mensagens em inglês, no formato Conventional Commits: `tipo(área): what changed`, com
  tipo `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `style` ou `perf` e a área em minúsculas
  (ex.: `fix(obs): treat the PC's own LAN address as local`). Os commits até 2026-11-18 ficaram no formato antigo
  ("Área: o que mudou", em português); o histórico não é reescrito.
- Logs em inglês (loggers `deck.<área>`, segredos pelo `mask`), comentários em português, textos da interface com `t("English")`.
