# Design system do editor

Aprovado no canvas (artifact "Editor do D6", página "Design system") em 2026-11-17.
As regras curtas estão no `CLAUDE.md`; aqui fica o porquê.

## Onde está
- `app/editor/static/tokens.css`: a fonte única dos valores (escalas, paleta de tecla, durações, camadas e o tema).
- `editor/src/styles/app.css`: importa os tokens no Tailwind (`@theme inline`), nunca copia. A única medida própria
  é `--spacing-top` (altura do topo, layout). O lint (`editor/eslint.config.js`) barra valor escrito direto e
  classe que não é token.
- `editor/src/features/keys/deck.css`: a exceção, o desenho do aparelho (usa `--device-*` e medidas próprias).
- React: `useKeySwatches()` dá a paleta de tecla com os valores dos tokens; categorias usam `var(--cat-<matiz>)`.
- Python: `app/widgets.py` guarda o nome da matiz de cada categoria de widget; `BG` (`#1d2330`) é igual a
  `--key-graphite`. `app/icons.py` escolhe texto escuro (`--key-fg-dark`) quando o fundo liso da tecla não dá
  3:1 com o branco e a tecla não escolheu cor de texto.

## Temas
- Só o escuro existe. O bloco `:root, [data-theme="dark"]` tem todas as cores e sombras.
- Para um tema novo (do app ou de um plugin, no futuro): `[data-theme="nome"] { … }` redefinindo só variáveis
  desse bloco. Escalas não mudam com o tema. O que o tema não definir cai no escuro.
- Ainda não existe seletor de tema nem carregamento de tema de plugin; a estrutura já permite.
- O Tailwind lê os tokens com `@theme inline { --color-surface: var(--surface); … }`, então um tema novo vale
  também para as classes.

## Decisões
- **Borda de campo abaixo de 3:1** (`--border-strong` 1,7:1 sobre `--field`), de propósito: borda mais forte faz
  os campos parecerem várias faixas. O campo se distingue pelo fundo, pelo rótulo e pelo anel de foco.
- **`--fg-subtle` não vai sobre `--selected`** (4,2:1): dentro de item escolhido, texto secundário usa `--fg-muted`.
- **Cor de categoria como texto** usa a mistura de 55% com `--cat-mix-fg`, nunca a base (azul, violeta, índigo e
  rosa não passam de 4,5:1 como base).
- **Trilho**: estilo cinza em todos (páginas, segmentado, abas da biblioteca, pílulas da Config e dos logs).
- **Camadas**: diálogo 40 (o que abre por último fica por cima), menu 50, aviso 60.

## Ainda fora dos tokens
- Os padrões de tecla por ação e por categoria (`#134a4f`, `#3d3027`, vermelho/verde de estado, em
  `editor/src/features/keys/actions.ts`), que são conteúdo das teclas, não interface.
