# Controle próprio do Fifine D6

App do zero para o Fifine AmpliGame D6 (USB `3142:0060`), sem o software da Fifine.

## Estado

- [x] Fase 1: conectar e ler teclas (`tools/listen.py`)
- [x] Fase 2: enviar imagens para as telas (`tools/draw_test.py`, `tools/calibrate.py`)
- [x] Fase 3: app com ações genéricas, OBS, Discord, páginas e config recarregável (`python -m app`)
- [x] Bandeja do Windows, iniciar com o Windows, reconexão automática do D6
- [x] Editor visual no navegador
- [ ] Próximas: estado real do Discord, volume por aplicativo

## Usar o app

Instalar (Python 3.12 ou mais novo), na pasta do projeto:

```
pip install -e .
```

```
pythonw -m app --tray    # dia a dia: ícone na bandeja, sem janela (log em %LOCALAPPDATA%\D6Deck\app.log)
python -m app            # no terminal, com log na tela
python -m app --debug    # mostra teclas, estados e tempos de desenho
python -m app --editor   # já abre o editor no navegador
python -m app --check    # só valida o config
```

Menu da bandeja: Abrir editor (clique duplo no ícone), abrir config/pasta/log,
"Iniciar com o Windows" e Sair. Só roda uma instância por vez.

**Editor visual:** abre no navegador (http://127.0.0.1:8765, com um token secreto
na URL; acessível só pelo próprio PC). Edita ícones, ações, páginas e as
configurações gerais; salvar grava no `config.yaml` preservando comentários
(fica um `config.yaml.bak` com a versão anterior).

**Idiomas:** português e inglês, em Configurações › Geral (ou `language: pt-BR` / `language: en`
no config; sem a linha, segue o idioma do Windows). Vale para o editor, a bandeja, as mensagens
de erro e os plugins. O texto em inglês é a chave: as traduções ficam em
`app/editor/static/locales/pt-BR.json` (editor) e `app/locales/pt-BR.json` (Python). Os logs
ficam sempre em inglês.

Todas as ações, campos de ícone e opções estão documentados no topo de
`config.example.yaml`. O app recarrega o `config.yaml` sozinho ao salvar.

## Desenvolvimento

```
pip install -e ".[dev]"    # o app mais pytest, ruff e mypy
python -m pytest           # testes (não precisam do D6 plugado)
python -m ruff check .     # lint
python -m ruff format .    # formatação
python -m mypy             # tipos (só os módulos listados no pyproject.toml, por enquanto)
```

A CI do GitHub (`.github/workflows/ci.yml`) roda os quatro a cada push, no Windows.

Editor (React, em `editor/`; precisa do Node 22 ou mais novo). O app serve o `editor/dist` na raiz, com o
token no caminho (`http://127.0.0.1:8765/<token>/teclas`, o link da bandeja); sem o build, a página pede o `npm run build`:

```
cd editor
npm ci
npm run dev           # http://127.0.0.1:5173/<token>/teclas (a /api vai para o servidor de teste, porta 8799)
npm run check         # lint (inclui as regras do design system), tipos e contrato em dia
npm run build         # gera editor/dist, que o app serve na raiz
npm run gen:api       # tipos da API, depois de mudar app/editor/contract.py
npm run ref:capture   # prints de cada tela (editor/reference/; o servidor de tests/reference/serve.py)
```

## Executável e instalador

O `Deck.exe` (PyInstaller, modo pasta, sem console) e o `Deck-Setup.exe` (Inno Setup) saem de `packaging/`:

```
cd editor && npm ci && npm run build && cd ..          # o editor vai pronto dentro do pacote
python -m pip install -r packaging/requirements-build.txt     # num ambiente só para o build (versões exatas)
python -m PyInstaller packaging/deck.spec --noconfirm         # dist/Deck/Deck.exe
python packaging/check_exe.py dist/Deck/Deck.exe              # --check, recursos e um plugin, sem tocar no D6
iscc /DAppVersion=0.9.0 packaging/installer.iss               # packaging/Output/Deck-Setup.exe
```

A versão fica só em `app/__init__.py`. Ao criar uma tag `v<versão>`, a CI (`.github/workflows/release.yml`)
faz tudo isso e anexa o `Deck-Setup.exe` no Release.

