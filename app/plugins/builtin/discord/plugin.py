"""Plugin embutido: Discord, de dois jeitos (configuração 'mode').

mode: keys (padrão) — atalhos de teclado globais
  O app aperta os "Atalhos de teclado" que a pessoa criou no Discord:
    "Alternar silenciar"  -> o atalho 'mute'    (padrão: ctrl+shift+alt+f23)
    "Alternar ensurdecer" -> o atalho 'deafen'  (padrão: ctrl+shift+alt+f24)
  F13–F24 não existem nos teclados comuns, então não colidem com nada. Para o Discord gravar o
  atalho, a pessoa aperta a tecla do D6 (ou usa "Enviar em 5 s" no editor).
  Não precisa de conta de desenvolvedor, mas o app não sabe o estado real do Discord: ele só
  alterna o ícone a cada toque (segure a tecla para corrigir só o ícone, ver 'hold' no exemplo).

mode: rpc — conexão direta (Client ID + Client Secret de uma aplicação da própria pessoa)
  Fala com o Discord aberto no PC pelo RPC local (rpc.py). Muta e ensurdece de verdade e as
  teclas mostram o estado real, mesmo se a pessoa mutar pelo mouse.
"""

from __future__ import annotations

from app import logs
from app.windows import keys
from app.actions import Context
from app.i18n import tr

from .rpc import DiscordRPC  # noqa: E402  (carregado como pacote pelo PluginManager)

SHORTCUT_ACTIONS = (
    "ptt",
    "ptt_priority",
    "push_to_mute",
    "vad_priority",
    "toggle_vad",
    "streamer_mode",
    "voice_chat",
    "overlay_lock",
    "overlay_chat",
    "nav_back",
    "nav_forward",
    "switch_channel",
    "disconnect",
    "soundboard",
    "soundboard_hold",
    "save_clip",
)
DEFAULTS = {
    "mode": "keys",
    "mute": "ctrl+shift+alt+f23",
    "deafen": "ctrl+shift+alt+f24",
    "client_id": "",
    "client_secret": "",
}
log = logs.get("plugins.discord")
PROBLEM = "plugin.discord.connect"
# motivo (rótulo de status do RPC) -> texto do problema em aberto (traduzido na tela)
PROBLEM_TEXT = {
    "Invalid Client ID": "Discord can't connect: the Client ID is invalid",
    "Wrong Client Secret": "Discord can't connect: the Client Secret is wrong",
    "Authorization refused": "Discord can't connect: the authorization was refused in Discord",
    "Discord refused the login": "Discord can't connect: Discord refused the login",
    "Add http://localhost to Redirects": "Discord can't connect: add http://localhost to Redirects in your Discord application",
}


