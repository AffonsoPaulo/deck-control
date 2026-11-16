"""Plugin embutido: OBS Studio via obs-websocket v5 (já vem no OBS 28+).

No OBS: Ferramentas > Configurações do servidor WebSocket > Ativar servidor.
A senha vai na seção 'obs:' do config (ou em Configurações › Integrações, no editor).

Estados publicados (usados para trocar ícones automaticamente):
    obs.connected, obs.recording, obs.record_paused, obs.streaming, obs.replay, obs.virtualcam,
    obs.scene:<cena>, obs.muted:<entrada>, obs.visible:<cena>/<fonte>
"""
from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING

from app.actions import Context
from app.i18n import tr

if TYPE_CHECKING:
    from app.engine import Engine

logging.getLogger("obsws_python").setLevel(logging.CRITICAL)


class OBS:
    """Mantém a conexão com o OBS (reconecta sozinho) e espelha o estado no engine."""

    def __init__(self, engine: "Engine", cfg: dict):
        self.engine = engine
        self.cfg = cfg
        self.req = None
        self.ev = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._item_ids: dict[tuple[str, str], int] = {}
        self._wake = threading.Event()
        self._last_error = None
        self._thread = threading.Thread(target=self._loop, daemon=True, name="obs")

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        self._disconnect()

    def update_config(self, cfg: dict) -> None:
        """Chamado quando a seção 'obs:' muda no config: reconecta com os dados novos."""
        if cfg == self.cfg:
            return
        self.cfg = cfg
        self._last_error = None
        self._disconnect()
        self._wake.set()

    # -- conexão --------------------------------------------------------------

    def _conn_kwargs(self) -> dict:
        return dict(host=self.cfg.get("host", "localhost"), port=int(self.cfg.get("port", 4455)),
                    password=self.cfg.get("password", ""), timeout=3)

    def _connect(self) -> None:
        import obsws_python as obsws
        req = obsws.ReqClient(**self._conn_kwargs())
        ev = obsws.EventClient(**self._conn_kwargs())
        ev.callback.register([
            self.on_record_state_changed, self.on_stream_state_changed,
            self.on_replay_buffer_state_changed, self.on_virtualcam_state_changed,
            self.on_current_program_scene_changed, self.on_input_mute_state_changed,
            self.on_scene_item_enable_state_changed, self.on_exit_started,
        ])
        with self._lock:
            self.req, self.ev = req, ev
            self._item_ids.clear()
        print("[obs] conectado")
        self.engine.set_state("obs.connected", True)
        self.refresh()

    def _disconnect(self) -> None:
        with self._lock:
            req, ev, self.req, self.ev = self.req, self.ev, None, None
        for c in (ev, req):
            try:
                if c is not None:
                    c.disconnect()
            except Exception:
                pass
        if req is not None:
            print("[obs] desconectado")
        self.engine.set_state("obs.connected", False)

    def _sleep(self, seconds: float) -> None:
        self._wake.wait(seconds)
        self._wake.clear()

    def _loop(self) -> None:
        while not self._stop.is_set():
            if self.req is None:
                try:
                    self._connect()
                    self._last_error = None
                except Exception as e:
                    msg = f"{type(e).__name__}: {e}".strip()
                    if msg != self._last_error:  # só repete o aviso quando o erro muda
                        host = f"{self.cfg.get('host', 'localhost')}:{self.cfg.get('port', 4455)}"
                        print(f"[obs] não conectou em {host} ({msg}); tentando a cada 5 s")
                        self._last_error = msg
                    self._sleep(5)
                    continue
            # checagem de vida
            try:
                self.call("GetVersion")
            except Exception:
                self._disconnect()
            self._sleep(3)

    def call(self, request: str, data: dict | None = None) -> dict:
        req = self.req
        if req is None:
            raise RuntimeError(tr("OBS isn't connected"))
        return req.send(request, data, raw=True) or {}

    # -- estado ---------------------------------------------------------------

    def refresh(self) -> None:
        """Lê o estado completo (ao conectar)."""
        set_ = self.engine.set_state
        for state, request in (("obs.recording", "GetRecordStatus"), ("obs.streaming", "GetStreamStatus"),
                               ("obs.replay", "GetReplayBufferStatus"), ("obs.virtualcam", "GetVirtualCamStatus")):
            try:
                r = self.call(request)
                set_(state, bool(r.get("outputActive")))
                if request in ("GetRecordStatus", "GetStreamStatus"):
                    self._since("record" if request == "GetRecordStatus" else "stream", bool(r.get("outputActive")), r.get("outputDuration"))
                if request == "GetRecordStatus":
                    set_("obs.record_paused", bool(r.get("outputPaused")))
            except Exception:
                set_(state, False)  # ex.: replay buffer desativado nas configurações
        self._publish_times()
        try:
            self._set_scene(self.call("GetCurrentProgramScene").get("currentProgramSceneName"))
        except Exception:
            pass
        for name in self.engine.states_with_prefix("obs.muted:"):
            try:
                set_(name, bool(self.call("GetInputMute", {"inputName": name.split(":", 1)[1]}).get("inputMuted")))
            except Exception:
                pass
        for name in self.engine.states_with_prefix("obs.visible:"):
            scene, _, source = name.split(":", 1)[1].partition("/")
            try:
                item = self._item_id(scene, source)
                r = self.call("GetSceneItemEnabled", {"sceneName": scene, "sceneItemId": item})
                set_(name, bool(r.get("sceneItemEnabled")))
            except Exception:
                pass

    # tempo de live / gravação: valores calculados na hora em que a tecla é desenhada
    def _since(self, kind: str, active: bool, duration_ms=None) -> None:
        import time as _t
        since = (_t.monotonic() - (duration_ms or 0) / 1000) if active else None
        setattr(self, f"_{kind}_since", since)

    def _elapsed(self, kind: str) -> str:
        import time as _t
        since = getattr(self, f"_{kind}_since", None)
        if since is None:
            return "00:00"
        s = int(_t.monotonic() - since)
        return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"

    def _publish_times(self) -> None:
        from app.values import VALUES
        VALUES.set("obs.stream_time", lambda: self._elapsed("stream"))
        VALUES.set("obs.record_time", lambda: self._elapsed("record"))

    def _set_scene(self, current: str | None) -> None:
        from app.values import VALUES
        VALUES.set("obs.scene", current)
        for name in self.engine.states_with_prefix("obs.scene:"):
            self.engine.set_state(name, name == f"obs.scene:{current}")

    def _item_id(self, scene: str, source: str) -> int:
        key = (scene, source)
        if key not in self._item_ids:
            r = self.call("GetSceneItemId", {"sceneName": scene, "sourceName": source})
            self._item_ids[key] = int(r["sceneItemId"])
        return self._item_ids[key]

    # -- eventos do OBS (nomes exigidos pelo obsws-python) ----------------------

    def on_record_state_changed(self, d):
        self.engine.set_state("obs.recording", bool(d.output_active))
        if bool(d.output_active) != (getattr(self, "_record_since", None) is not None):
            self._since("record", bool(d.output_active))
        self.engine.set_state("obs.record_paused", getattr(d, "output_state", "") == "OBS_WEBSOCKET_OUTPUT_PAUSED")

    def on_stream_state_changed(self, d):
        self.engine.set_state("obs.streaming", bool(d.output_active))
        if bool(d.output_active) != (getattr(self, "_stream_since", None) is not None):
            self._since("stream", bool(d.output_active))

    def on_replay_buffer_state_changed(self, d):
        self.engine.set_state("obs.replay", bool(d.output_active))

    def on_virtualcam_state_changed(self, d):
        self.engine.set_state("obs.virtualcam", bool(d.output_active))

    def on_current_program_scene_changed(self, d):
        self._set_scene(d.scene_name)

    def on_input_mute_state_changed(self, d):
        self.engine.set_state(f"obs.muted:{d.input_name}", bool(d.input_muted))

    def on_scene_item_enable_state_changed(self, d):
        for (scene, source), item in list(self._item_ids.items()):
            if scene == d.scene_name and item == d.scene_item_id:
                self.engine.set_state(f"obs.visible:{scene}/{source}", bool(d.scene_item_enabled))

    def on_exit_started(self, d):
        threading.Thread(target=self._disconnect, daemon=True).start()


