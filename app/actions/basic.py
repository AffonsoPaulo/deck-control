"""Ações genéricas."""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import time
import urllib.request
import webbrowser

from app import keys, logs
from app.actions import Context, action, run
from app.i18n import tr

log = logs.get("actions")


def check_combos(spec: dict) -> list[str]:
    """Erros de combinações com tecla desconhecida (ex.: 'ctrl+shfit+m')."""
    combos = spec.get("keys")
    combos = combos if isinstance(combos, list) else [combos]
    errors = []
    for combo in combos:
        if not combo:
            errors.append(tr("empty shortcut"))
            continue
        try:
            keys.parse_combo(str(combo))
        except ValueError as e:
            errors.append(str(e))
    return errors


@action("hotkey", required=("keys",), check=check_combos)
def hotkey(spec: dict, ctx: Context) -> None:
    """Atalho de teclado. keys: "ctrl+shift+m" ou lista ["ctrl+c", "ctrl+v"].
    hold_ms: quanto tempo segurar (padrão 30). delay_ms: pausa entre combinações (padrão 50)."""
    combos = spec["keys"] if isinstance(spec["keys"], list) else [spec["keys"]]
    for i, combo in enumerate(combos):
        if i:
            time.sleep(spec.get("delay_ms", 50) / 1000)
        keys.press_combo(combo, hold_ms=spec.get("hold_ms", 30))


@action("bind", required=("keys",), check=check_combos)
def bind(spec: dict, ctx: Context) -> None:
    """Combinação exclusiva da tecla, para vincular em outro programa (Discord, OBS, jogos).
    Quando é a ação principal da tecla (sem 'hold') e mirror não é false, o engine
    segura a combinação enquanto a tecla do D6 estiver apertada; aqui é o toque simples
    (usado dentro de sequências, ao segurar etc.)."""
    keys.press_combo(str(spec["keys"]), hold_ms=spec.get("hold_ms", 40))


@action("text", required=("text",))
def text(spec: dict, ctx: Context) -> None:
    """Digita um texto. delay_ms: pausa entre caracteres. enter: true para apertar Enter no fim."""
    keys.type_text(str(spec["text"]), delay_ms=spec.get("delay_ms", 0))
    if spec.get("enter"):
        keys.press_combo("enter")


@action("media", required=("key",))
def media(spec: dict, ctx: Context) -> None:
    """Tecla de mídia: play_pause, next, prev, stop, vol_up, vol_down, mute. repeat: N vezes."""
    for _ in range(int(spec.get("repeat", 1))):
        keys.press_combo(spec["key"], hold_ms=10)


@action("launch", required=("target",))
def launch(spec: dict, ctx: Context) -> None:
    """Abre programa, arquivo, pasta ou URL. args: argumentos (string ou lista). cwd: pasta."""
    target = os.path.expandvars(os.path.expanduser(str(spec["target"])))
    args = spec.get("args")
    if args is None and "://" in target:
        webbrowser.open(target)
        return
    if args is None:
        os.startfile(target)  # usa a associação do Windows (como dar duplo clique)
        return
    argv = [target] + (args if isinstance(args, list) else shlex.split(str(args), posix=False))
    subprocess.Popen(argv, cwd=spec.get("cwd"), creationflags=subprocess.DETACHED_PROCESS)


@action("command", required=("command",))
def command(spec: dict, ctx: Context) -> None:
    """Roda um comando de shell. shell: cmd (padrão) | powershell. wait: true para esperar terminar.
    hide: true (padrão) para não abrir janela."""
    cmd = str(spec["command"])
    if spec.get("shell", "cmd") == "powershell":
        argv = ["powershell", "-NoProfile", "-Command", cmd]
    else:
        argv = ["cmd", "/c", cmd]
    flags = subprocess.CREATE_NO_WINDOW if spec.get("hide", True) else 0
    p = subprocess.Popen(argv, cwd=spec.get("cwd"), creationflags=flags)
    if spec.get("wait"):
        p.wait()


@action("http", required=("url",))
def http(spec: dict, ctx: Context) -> None:
    """Requisição HTTP (webhooks, Home Assistant, etc.).
    method: GET/POST/... (padrão GET, ou POST se houver body/json). headers: {...}.
    json: objeto enviado como JSON. body: texto cru. timeout: segundos (padrão 5)."""
    headers = dict(spec.get("headers") or {})
    data = None
    if "json" in spec:
        data = json.dumps(spec["json"]).encode()
        headers.setdefault("Content-Type", "application/json")
    elif "body" in spec:
        data = str(spec["body"]).encode()
    method = spec.get("method", "POST" if data is not None else "GET").upper()
    req = urllib.request.Request(spec["url"], data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=spec.get("timeout", 5)) as resp:
        log.debug("http %s %s -> %s", method, spec["url"], resp.status)


@action("delay", required=("ms",))
def delay(spec: dict, ctx: Context) -> None:
    """Espera N milissegundos (útil dentro de 'multi')."""
    time.sleep(spec["ms"] / 1000)


@action("multi", required=("actions",), children=lambda s: s["actions"])
def multi(spec: dict, ctx: Context) -> None:
    """Executa uma lista de ações em sequência."""
    for a in spec["actions"]:
        run(a, ctx)


def _toggle_state(spec: dict, key_id: str) -> str:
    return spec.get("state") or f"toggle:{key_id}"


