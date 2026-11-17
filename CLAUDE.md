# Deck (substituto do app do Fifine AmpliGame D6)

## Design system (editor: `app/editor/static`)
- Tokens em `app/editor/static/tokens.css`. O `style.css` só usa as variáveis de lá:
  nada de cor, raio, tamanho de fonte, ícone, sombra, duração ou z-index escritos direto.
  Exceção: o desenho do aparelho (`.deck`, `.key`, `.lv-*` do Deck, peça arrastada), que usa `--device-*` e medidas próprias.
- Dois blocos no `tokens.css`: escalas e paleta de tecla (fixos) e o tema (`[data-theme]`, só cores e sombras).
  Um tema novo redefine só o bloco do tema.
- Escalas: raio 3/6/9/12/16/redondo (peça de dentro = raio de fora − folga); texto 11/12/13/14/15/18/22/28;
  ícone 12/14/16/20/24/28; controles 24/28/32/36/40/44; espaço em múltiplos de 2 (base 4).
- Trilhos (abas, segmentado, pílulas): um estilo só, o escolhido em `--selected` com texto `--fg`.
- Cores de categoria: só a base (`--cat-<matiz>`); chip, ícone e bloco saem das fórmulas com `color-mix`.
- Paleta de tecla (`--key-*`) é o que vai para o Deck e não muda com o tema. No JS: `KEY_SWATCHES`.
- Contraste WCAG medido antes de mostrar cor nova: texto 4,5:1, peça 3:1. Exceção combinada: borda de campo.
- Estado sempre com ícone e texto. Sem bolinha verde/vermelha e sem borda tracejada. Ícones Lucide.
- Apareceu em dois lugares: vira componente na hora.
- Mudança visual passa primeiro pelo canvas (artifact "Editor do D6", página "Design system").

## Python
- Testes: `python -m pytest` (só a pasta `tests/`; os scripts de `tools/` falam com o D6 de verdade).
  Teste novo nunca usa o `config.yaml` de verdade: config sintético ou o `config.example.yaml`, em `tmp_path`.
- `python -m ruff check .`, `python -m ruff format .` e `python -m mypy` antes de commitar. Formatação vai em
  commit separado de mudança de lógica.
- Importar um módulo não liga nada. Plugins carregam e as peças compartilhadas saem de `app.bootstrap.services()`;
  quem precisa recebe por parâmetro (`Engine(..., plugins=, values=)`). Caminhos passam por `app/paths.py`.
- API do editor: uma função por rota em `app/editor/api/<assunto>.py`, com os tipos do pedido e da resposta em
  `app/editor/contract.py` e a entrada em `ROUTES` (`app/editor/api/__init__.py`). Mudou o formato: rode
  `python -m app.editor.contract` (o teste avisa). O servidor (`server.py`) só cuida do HTTP.
- Bug achado em teste de caracterização: registrar com `xfail(strict=True)` e avisar, sem corrigir junto.
- Plano da refatoração: `docs/plano-python.md`.

## Trabalho
- Responder em português do Brasil.
- `config.yaml` tem a senha do OBS: nunca mostrar, logar nem commitar. O repositório é público.
- Testes manuais no servidor de teste (porta 8799, com cópia do config), nunca no app real (8765). Desligar depois.
- Commit só quando pedirem. Commits em português, no formato "Área: o que mudou".
- Logs em inglês (loggers `deck.<área>`, segredos pelo `mask`), comentários em português, textos da interface com `t("English")`.
