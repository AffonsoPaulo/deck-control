# Plugins do D6

Um plugin acrescenta ações, configurações e estados ao app. Ele aparece em
**Configurações › Integrações** (com liga/desliga, passo a passo e campos) e as ações dele
entram na biblioteca do editor, numa categoria com a cor do plugin.

O OBS e o Discord já são plugins: estão em `app/plugins/builtin/` e servem de exemplo de
`plugin.json`. Um plugin de terceiros completo, o Pomodoro, está em `examples/plugins/pomodoro`
(com o `run` do jeito antigo, `["python", "main.py"]`, que continua valendo).

## Como funciona

- Plugins de terceiros rodam como **um programa separado**, em qualquer linguagem. O app abre o
  programa e conversa com ele por JSON, uma mensagem por linha, no stdin e no stdout.
- Se o plugin travar ou cair, o D6 continua funcionando. O app reinicia o plugin até 3 vezes por
  minuto; depois disso, mostra "Parou" nas Integrações.
- O plugin só mexe no app por essas mensagens: responde ações, liga/desliga estados (que trocam o
  ícone das teclas) e mostra um estado curto nas Integrações. Mas ele é um programa como outro
  qualquer no PC, então **instale só plugins de quem você confia**.
- Os plugins instalados ficam na pasta `plugins` dos dados do app
  (`%LOCALAPPDATA%\D6Deck\plugins\<id>`). A configuração de cada um fica no config.yaml, em
  `plugins: <id>:`.

## Instalar

No editor: **Configurações › Integrações › Instalar plugin (.zip)**. O .zip pode ter o
`plugin.json` na raiz ou numa pasta só. Antes de instalar, o editor mostra o nome, o autor, a
versão, as ações e o que o plugin diz que faz, avisa que ele é um programa rodando no PC e pede
confirmação. Um plugin que pede uma versão do protocolo mais nova que a do app não instala: a
mensagem diz para atualizar o Deck. Depois de instalado, o plugin começa **desligado**: ative pelo
interruptor dele. O log do app registra cada instalação (autor, homepage e o que o plugin roda).

## Como o plugin roda

O campo `runtime` diz quem abre o programa do plugin:

