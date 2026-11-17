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
continuam em português.

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

- `d6/` driver do D6 (HID, protocolo CRT, imagens)
- `app/engine.py` loop principal: teclas, páginas, estados, redesenho só do que mudou
- `app/config.py` leitura/validação do YAML
- `app/icons.py` desenho dos ícones (texto, ícones do Lucide, imagens; o Segoe antigo ainda é aceito)
- `app/lighting.py` luz do D6: efeitos e reações às teclas no anel de LEDs
- `app/plugins/` plugins: o OBS e o Discord (embutidos) e os de terceiros (programas separados); ver PLUGINS.md
- `app/editor/` servidor e interface do editor visual
- `tests/` testes automáticos (pytest)
- `app/configio.py` gravação do YAML preservando comentários
- `app/schema.py` descrição das ações para o editor
- `app/tray.py`, `app/winutil.py` bandeja, autostart, instância única
- `app/actions/` ações (`basic.py`, `obs.py`, `discord.py`); nova ação = função com `@action("nome")`