@action("toggle", required=("on",), state=_toggle_state,
        children=lambda s: [s["on"]] + ([s["off"]] if "off" in s else []))
def toggle(spec: dict, ctx: Context) -> None:
    """Alterna entre dois estados. Na 1ª vez roda 'on', na 2ª 'off' (ou 'on' de novo se não houver 'off').
    O ícone usa 'active_icon' enquanto estiver ligado. state: nome para compartilhar o estado entre teclas."""
    name = _toggle_state(spec, ctx.key_id)
    new = not ctx.engine.get_state(name)
    ctx.engine.set_state(name, new)
    run(spec["on"] if new else spec.get("off", spec["on"]), ctx)


def _if_children(spec: dict) -> list:
    return list(spec.get("then") or []) + list(spec.get("else") or [])


def _check_if(spec: dict) -> list[str]:
    if spec.get("value"):
        from app import values
        return values.check_cond(spec, "if")
    return [] if spec.get("state") else [tr("'if' needs a 'state' or a 'value' to test")]


@action("if", children=_if_children, check=_check_if)
def if_(spec: dict, ctx: Context) -> None:
    """Se uma condição valer, roda 'then'; senão roda 'else'.
    Com estado: {type: if, state: obs.recording, is: true, then: [...], else: [...]}
    Com valor:  {type: if, value: weather.temp, op: gt, to: 30, then: [...]}"""
    if spec.get("value"):
        from app import values
        current = values.test(spec, ctx.engine.values.get)
        wanted = spec.get("is", True) is not False
    else:
        current = ctx.engine.get_state(str(spec["state"]))
        wanted = bool(spec.get("is", True))
    branch = spec.get("then") if current == wanted else spec.get("else")
    for a in branch or []:
        run(a, ctx)


@action("set_state", required=("state", "value"))
def set_state(spec: dict, ctx: Context) -> None:
    """Define um estado manualmente (para corrigir/sincronizar ícones). value: true | false | toggle."""
    name = spec["state"]
    value = spec["value"]
    if str(value).lower() == "toggle":
        value = not ctx.engine.get_state(name)
    ctx.engine.set_state(name, bool(value))


@action("page", required=("page",))
def page(spec: dict, ctx: Context) -> None:
    """Troca de página. page: nome da página, 'back' (volta) ou 'home' (página inicial)."""
    ctx.engine.go_to_page(str(spec["page"]))


@action("brightness")
def brightness(spec: dict, ctx: Context) -> None:
    """Brilho das telas. value: 0..100 (absoluto) ou step: +10 / -10 (relativo, em ciclo)."""
    if "value" in spec:
        ctx.engine.set_brightness(int(spec["value"]))
    else:
        ctx.engine.set_brightness(int(spec.get("step", 25)), relative=True)


@action("none")
def none(spec: dict, ctx: Context) -> None:
    """Não faz nada (útil para teclas só decorativas)."""


# -- respostas temporárias: tomam conta do Deck por alguns segundos e devolvem tudo como estava ------

def _secs(spec, default):
    try:
        return max(0.3, min(600.0, float(spec.get("seconds", default))))
    except (TypeError, ValueError):
        return default


@action("light.flash")
def light_flash(spec: dict, ctx: Context) -> None:
    """Pinta o anel de luz inteiro numa cor por alguns segundos. blink: true pisca."""
    ctx.engine.flash_light(str(spec.get("color") or "#22c55e"), _secs(spec, 3), bool(spec.get("blink")))


@action("screens.paint")
def screens_paint(spec: dict, ctx: Context) -> None:
    """Pinta as 15 telas numa cor (com ícone e texto opcionais) por alguns segundos.
    dismiss: apertar uma tecla encerra antes (padrão true). passthrough: a tecla apertada roda a ação dela."""
    icon = {"bg": str(spec.get("color") or "#b4232a")}
    if spec.get("lucide"):
        icon["lucide"] = str(spec["lucide"])
        icon["style"] = "big"
    if spec.get("text"):
        icon["text"] = str(spec["text"])
    ctx.engine.paint_screens(icon, _secs(spec, 3), spec.get("dismiss", True) is not False, bool(spec.get("passthrough")))


@action("page.temp", required=("page",))
def page_temp(spec: dict, ctx: Context) -> None:
    """Mostra uma página por alguns segundos e volta sozinho para a anterior.
    dismiss: apertar uma tecla fecha antes (padrão true). passthrough: a tecla apertada roda a ação dela.
    show_left: uma tecla vazia da página vira "Fechar" com o tempo que falta. light: cor do anel enquanto aparece."""
    ctx.engine.show_temp_page(str(spec["page"]), _secs(spec, 10), spec.get("dismiss", True) is not False,
                              bool(spec.get("passthrough")), spec.get("show_left", True) is not False, spec.get("light"))


@action("timer.toggle", required=("id",))
def timer_toggle(spec: dict, ctx: Context) -> None:
    """Contagem regressiva: começa, pausa ou continua. minutes: duração. A tecla mostra {timer.<id>}."""
    ctx.engine.values.timer_toggle(str(spec["id"]), float(spec.get("minutes", 5)) * 60)


@action("timer.reset", required=("id",))
def timer_reset(spec: dict, ctx: Context) -> None:
    """Volta a contagem para o começo (parada)."""
    m = spec.get("minutes")
    ctx.engine.values.timer_reset(str(spec["id"]), float(m) * 60 if m is not None else None)