- **`"exe"`**: o `run` é um programa que o plugin traz, em qualquer linguagem (Python empacotado,
  Node, C#, Go…), mais os argumentos: `"run": ["bin/meu-plugin.exe", "--x"]`. Um programa que está
  na pasta do plugin é aberto de lá; outro nome (`"node"`, `"dotnet"`) vem do PATH do Windows.
- **`"deck-python"`**: plugin em Python, rodado pelo próprio app, com o Python dele (no executável do
  Deck, sem precisar de um Python instalado). O `run` é o script e os argumentos:
  `"run": ["main.py"]`; também aceita `["-m", "meu_plugin"]` e as opções `-u` e `-B`.
  - As bibliotecas do plugin vão numa pasta `lib/` dentro dele (por exemplo,
    `pip install --target lib requests`): ela entra no caminho do Python antes das do app.
  - Só bibliotecas em Python puro. Biblioteca compilada (`.pyd`) ou outra versão do Python: use `"exe"`.
  - O plugin roda como `python main.py` na pasta dele: o `sys.argv`, o `__name__ == "__main__"` e o
    `__file__` são os de sempre, e ele não enxerga os módulos do app.
- **Sem `runtime`** (plugins de antes): um `run` que começa com `python` (ou `python3`, `pythonw`)
  vale como `"deck-python"`; qualquer outro, como `"exe"`. Um desses com outra opção do Python
  (`["python", "-X", "utf8", "main.py"]`) continua abrindo como antes, com o Python do app direto.

O campo `protocol` diz a versão do [protocolo](#protocolo-versão-1) que o plugin precisa (padrão: 1).
Se o app tiver uma versão menor, o plugin não carrega e o editor explica que é preciso atualizar o
Deck. Hoje a versão é 1.

## plugin.json

```json
{
  "id": "pomodoro",
  "name": "Pomodoro",
  "version": "1.0.0",
  "author": "Seu nome",
  "description": "Uma linha sobre o que o plugin faz",
  "icon": "timer",
  "color": "#e5484d",
  "category": "Pomodoro",
  "runtime": "deck-python",
  "protocol": 1,
  "run": ["main.py"],
  "permissions": ["Toca um som do Windows quando o tempo acaba"],
  "settings": [
    {"name": "focus", "kind": "number", "label": "Minutos de foco", "default": 25, "half": true}
  ],
  "steps": ["Ative o plugin.", "Arraste a ação **Começar ou pausar** para uma tecla."],
  "states": [["pomodoro.running", "O Pomodoro está correndo"]],
  "actions": {
    "pomodoro.toggle": {
      "label": "Começar ou pausar",
      "help": "Texto de ajuda da ação",
      "state": "pomodoro.running",
      "icon": "timer",
      "fields": [
        {"name": "minutes", "kind": "number", "label": "Minutos"}
      ]
    }
  }
}
```

| Campo | O que é |
|---|---|
| `id` | De 2 a 40 letras minúsculas, números, `-` ou `_`, começando por letra. |
| `name`, `version`, `author`, `description` | Aparecem nas Integrações e na hora de instalar. |
| `icon` | Nome de um ícone do [Lucide](https://lucide.dev/icons). |
| `color` | Cor da categoria na biblioteca e do ícone nas Integrações. |
| `category` | Nome da categoria das ações na biblioteca (padrão: `name`). |
| `runtime` | `"exe"` ou `"deck-python"`. Ver [Como o plugin roda](#como-o-plugin-roda). |
| `run` | Linha de comando, em lista, rodada na pasta do plugin: o programa e os argumentos (`exe`) ou o script e os argumentos (`deck-python`). |
| `protocol` | A versão do protocolo que o plugin precisa (padrão: 1). |
| `permissions` | O que o plugin faz fora do app, em texto (aparece antes de instalar). |
| `settings` | Campos da integração. `kind`: `text`, `password`, `number`, `bool`, `enum` (com `options: [[valor, rótulo]]`), `shortcut` (um atalho de teclado; ver [Atalhos](#atalhos)). Opcionais: `default`, `placeholder`, `help`, `half` (dois `half` seguidos ficam lado a lado), `style: "pills"` (num `enum`, mostra botões em vez de lista; bom para escolher um modo) e `when` (ver abaixo). `enabled` é reservado. |
| `steps` | Passo a passo do "Como configurar". `**texto**` vira destaque; `{nome}` vira o valor da configuração `nome`. Um passo também pode ser `{"text": "...", "when": {...}}`. |
| `states` | Estados que o plugin publica, com a descrição usada nas condições ("Se…") do editor. Devem começar com `<id>.`. |
| `default_locale` | Idioma usado quando falta a tradução de um texto (padrão: `en`). Ver [Idiomas](#idiomas). |
| `actions` | As ações. O tipo deve começar com `<id>.`. `fields` usa os mesmos tipos do editor (`text`, `textarea`, `number`, `bool`, `enum`, `json`…). `state` liga a tecla a um estado (o ícone ativo aparece quando ele estiver ligado). `short`: nome curto que o editor põe na tecla. Um campo `{"name": "keys", "kind": "bind"}` dá à tecla um atalho próprio (ver [Atalhos](#atalhos)). |
| `shortcut_rules` | Que combinações o programa do plugin aceita, para o editor só gerar atalhos que funcionam nele. Ver [Atalhos](#atalhos). |

## Atalhos

Quando o plugin conversa com um programa por atalhos de teclado (como o Discord), o app cuida de três coisas:

- **Gerar um atalho seguro.** O editor cria combinações com F13–F24 (teclas que nenhum teclado tem)
  que não batem com nenhum outro atalho do app. Se o programa não aceita alguma combinação,
  `shortcut_rules` diz o que ele aceita:

  ```json
  "shortcut_rules": {"keys": "f13-f24", "modifiers": ["", "shift", "alt", "shift+alt"]}
  ```

  `modifiers` vai na ordem de preferência (`""` = a tecla sozinha). Sem regras, vale tudo de
  Ctrl+Shift+Alt até a tecla sozinha. Também pode ir dentro de uma ação, só para ela.
- **Avisar sobreposições.** Ações das teclas e campos `shortcut` dos plugins ligados entram na mesma
  conta. Duas teclas com a mesma ação de plugin podem dividir o atalho (duas teclas de "Apertar para
  falar"); coisas diferentes com a mesma combinação aparecem com aviso no editor (dá para salvar mesmo assim).
- **Enviar pelo D6.** Todo campo de atalho tem "Enviar em 5 s" e "Enviar pelo D6": este faz a próxima
  tecla do D6 apertada mandar só aquele atalho, sem rodar a ação, para o programa que está gravando
  registrar a combinação.

Dois jeitos de usar:

- Configuração `"kind": "shortcut"`: um atalho da integração inteira (o "Mutar microfone" do Discord).
  O plugin lê o valor como qualquer outra configuração.
- Campo de ação `{"name": "keys", "kind": "bind", "required": true, "hint": "No programa, clique em Gravar"}`:
  cada tecla ganha o atalho próprio, gerado quando a ação é posta na tecla; `hint` aparece no passo a passo.
  Com `"mirror": true` na ação, o app segura o atalho enquanto a tecla do D6 estiver apertada (apertar para falar).

## Valores e painéis

Um plugin pode publicar **valores** (informações vivas) que qualquer tecla, regra, condição do
"Se" ou automação usa, e **widgets** prontos para mostrar esses valores em uma ou mais teclas.

- Embutidos: `api.set_value("clima.temperatura", 28)`. Externos: `{"type": "value", "name": "clima.temperatura", "value": 28}`.
  O nome começa com `<id>.`. `None`/`null` apaga o valor (a tecla mostra "–"). Desligar o plugin apaga os dele.
- Declare os valores no `plugin.json`, para aparecerem na lista do editor com um exemplo:

  ```json
  "values": [{"id": "weather.temp", "label": "%value.temp%", "kind": "number", "sample": 28}]
  ```

  `kind`: `text`, `number`, `bool`, `icon` (nome de ícone do Lucide), `image` (caminho) ou `color`.
  Os `states` do plugin também viram valores sim/não automaticamente.
- **Widgets**: peças prontas que a pessoa arrasta da biblioteca (aba Widgets) para o Deck. Para cada
  tamanho aceito (`"linhas x colunas"`, até 3x5), uma lista de linhas com o que vai em cada tecla. Uma
  tecla pode ter `text`, `sub` (linha menor), `lucide`, `image`, `bg`, `fg` e `bar`, com `{valores}`
  dentro; um campo que é só um valor (`"lucide": "{weather.icon}"`) usa o valor cru.

  ```json
  "widgets": {"weather.now": {
    "label": "%widget.now%", "icon": "sun", "category": "weather",
    "options": [{"name": "below", "kind": "choice", "label": "%opt.below%", "default": "{weather.max}° / {weather.min}°",
                 "choices": [["{weather.max}° / {weather.min}°", "%opt.maxmin%"], ["{weather.rain}%", "%opt.rain%"]]}],
    "sizes": {
      "1x2": [[{"lucide": "{weather.icon}"}, {"text": "{weather.temp}°", "sub": "{opt.below}"}]]
    }
  }}
  ```

  - `category`: uma das categorias fixas do app: `time`, `system`, `stream`, `media`, `weather`,
    `chat` ou `other`. A biblioteca agrupa por categoria e, quando uma categoria tem widgets de
    mais de uma origem, separa por plugin.
  - `options`: o que a pessoa ajusta no inspetor. `kind`: `choice` (com `choices`), `bool`, `number`,
    `text`, `color`, `glyph` (ícone) ou `value` (um valor do app ou de plugins; `kinds` filtra:
    `["number"]`). Nos textos do modelo, `{opt.<nome>}` vira o valor escolhido antes de os `{valores}`
    serem lidos: a opção pode trazer valores (como no exemplo) ou montar o nome de um
    (`{clock.hour{opt.format}}` vira `{clock.hour12}`).
    Para uma parte que muda conforme a opção, use uma variante: `{"$opt": "<nome>", "<valor>": ...}`
    vira o ramo do valor escolhido (`true`/`false` para `bool`); sem ramo para o valor, a parte some.
    Ex.: `"sub": {"$opt": "labels", "true": "horas"}` mostra a legenda só com a opção ligada, e uma
    célula inteira pode ser `{"$opt": "third", "date": {...}, "seconds": {...}}`.
  - **Animações.** Duas formas, que valem para widgets de plugin, da pessoa e do app:
    - `"transition": "flip"` numa célula: quando o texto muda (um número, por exemplo), o velho desce e o
      novo entra por cima, em 300 ms. Precisa de fundo liso (com degradê ou imagem de fundo, desenha direto).
      Para a pessoa poder desligar: uma opção `bool` e `"transition": {"$opt": "animate", "true": "flip"}`.
      Nome que o app não conhece desenha direto (mais transições virão).
    - **A animação do próprio plugin:** um GIF com `"loop": false` toca uma vez e para no último quadro. Ex.:
      o clima muda de ensolarado para nublado; o plugin publica o valor `clima.anim` com o caminho de
      `sol-para-nuvem.gif` e a célula tem `{"image": "{clima.anim}", "loop": false}`. A tecla toca a
      transição e fica na nuvem. Um redesenho qualquer não recomeça; ícone novo ou voltar à página, sim.
      Sem `"loop": false`, o GIF repete como sempre. Quem manda os quadros ao Deck é sempre o app (no ritmo
      e com os limites dele): o plugin não envia imagens direto.
  - `action` / `hold` (opcional): o que a tecla faz ao apertar / segurar, já preenchido quando a pessoa
    coloca o widget (ela pode trocar depois). `$id` vira um id único da tecla.

  O plugin de clima embutido (`app/plugins/builtin/weather`) é um exemplo completo.

### Campos que dependem de um modo

`"when": {"mode": "rpc"}` numa configuração ou num passo faz ele aparecer só quando a
configuração `mode` vale `rpc` (aceita lista: `{"mode": ["a", "b"]}`). O Discord embutido usa
isso para ter dois jeitos de conectar na mesma integração.

## Idiomas

O app fala português (`pt-BR`) e inglês (`en`). Um plugin pode acompanhar: no lugar do texto,
escreva `"%chave%"` no `plugin.json` e coloque as traduções numa pasta `locales/`, um arquivo por idioma:

```
pomodoro/
  plugin.json
  locales/
    en.json
    pt-BR.json
```

```json
// plugin.json
"default_locale": "en",
"description": "%description%",
"settings": [{"name": "focus", "kind": "number", "label": "%setting.focus.label%", "default": 25}]
```

```json
// locales/pt-BR.json
{"description": "Ciclos de foco e pausa", "setting.focus.label": "Minutos de foco"}
```

- Vale para `description`, `author`, `category`, `permissions`, `steps`, a descrição dos `states` e,
  nas `settings` e nas `actions`, `label`, `help` e os rótulos de `options`. `id`, `name`, `icon`,
  `placeholder` e os valores ficam como estão.
- A busca é: o idioma exato (`pt-BR`), depois o idioma base (`pt.json`), depois o `default_locale`,
  e por fim a própria chave. Uma chave que falta em algum arquivo aparece como aviso no log.
- Texto comum, sem `%`, continua valendo: um plugin que só fala uma língua não precisa de nada disso.
- Os textos que o plugin manda em tempo de execução (`status.label`, `result.error`) são dele:
  o app informa o idioma no `hello` (`"locale"`) e manda `{"type": "locale", "locale": "en"}` se a
  pessoa trocar o idioma. O exemplo `examples/plugins/pomodoro` lê os mesmos `locales/*.json` para isso.

## Protocolo (versão 1)

O app abre o programa do plugin na pasta dele, sem janela, e conversa por JSON em UTF-8, **um
objeto por linha**, no stdin (app → plugin) e no stdout (plugin → app). O ambiente traz
`D6_PLUGIN_ID` (o id do plugin), `PYTHONIOENCODING=utf-8` e `PYTHONUNBUFFERED=1`.

Quando cada coisa acontece:

| Momento | O app manda |
|---|---|
| A pessoa liga o plugin (ou o app abre com ele ligado), e depois de cada reinício | abre o programa e manda `hello` |
| O config é lido de novo com o plugin ligado | `settings`, se as configurações mudaram; `locale`, se o idioma mudou |
| Uma tecla (ou automação) roda uma ação do plugin | `action`, e espera o `result` |
| A pessoa desliga o plugin, ou o app vai fechar | `stop` |

App → plugin:

```json
{"type": "hello", "protocol": 1, "plugin": "pomodoro", "locale": "pt-BR", "settings": {"focus": 25}}
{"type": "settings", "settings": {"focus": 30}}
{"type": "locale", "locale": "en"}
{"type": "action", "id": 7, "action": "pomodoro.toggle", "params": {}, "page": "main", "key": 3}
{"type": "stop"}
```

- `settings` traz todas as configurações (com os padrões do `plugin.json`), inclusive as senhas:
  não escreva o `hello` nem o `settings` no log.
- `params` são os campos da ação na tecla (sem o `type`). `page` e `key` dizem de onde veio.

Plugin → app:

```json
{"type": "result", "id": 7, "ok": true}
{"type": "result", "id": 8, "ok": false, "error": "texto do erro"}
{"type": "state", "name": "pomodoro.running", "value": true}
{"type": "value", "name": "pomodoro.left", "value": 12}
{"type": "status", "state": "ok", "label": "Foco: 12 min"}
{"type": "log", "message": "vai para o log do app", "level": "info"}
```

- Toda `action` precisa de um `result` com o mesmo `id` em até 10 segundos; senão a tecla mostra
  erro. Com `"ok": false`, o `error` aparece no log e a tecla mostra erro.
- `state` e `value`: o nome começa com `<id>.`; outro nome é ignorado (com aviso no log).
  `value: null` apaga o valor. Desligar o plugin apaga os valores dele.
- `status.state`: `ok`, `wait` ou `error` (outro vira `ok`). O `label` aparece nas Integrações
  (até 40 letras).
- `log.level`: `debug`, `info` (padrão), `warn` ou `error`.
- Texto que não for JSON no stdout vai para o log do app; tudo no stderr também, como aviso.
- `locale` é `pt-BR` ou `en`. Plugins que não traduzem nada podem ignorar a mensagem `locale`.
- Ao receber `stop`, feche em até 2 segundos; depois disso o app encerra o processo.
- Se o programa fechar sozinho, o app avisa no editor e abre de novo (com outro `hello`), até 3
  vezes por minuto; depois disso, mostra "Parou" nas Integrações. O aviso some quando o plugin
  manda uma mensagem ou fica 15 s de pé.
- Um app com uma versão do protocolo menor que o `protocol` do manifesto não carrega o plugin.
  Mudanças que plugins antigos entendem (uma mensagem nova, um campo novo) não mudam a versão.

## Plugin mínimo (Python)

Com `"runtime": "deck-python"` e `"run": ["main.py"]` no `plugin.json`:

```python
import json, sys

def send(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    msg = json.loads(line)
    if msg["type"] == "hello":
        send({"type": "status", "state": "ok", "label": "Pronto"})
    elif msg["type"] == "action":
        # faça o que a ação pede com msg["params"]
        send({"type": "result", "id": msg["id"], "ok": True})
    elif msg["type"] == "stop":
        break
```

## Plugins embutidos

Os embutidos (`app/plugins/builtin/<id>`) rodam dentro do app, em Python, com `"entry": "plugin.py"`
no lugar de `run`. A pasta é carregada como pacote, então o `plugin.py` pode importar outros
arquivos dela (`from .rpc import DiscordRPC`). Eles podem usar `"config_key"` para guardar a
configuração numa seção própria do config (`obs:`, `discord:`) e `"default_enabled"`.

O ciclo de vida (o mesmo dos de terceiros, que passam por ele com o `hello`/`stop`):

1. **Carregar**, ao abrir o app e depois de instalar ou remover um plugin: o app importa o
   `plugin.py` e chama `setup(api)`. Aqui o plugin registra as ações com `@api.action(...)` e
   devolve o objeto que o app liga e desliga. Ainda não deve abrir conexões nem threads.
2. **Ligar**, quando o config liga o plugin: `start(settings)`.
3. **Atualizar**, a cada leitura do config com o plugin ligado: `update(settings)` e
   `set_locale(idioma)` (as configurações e o idioma podem ser os mesmos de antes).
4. **Desligar**, quando o config desliga o plugin ou o app vai fechar: `stop()`. Depois disso, o app
   apaga os valores do plugin e fecha os problemas `plugin.<id>.…` que ele abriu.

Todos os métodos do objeto são opcionais; `current_status()` devolve
`{"state": "ok|wait|error", "label": "...", "detail": "..."}` para as Integrações. Um erro no
`start` aparece como "Não iniciou", e o app tenta de novo na próxima leitura do config.

O `api` (`app/plugins/api.py`) é a porta do plugin para o app:

| | |
|---|---|
| `api.action(nome, required=(), state=None, check=None, mirror=False)` | Decorador que registra uma ação do plugin. |
| `api.set_state(nome, valor)` | Liga/desliga um estado (`<id>.…`). |
| `api.set_value(nome, valor)` | Publica um valor (`<id>.…`); `None` apaga. |
| `api.set_status(state, label)` | O status nas Integrações (quando não há `current_status()`). |
| `api.log` | O log do plugin (`deck.plugins.<id>`), em inglês. |
| `api.language()` | O idioma do app agora (`pt-BR` ou `en`). |
| `api.id`, `api.folder` | O id e a pasta do plugin. |
| `api.engine` | O engine, para o que a API ainda não cobre (`None` antes de o app ligar). |

Os textos do `plugin.json` seguem as mesmas regras de [Idiomas](#idiomas); os do Python usam
`tr("texto em inglês")` de `app.i18n`, com a tradução em `app/locales/pt-BR.json`.