class _Plugin:
    """Liga/desliga a conexão com o OBS conforme o interruptor nas Integrações."""

    def __init__(self, api):
        self.api = api
        self.client: OBS | None = None

    def start(self, settings: dict) -> None:
        self.client = OBS(self.api.engine, settings)
        self.client.start()

    def update(self, settings: dict) -> None:
        if self.client is not None:
            self.client.update_config(settings)

    def stop(self) -> None:
        if self.client is not None:
            self.client.stop()
            self.client = None

    def current_status(self) -> dict:
        if self.client is not None and self.client.req is not None:
            return {"state": "ok", "label": tr("Connected")}
        return {"state": "wait", "label": tr("Waiting for OBS")}


def setup(api):
    def _obs(ctx: Context) -> OBS:
        if ctx.engine.obs is None:
            raise RuntimeError(tr("OBS isn't connected (Settings › Integrations)"))
        return ctx.engine.obs


    def _output(ctx: Context, spec: dict, name: str) -> None:
        """start/stop/toggle genérico para Record, Stream, ReplayBuffer, VirtualCam."""
        mode = spec.get("mode", "toggle")
        if mode not in ("toggle", "start", "stop"):
            raise ValueError(f"mode deve ser toggle/start/stop, não '{mode}'")
        _obs(ctx).call(f"{mode.capitalize()}{name}")


    @api.action("obs.scene", required=("scene",), state=lambda s, k: f"obs.scene:{s['scene']}")
    def scene(spec: dict, ctx: Context) -> None:
        """Troca a cena do programa. preview: true para trocar a cena de preview (modo estúdio)."""
        req = "SetCurrentPreviewScene" if spec.get("preview") else "SetCurrentProgramScene"
        _obs(ctx).call(req, {"sceneName": spec["scene"]})


    @api.action("obs.record", state=lambda s, k: "obs.record_paused" if s.get("mode") == "pause" else "obs.recording")
    def record(spec: dict, ctx: Context) -> None:
        """Gravação. mode: toggle (padrão) | start | stop | pause (alterna pausa)."""
        if spec.get("mode") == "pause":
            _obs(ctx).call("ToggleRecordPause")
        else:
            _output(ctx, spec, "Record")


    @api.action("obs.stream", state=lambda s, k: "obs.streaming")
    def stream(spec: dict, ctx: Context) -> None:
        """Transmissão. mode: toggle | start | stop."""
        _output(ctx, spec, "Stream")


    @api.action("obs.replay", state=lambda s, k: None if s.get("mode") == "save" else "obs.replay")
    def replay(spec: dict, ctx: Context) -> None:
        """Replay buffer. mode: toggle | start | stop | save (salva o replay)."""
        if spec.get("mode") == "save":
            _obs(ctx).call("SaveReplayBuffer")
        else:
            _output(ctx, spec, "ReplayBuffer")


    @api.action("obs.virtualcam", state=lambda s, k: "obs.virtualcam")
    def virtualcam(spec: dict, ctx: Context) -> None:
        """Câmera virtual. mode: toggle | start | stop."""
        _output(ctx, spec, "VirtualCam")


    @api.action("obs.mute", required=("input",), state=lambda s, k: f"obs.muted:{s['input']}")
    def mute(spec: dict, ctx: Context) -> None:
        """Muta uma entrada de áudio do OBS. mode: toggle | on (muta) | off (desmuta)."""
        mode = spec.get("mode", "toggle")
        if mode == "toggle":
            _obs(ctx).call("ToggleInputMute", {"inputName": spec["input"]})
        else:
            _obs(ctx).call("SetInputMute", {"inputName": spec["input"], "inputMuted": mode == "on"})


    @api.action("obs.source", required=("scene", "source"),
            state=lambda s, k: f"obs.visible:{s['scene']}/{s['source']}")
    def source(spec: dict, ctx: Context) -> None:
        """Mostra/esconde uma fonte numa cena. mode: toggle | show | hide."""
        o = _obs(ctx)
        item = o._item_id(spec["scene"], spec["source"])
        mode = spec.get("mode", "toggle")
        if mode == "toggle":
            cur = o.call("GetSceneItemEnabled", {"sceneName": spec["scene"], "sceneItemId": item})["sceneItemEnabled"]
            enabled = not cur
        else:
            enabled = mode == "show"
        o.call("SetSceneItemEnabled", {"sceneName": spec["scene"], "sceneItemId": item, "sceneItemEnabled": enabled})


    @api.action("obs.request", required=("request",))
    def request(spec: dict, ctx: Context) -> None:
        """Qualquer requisição do obs-websocket (configurabilidade total).
        request: nome (ex.: "SetCurrentSceneTransition"), data: {...}.
        Lista: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md"""
        r = _obs(ctx).call(spec["request"], spec.get("data"))
        if ctx.engine.debug:
            print(f"[obs] {spec['request']} -> {r}")

    return _Plugin(api)
