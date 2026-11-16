# Plugins do D6

Um plugin acrescenta ações, configurações e estados ao app. Ele aparece em
**Configurações › Integrações** (com liga/desliga, passo a passo e campos) e as ações dele
entram na biblioteca do editor, numa categoria com a cor do plugin.

O OBS e o Discord já são plugins: estão em `app/plugins/builtin/` e servem de exemplo de
`plugin.json`. Um plugin de terceiros completo, o Pomodoro, está em `examples/plugins/pomodoro`.

## Como funciona

- Plugins de terceiros rodam como **um programa separado**, em qualquer linguagem. O app abre o
  programa e conversa com ele por JSON, uma mensagem por linha, no stdin e no stdout.
- Se o plugin travar ou cair, o D6 continua funcionando. O app reinicia o plugin até 3 vezes por
  minuto; depois disso, mostra "Parou" nas Integrações.
- O plugin só mexe no app por essas mensagens: responde ações, liga/desliga estados (que trocam o
  ícone das teclas) e mostra um estado curto nas Integrações. Mas ele é um programa como outro
  qualquer no PC, então **instale só plugins de quem você confia**.
- Os plugins instalados ficam na pasta `plugins` dos dados do app
  (`%LOCALAPPDATA%\D6\plugins\<id>`). A configuração de cada um fica no config.yaml, em
  `plugins: <id>:`.

## Instalar

No editor: **Configurações › Integrações › Instalar plugin (.zip)**. O .zip pode ter o
`plugin.json` na raiz ou numa pasta só. O editor mostra o nome, o autor, as ações e o que o plugin
diz que faz antes de instalar. Depois de instalado, o plugin começa **desligado**: ative pelo
interruptor dele.

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
  "run": ["python", "main.py"],
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
| `run` | Linha de comando, em lista, rodada na pasta do plugin. `python` usa o mesmo Python do app. |
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
"Se" ou automação usa, e **painéis** prontos para mostrar esses valores em blocos de teclas.

- Embutidos: `api.set_value("clima.temperatura", 28)`. Externos: `{"type": "value", "name": "clima.temperatura", "value": 28}`.
  O nome começa com `<id>.`. `None`/`null` apaga o valor (a tecla mostra "–"). Desligar o plugin apaga os dele.
- Declare os valores no `plugin.json`, para aparecerem na lista do editor com um exemplo:

  ```json
  "values": [{"id": "weather.temp", "label": "%value.temp%", "kind": "number", "sample": 28}]
  ```

  `kind`: `text`, `number`, `bool`, `icon` (nome de ícone do Lucide), `image` (caminho) ou `color`.
  Os `states` do plugin também viram valores sim/não automaticamente.
- **Painéis**: para cada tamanho aceito (`"linhas x colunas"`), uma lista de linhas com o que vai em
  cada tecla. Uma tecla pode ter `text`, `sub` (linha menor), `lucide`, `image`, `bg`, `fg` e `bar`,
  com `{valores}` dentro; um campo que é só um valor (`"lucide": "{weather.icon}"`) usa o valor cru.

  ```json
  "panels": {"weather.now": {"label": "%panel.now%", "icon": "sun", "sizes": {
    "1x2": [[{"lucide": "{weather.icon}"}, {"text": "{weather.temp}°", "sub": "{weather.max}° / {weather.min}°"}]]
  }}}
  ```

  No editor, o painel aparece em "Mostrar informação" com uma peça para cada tamanho, que a pessoa
  arrasta e encaixa na grade. O plugin de clima embutido (`app/plugins/builtin/weather`) é um exemplo completo.

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

App → plugin:

```json
{"type": "hello", "protocol": 1, "plugin": "pomodoro", "locale": "pt-BR", "settings": {"focus": 25}}
{"type": "settings", "settings": {"focus": 30}}
{"type": "locale", "locale": "en"}
{"type": "action", "id": 7, "action": "pomodoro.toggle", "params": {}, "page": "main", "key": 3}
{"type": "stop"}
```

Plugin → app:

```json
{"type": "result", "id": 7, "ok": true}
{"type": "result", "id": 8, "ok": false, "error": "texto do erro"}
{"type": "state", "name": "pomodoro.running", "value": true}
{"type": "status", "state": "ok", "label": "Foco: 12 min"}
{"type": "log", "message": "vai para o log do app"}
```

- Toda `action` precisa de um `result` com o mesmo `id` em até 10 segundos.
- `status.state`: `ok`, `wait` ou `error`. O `label` aparece nas Integrações (até 40 letras).
- Texto que não for JSON no stdout, e tudo no stderr, vai para o log do app.
- `locale` é `pt-BR` ou `en`. Plugins que não traduzem nada podem ignorar a mensagem `locale`.
- Ao receber `stop`, feche em até 2 segundos; depois disso o app encerra o processo.

## Plugin mínimo (Python)

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
arquivos dela (`from .rpc import DiscordRPC`). O `plugin.py` define `setup(api)`, registra as ações com `@api.action(...)` e
devolve um objeto com `start(settings)`, `update(settings)`, `stop()` e, se quiser,
`current_status()`. Eles podem usar `"config_key"` para guardar a configuração numa seção própria
do config (`obs:`, `discord:`) e `"default_enabled"`.
Os textos do `plugin.json` seguem as mesmas regras de [Idiomas](#idiomas); os do Python usam
`tr("texto em inglês")` de `app.i18n`, com a tradução em `app/locales/pt-BR.json`.
