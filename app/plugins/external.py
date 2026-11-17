"""Plugins de terceiros: um programa separado que conversa com o app por JSON, uma mensagem por linha.

O app abre o programa ('run' do plugin.json, na pasta do plugin) e escreve no stdin dele;
o plugin responde no stdout. O stderr vai para o log do app. Protocolo (versão 1):

  app -> plugin
    {"type": "hello", "protocol": 1, "plugin": "<id>", "locale": "pt-BR", "settings": {...}}
    {"type": "settings", "settings": {...}}                 configurações mudaram no editor
    {"type": "locale", "locale": "en"}                       o idioma do app mudou (pt-BR ou en)
    {"type": "action", "id": 7, "action": "<id>.<nome>", "params": {...}, "page": "main", "key": 3}
    {"type": "stop"}                                         o app vai fechar o plugin

  plugin -> app
    {"type": "result", "id": 7, "ok": true}                  (ou "ok": false, "error": "texto")
    {"type": "state", "name": "<id>.<nome>", "value": true}  liga/desliga um estado (troca o ícone da tecla)
    {"type": "status", "state": "ok|wait|error", "label": "Conectado"}
    {"type": "log", "message": "texto"}
    {"type": "value", "name": "<id>.<nome>", "value": 28}     publica um valor (teclas, regras, automações)

Isolamento: o plugin roda em outro processo, então se ele travar ou cair o app continua
(e reinicia o plugin, até 3 vezes por minuto). Ele só mexe no app por estas mensagens.
Mas é um programa como outro qualquer no seu PC: instale só plugins de quem você confia.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from typing import TYPE_CHECKING
from app import logs
from app.i18n import tr
from app.plugins.api import PluginAPI

if TYPE_CHECKING:
    from app.plugins import Plugin, PluginManager

PROTOCOL = 1
ACTION_TIMEOUT = 10.0
MAX_RESTARTS = 3  # por minuto
HEALTHY_AFTER = 15.0  # s vivo depois de reiniciar: o problema "parou" se resolve
LOG_LEVELS = {"debug": 10, "info": 20, "warn": 30, "warning": 30, "error": 40}


class ExternalPlugin:
    def __init__(self, manager: "PluginManager", plugin: "Plugin"):
        self.m, self.p = manager, plugin
        self.api = PluginAPI(manager, plugin)  # a mesma porta dos embutidos: valores, estados, log
        self.proc: subprocess.Popen | None = None
        self.settings: dict = {}
        self._lock = threading.Lock()
        self._pending: dict[int, dict] = {}
        self._next_id = 1
        self._stopping = False
        self._restarts: list[float] = []
        self._status = {"state": "wait", "label": tr("Starting")}
        self.locale = self.api.language()
        self.log = self.api.log
        self._crashed = False  # o problema "plugin.<id>.crash" está aberto

    @property
    def _problem_id(self) -> str:
        return f"plugin.{self.p.id}.crash"

    def _healthy(self) -> None:
        """Reiniciou e continua de pé (mandou mensagem ou passou HEALTHY_AFTER): fecha o problema."""
        if self._crashed and self.proc is not None and self.proc.poll() is None:
            self._crashed = False
            logs.resolve(self._problem_id)

    # -- ciclo de vida (chamado pelo PluginManager)
    def start(self, settings: dict) -> None:
        self.settings = dict(settings)
        self._stopping = False
        self._spawn()

    def update(self, settings: dict) -> None:
        if settings != self.settings:
            self.settings = dict(settings)
            self._send({"type": "settings", "settings": self.settings})

    def set_locale(self, locale: str) -> None:
        if locale != self.locale:
            self.locale = locale
            self._send({"type": "locale", "locale": locale})

    def stop(self) -> None:
        self._stopping = True
        self._crashed = False
        logs.resolve(self._problem_id)
        proc = self.proc
        if proc is None:
            return
        self._send({"type": "stop"})
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.log.warning("Plugin didn't close within 2 s; killed it")
            proc.kill()
        self.proc = None
        self._fail_pending(tr("the plugin was turned off"))

    def current_status(self) -> dict:
        return dict(self._status)

    # -- processo
    def _command(self) -> list[str]:
        cmd = list(self.p.manifest["run"])
        if cmd and cmd[0] in ("python", "python3", "pythonw"):
            cmd[0] = sys.executable.replace("pythonw.exe", "python.exe")  # o mesmo Python do app
        return cmd

    def _spawn(self) -> None:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1", "D6_PLUGIN_ID": self.p.id}
        try:
            self.proc = subprocess.Popen(
                self._command(),
                cwd=str(self.p.path),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=flags,
                env=env,
                bufsize=1,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except OSError as e:
            self._status = {"state": "error", "label": tr("Didn't open")}
            self.log.error(
                "Couldn't open the plugin program %s: %s", self._command(), e, extra={"ctx": {"cwd": str(self.p.path)}}
            )
            raise RuntimeError(tr("couldn't open the plugin ({error})", error=e)) from None
        self._status = {"state": "wait", "label": tr("Starting")}
        self.log.debug("Process started (pid %s): %s", self.proc.pid, self._command())
        proc = self.proc
        threading.Thread(target=self._read_out, args=(proc,), daemon=True, name=f"plugin-{self.p.id}").start()
        threading.Thread(target=self._read_err, args=(proc,), daemon=True, name=f"plugin-{self.p.id}-err").start()
        self.locale = self.api.language()
        self._send(
            {
                "type": "hello",
                "protocol": PROTOCOL,
                "plugin": self.p.id,
                "locale": self.locale,
                "settings": self.settings,
            }
        )

    def _send(self, msg: dict) -> bool:
        proc = self.proc
        if proc is None or proc.poll() is not None or proc.stdin is None:
            return False
        try:
            with self._lock:
                proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
                proc.stdin.flush()
            if msg.get("type") != "hello":  # o hello leva as configurações (com senhas)
                self.log.debug("-> %s", msg.get("type"), extra={"ctx": msg})
            return True
        except (OSError, ValueError):
            self.log.debug("Couldn't send %s to the plugin (pipe closed)", msg.get("type"), exc_info=True)
            return False

    def _read_err(self, proc: subprocess.Popen) -> None:
        for line in proc.stderr:
            line = line.rstrip()
            if line:
                self.log.warning("stderr: %s", line)

    def _read_out(self, proc: subprocess.Popen) -> None:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                self.log.info("%s", line)  # texto solto: vai para o log
                continue
            if isinstance(msg, dict):
                if self._crashed and proc is self.proc:
                    self._healthy()
                self._handle(msg)
        # o processo terminou
        if proc is self.proc and not self._stopping:
            try:
                code = proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                code = None
            self.log.error(
                "Plugin %s stopped unexpectedly (exit code %s)",
                self.p.id,
                code,
                extra={"ctx": {"plugin": self.p.id, "version": self.p.manifest.get("version"), "code": code}},
            )
            self._crashed = True
            logs.problem(
                self._problem_id,
                "The plugin {name} stopped unexpectedly (exit code {code})",
                f"integrations:{self.p.id}",
                name=self.p.name,
                code=code,
            )
            self._fail_pending(tr("the plugin stopped"))
            now = time.monotonic()
            self._restarts = [t for t in self._restarts if now - t < 60] + [now]
            if len(self._restarts) <= MAX_RESTARTS:
                time.sleep(1)
                if not self._stopping:
                    try:
                        self.log.info(
                            "Restarting plugin %s (%d of %d this minute)", self.p.id, len(self._restarts), MAX_RESTARTS
                        )
                        self._spawn()
                        timer = threading.Timer(HEALTHY_AFTER, self._healthy)
                        timer.daemon = True
                        timer.start()
                        return
                    except RuntimeError:
                        pass
            self.proc = None
            self._status = {"state": "error", "label": tr("Stopped")}
            self.p.error = tr("the plugin stopped several times in a row; see the log")
            self.log.error("Plugin %s stopped %d times in a minute; not restarting it", self.p.id, len(self._restarts))
            logs.problem(
                self._problem_id,
                "The plugin {name} stopped several times in a row and won't be restarted",
                f"integrations:{self.p.id}",
                name=self.p.name,
            )

    def _handle(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "result":
            waiter = self._pending.get(msg.get("id"))
            if waiter is not None:
                waiter["msg"] = msg
                waiter["event"].set()
        elif kind == "state":  # o prefixo <id>. é conferido pela API (fora dele: aviso no log e ignora)
            self.api.set_state(str(msg.get("name", "")), msg.get("value"))
        elif kind == "status":
            state = msg.get("state") if msg.get("state") in ("ok", "wait", "error") else "ok"
            self._status = {"state": state, "label": str(msg.get("label") or "")[:40] or tr("On")}
        elif kind == "value":
            self.api.set_value(str(msg.get("name", "")), msg.get("value"))
        elif kind == "log":
            level = LOG_LEVELS.get(str(msg.get("level", "info")).lower(), 20)
            self.log.log(level, "%s", msg.get("message", ""))

    def _fail_pending(self, why: str) -> None:
        for waiter in list(self._pending.values()):
            waiter["msg"] = {"ok": False, "error": why}
            waiter["event"].set()

    # -- ações
    def make_action(self, name: str):
        def run(spec: dict, ctx) -> None:
            with self._lock:
                rid = self._next_id
                self._next_id += 1
            waiter = {"event": threading.Event(), "msg": None}
            self._pending[rid] = waiter
            params = {k: v for k, v in spec.items() if k != "type"}
            try:
                if not self._send(
                    {"type": "action", "id": rid, "action": name, "params": params, "page": ctx.page, "key": ctx.key}
                ):
                    raise RuntimeError(tr("the plugin isn't running"))
                if not waiter["event"].wait(ACTION_TIMEOUT):
                    raise RuntimeError(
                        tr("the plugin didn't answer within {seconds} s", seconds=f"{ACTION_TIMEOUT:.0f}")
                    )
                res = waiter["msg"] or {}
                if not res.get("ok", False):
                    self.log.debug("<- result %d: error %s", rid, res.get("error"))
                    raise RuntimeError(res.get("error") or tr("the plugin returned an error"))
                self.log.debug("<- result %d: ok", rid)
            finally:
                self._pending.pop(rid, None)

        return run