class _Plugin:
    def __init__(self, api):
        self.api = api
        self.settings: dict = dict(DEFAULTS)
        self.rpc = DiscordRPC(self._on_voice, self._on_status)
        self._status = ("wait", "Waiting for Discord", {}, None)
        self._mode_logged = None

    # -- ciclo de vida
    def start(self, settings: dict) -> None:
        self.update(settings)

    def update(self, settings: dict) -> None:
        self.settings = {**DEFAULTS, **{k: v for k, v in settings.items() if v is not None}}
        if self.mode != self._mode_logged:
            self._mode_logged = self.mode
            log.info("Discord mode: %s", "direct connection (RPC)" if self.mode == "rpc" else "keyboard shortcuts")
        if self.mode != "rpc":
            logs.resolve(PROBLEM)
        if self.mode == "rpc":
            if self.rpc._thread and self.rpc._thread.is_alive() and not self.rpc._stop.is_set():
                self.rpc.update(self.settings["client_id"], self.settings["client_secret"])
            else:
                self.rpc.start(self.settings["client_id"], self.settings["client_secret"])
        else:
            self.rpc.stop()

    def stop(self) -> None:
        self.rpc.stop()
        logs.resolve(PROBLEM)

    @property
    def mode(self) -> str:
        return "rpc" if self.settings.get("mode") == "rpc" else "keys"

    def current_status(self) -> dict:
        if self.mode == "keys":
            return {"state": "ok", "label": tr("Keyboard shortcuts")}
        state, label, kw, error = self._status
        out = {"state": state, "label": tr(label, **kw)}
        if error:
            out["detail"] = error
        return out

    # -- vindo do RPC (thread do pipe)
    def _on_status(self, state, label, error=None, **kw) -> None:
        old = self._status
        self._status = (state, label, kw, error)
        if (state, label, kw) != old[:3]:
            log.debug(
                "RPC status: %s (%s)%s", label.format(**kw) if kw else label, state, f": {error}" if error else ""
            )
        if state == "ok":
            if old[0] != "ok":
                log.info("Discord connected: %s", label.format(**kw) if kw else label)
            logs.resolve(PROBLEM)
        elif state == "error":
            log.error("Discord RPC: %s%s", label, f": {error}" if error else "")
            logs.problem(
                PROBLEM,
                PROBLEM_TEXT.get(label, "Discord can't connect: {reason}"),
                "integrations:discord",
                reason=error or label,
            )
        elif error:  # falha inesperada: tenta de novo, mas fica avisado
            logs.problem(PROBLEM, "Discord can't connect: {reason}", "integrations:discord", reason=error)

    def _on_voice(self, v: dict) -> None:
        eng = self.api.engine
        if eng is not None:
            eng.set_state("discord.mute", v["mute"])
            eng.set_state("discord.deafen", v["deaf"])

    # -- ações
    def toggle(self, ctx: Context, name: str, spec: dict) -> None:
        if self.mode == "rpc":
            if not self.rpc.connected:
                raise RuntimeError(tr("Discord isn't connected (Settings › Integrations)"))
            field = "mute" if name == "mute" else "deaf"
            cur = self.rpc.voice.get(field, ctx.engine.get_state(f"discord.{name}"))
            self.rpc.set_voice(**{field: not cur})
            return
        keys.press_combo(spec.get("keys") or self.settings.get(name) or DEFAULTS[name])
        state = f"discord.{name}"
        ctx.engine.set_state(state, not ctx.engine.get_state(state))


def setup(api):
    plugin = _Plugin(api)

    @api.action("discord.mute", state=lambda s, k: "discord.mute")
    def mute(spec: dict, ctx: Context) -> None:
        """Alterna o mute do microfone. keys: atalho (opcional, sobrepõe o das Integrações)."""
        plugin.toggle(ctx, "mute", spec)

    @api.action("discord.deafen", state=lambda s, k: "discord.deafen")
    def deafen(spec: dict, ctx: Context) -> None:
        """Alterna o "ensurdecer" (desativa áudio e microfone)."""
        plugin.toggle(ctx, "deafen", spec)

    # as outras ações de atalho do Discord: cada tecla tem a combinação própria (spec["keys"]),
    # gerada pelo editor com F13–F24; como ação principal, o app segura enquanto a tecla do D6 estiver
    # apertada (o que faz "apertar para falar" funcionar)
    from app.actions.basic import check_combos

    def shortcut(spec: dict, ctx: Context) -> None:
        keys.press_combo(str(spec["keys"]), hold_ms=spec.get("hold_ms", 40))

    for aid in SHORTCUT_ACTIONS:
        api.action(f"discord.{aid}", required=("keys",), check=check_combos, mirror=True)(shortcut)

    @api.action("discord.keybind", required=("name",))
    def keybind(spec: dict, ctx: Context) -> None:
        """Dispara um atalho nomeado da seção 'discord:' do config (ex.: name: ptt_toggle)."""
        combo = plugin.settings.get(spec["name"])
        if not combo:
            raise ValueError(tr("shortcut '{name}' isn't defined in discord: in the config", name=spec["name"]))
        keys.press_combo(combo)

    return plugin