No executável, o config, o histórico de versões e o `.bak` ficam em `%APPDATA%\Deck` (Arquivos de Programas não
aceita gravação); logs e plugins instalados continuam em `%LOCALAPPDATA%\D6Deck`. Na primeira abertura, um
`config.yaml` que esteja na pasta do `Deck.exe` é copiado para lá (o original fica onde estava). Em
desenvolvimento nada disso muda: o `config.yaml` é o da pasta do projeto. Para levar o config de desenvolvimento
para o executável: Configurações › Backup › Exportar no editor de um e Importar no do outro.

O `Deck.exe` ainda não tem assinatura digital. Por isso o "iniciar com o Windows" é ligado pelo instalador (a opção
na instalação): quando o próprio `Deck.exe` grava a chave de iniciar com o Windows, o Windows Defender o põe em
quarentena (`Behavior:Win32/Persistence.A!ml`). No executável, ligar pela bandeja ou pela Config explica isso;
desligar funciona. O SmartScreen também avisa ao abrir o instalador baixado. Os dois somem com a assinatura.

## Ferramentas de teste do aparelho

Falam com o D6 de verdade (por isso ficam fora do pytest):

```
python tools/listen.py          # aperte as teclas do D6
python tools/listen.py --raw    # também mostra os bytes crus recebidos
python tools/draw_test.py       # número colorido em cada tecla
python tools/calibrate.py       # padrão para medir a área visível da tela
```

Feche o app "fifine Control Deck" (inclusive da bandeja) antes de testar.

## Protocolo

Ver o comentário no topo de `d6/device.py`. Baseado em
[akksmash/omarchy-fifine-deck](https://github.com/akksmash/omarchy-fifine-deck) e
[micah1crandell/fifine-ampligame-d6](https://github.com/micah1crandell/fifine-ampligame-d6).
No Windows o output report tem 1025 bytes (1 de report ID + 1024).
Imagens: JPEG 112x112 girado 180°, cor 4:4:4, até 12 KB (o D6 aguenta ~16 KB), enviadas em pedaços de 1024 bytes só com BAT + dados + STP (sem sessão, então a iluminação não pisca). GIF animado = o app reenvia cada quadro na hora certa.
Luz: anel de 18 LEDs (LED 0 embaixo no meio, sentido horário), pacote `CRTAd` + 18 + RGB de cada LED, sem sessão. Os efeitos e as reações às teclas são animados pelo app (~30 quadros/s); o D6 só aceita depois de dois cliques rápidos no botão de trás.
Envio em lote (uma sessão para todas as teclas) funciona; página inteira em ~1.4 s com `settle: 0.25`.

## Estrutura

```
d6/                 driver do D6 (HID, protocolo CRT, imagens)
app/
  __main__.py       início do app (opções de linha de comando)
  bootstrap.py      monta as peças compartilhadas e carrega os plugins
  paths.py          onde ficam os recursos e os dados da pessoa
  errors.py, i18n.py, logs.py
  engine/           laço principal: teclas, páginas, estados, redesenho só do que mudou (engine.py liga as peças)
  config/           o config.yaml
    load.py         leitura e validação (build_config, load_config)
    model.py        o modelo tipado (Config, KeySpec)
    pages.py        validação de pages:; sections.py as outras seções
    yamlio.py       gravação do YAML preservando comentários
    storage.py      o arquivo em disco: gravar com backup; history.py as versões guardadas
    transfer.py     exportar e importar; firstrun.py primeira abertura do executável
  actions/          ações (basic.py); nova ação = função com @action("nome")
  plugins/          plugins: OBS, Discord e clima (embutidos, em builtin/) e os de terceiros; ver docs/plugins.md
  plugin_runner.py  o processo de um plugin de terceiros em Python (--run-plugin)
  editor/           servidor do editor: api/ (uma função por rota), contract.py (os tipos), schema.py, static/
  windows/          bandeja (tray.py), teclado simulado (keys.py), autostart, instância única, tela e volume (winutil.py)
  icons.py          desenho dos ícones (texto, Lucide, imagens; o Segoe antigo ainda é aceito); brand.py a marca
  lighting.py       luz do D6: efeitos e reações às teclas no anel de LEDs
  widgets.py, values.py, automations.py, binds.py   widgets, valores vivos, automações e atalhos
editor/             o editor visual (React + TypeScript + Tailwind); o build vai para editor/dist
tests/              testes automáticos (pytest)
tools/              ferramentas que falam com o D6 de verdade (fora do pytest)
packaging/          executável (PyInstaller) e instalador (Inno Setup)
examples/plugins/   plugin de exemplo (pomodoro)
docs/               plugins.md (como fazer um plugin), roadmap.md, design-system.md
```
