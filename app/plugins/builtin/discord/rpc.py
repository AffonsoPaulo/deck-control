"""Conexão direta com o Discord aberto no PC (RPC local, pelo pipe \\\\.\\pipe\\discord-ipc-N).

Precisa de uma aplicação criada pela própria pessoa no Discord Developer Portal (Client ID +
Client Secret). Na primeira vez o Discord mostra uma janela pedindo para autorizar; o token
fica em %LOCALAPPDATA%\\D6Deck\\discord-rpc.json (fora do config.yaml, para não ir junto em
backups) e é renovado sozinho.

O Discord só libera o RPC para a conta dona da aplicação (e testers que ela adicionar), o que
basta para uso pessoal.

Pipe no Windows: leitura e escrita no mesmo handle síncrono travam uma à outra, então uma
thread só cuida do pipe: escreve o que estiver na fila e lê quando o PeekNamedPipe diz que
chegou algo.
"""

from __future__ import annotations

import ctypes
import json
import msvcrt
import queue
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from ctypes import wintypes

from app import logs, winutil

log = logs.get("plugins.discord")

OP_HANDSHAKE, OP_FRAME, OP_CLOSE, OP_PING, OP_PONG = 0, 1, 2, 3, 4
SCOPES = ["rpc", "rpc.voice.read", "rpc.voice.write"]
REDIRECT = "http://localhost"
TOKEN_URL = "https://discord.com/api/oauth2/token"
RETRY = 5.0

_peek = ctypes.windll.kernel32.PeekNamedPipe
_peek.argtypes = [
    wintypes.HANDLE,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.c_void_p,
    ctypes.POINTER(wintypes.DWORD),
    ctypes.c_void_p,
]
_peek.restype = wintypes.BOOL


class AuthError(Exception):
    """Problema que não se resolve tentando de novo (Client ID errado, autorização recusada…)."""


class DiscordRPC:
    def __init__(self, on_voice, on_status):
        self.on_voice = on_voice  # on_voice({"mute": bool, "deaf": bool})
        self.on_status = on_status  # on_status(state, label_key, error=None, **kw)
        self.client_id = ""
        self.secret = ""
        self.voice: dict = {}
        self.connected = False
        self._q: queue.Queue = queue.Queue()
        self._waiters: dict[str, dict] = {}
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._pipe = None

    # -- ciclo de vida
    def start(self, client_id: str, secret: str) -> None:
        self.client_id, self.secret = str(client_id or "").strip(), str(secret or "").strip()
        self._stop.clear()
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, daemon=True, name="discord-rpc")
            self._thread.start()

    def update(self, client_id: str, secret: str) -> None:
        cid, sec = str(client_id or "").strip(), str(secret or "").strip()
        if (cid, sec) != (self.client_id, self.secret):
            self.client_id, self.secret = cid, sec
            self._close()  # reconecta com os dados novos
            self._wake.set()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        self._close()

    # -- comandos (chamados das ações, em outra thread)
    def command(self, cmd: str, args: dict | None = None, timeout: float = 5.0) -> dict:
        if not self.connected:
            raise RuntimeError("not connected")
        nonce = str(uuid.uuid4())
        w = {"event": threading.Event(), "msg": None}
        self._waiters[nonce] = w
        self._q.put((OP_FRAME, {"cmd": cmd, "args": args or {}, "nonce": nonce}))
        try:
            if not w["event"].wait(timeout):
                raise RuntimeError("Discord didn't answer")
        finally:
            self._waiters.pop(nonce, None)
        msg = w["msg"]
        if msg.get("evt") == "ERROR":
            raise RuntimeError((msg.get("data") or {}).get("message") or "Discord error")
        return msg.get("data") or {}

    def set_voice(self, **settings) -> None:
        data = self.command("SET_VOICE_SETTINGS", settings)
        self._voice_changed(data)

    # -- thread do pipe
    def _run(self) -> None:
        while not self._stop.is_set():
            if not self.client_id or not self.secret:
                self.on_status("wait", "Fill in the Client ID and Secret")
                self._wait(RETRY)
                continue
            try:
                self._session()
            except AuthError as e:
                self.on_status("error", e.args[0], error=e.args[1] if len(e.args) > 1 else None)
                self._close()
                self._wait(3600)  # só tenta de novo se mudarem os dados (update acorda)
                continue
            except OSError as e:  # Discord fechado ou a conexão caiu: normal, tenta de novo
                log.debug("RPC: %s; retrying in %.0f s", e, RETRY)
                self.on_status("wait", "Waiting for Discord")
            except Exception as e:  # noqa: BLE001 - qualquer outra falha: tenta de novo
                log.warning("RPC failed: %s; retrying in %.0f s", e, RETRY, exc_info=True)
                self.on_status("wait", "Waiting for Discord", error=str(e))
            self._close()
            self._wait(RETRY)

    def _wait(self, secs: float) -> None:
        self._wake.wait(secs)
        self._wake.clear()

    def _open(self):
        last = None
        for i in range(10):
            try:
                return open(rf"\\.\pipe\discord-ipc-{i}", "r+b", buffering=0)
            except OSError as e:
                last = e
        raise last or OSError("no pipe")

    def _close(self) -> None:
        was = self.connected
        self.connected = False
        pipe, self._pipe = self._pipe, None
        if pipe is not None:
            try:
                pipe.close()
            except OSError:
                pass
        for w in list(self._waiters.values()):
            w["msg"] = {"evt": "ERROR", "data": {"message": "Discord disconnected"}}
            w["event"].set()
        if was:
            self.voice = {}

    def _session(self) -> None:
        self._pipe = self._open()
        self._write(OP_HANDSHAKE, {"v": 1, "client_id": self.client_id})
        ready = self._read_blocking()
        if ready.get("evt") != "READY":
            raise OSError(f"unexpected answer: {ready}")
        token = self._token()
        auth = self._call("AUTHENTICATE", {"access_token": token["access_token"]}) if token else None
        if auth is None or auth.get("evt") == "ERROR":
            token = self._refresh(token) if token and token.get("refresh_token") else None
            auth = self._call("AUTHENTICATE", {"access_token": token["access_token"]}) if token else None
        if auth is None or auth.get("evt") == "ERROR":
            token = self._authorize()
            auth = self._call("AUTHENTICATE", {"access_token": token["access_token"]})
            if auth.get("evt") == "ERROR":
                raise AuthError("Discord refused the login", (auth.get("data") or {}).get("message"))
        user = (auth.get("data") or {}).get("user") or {}
        self._call("SUBSCRIBE", {}, evt="VOICE_SETTINGS_UPDATE")
        self._voice_changed(self._call("GET_VOICE_SETTINGS").get("data") or {})
        self.connected = True
        self.on_status("ok", "Connected as {user}", user=user.get("global_name") or user.get("username") or "?")
        self._loop()

    def _loop(self) -> None:
        while not self._stop.is_set() and self._pipe is not None:
            busy = False
            try:
                while True:
                    op, payload = self._q.get_nowait()
                    self._write(op, payload)
                    busy = True
            except queue.Empty:
                pass
            if self._available():
                self._dispatch(*self._read_frame())
                busy = True
            if not busy:
                time.sleep(0.03)

    def _dispatch(self, op: int, msg: dict) -> None:
        if op == OP_PING:
            self._write(OP_PONG, msg)
        elif op == OP_CLOSE:
            raise OSError(f"Discord closed the connection: {msg}")
        elif msg.get("evt") == "VOICE_SETTINGS_UPDATE":
            self._voice_changed(msg.get("data") or {})
        elif msg.get("nonce") in self._waiters:
            w = self._waiters[msg["nonce"]]
            w["msg"] = msg
            w["event"].set()

    def _voice_changed(self, data: dict) -> None:
        v = {"mute": bool(data.get("mute")), "deaf": bool(data.get("deaf"))}
        if "mute" in data or "deaf" in data:
            self.voice = v
            self.on_voice(v)

    # -- durante o login (antes do loop), pedido e resposta em sequência
    def _call(self, cmd: str, args: dict | None = None, evt: str | None = None, timeout: float = 10.0) -> dict:
        nonce = str(uuid.uuid4())
        msg = {"cmd": cmd, "args": args or {}, "nonce": nonce}
        if evt:
            msg["evt"] = evt
        self._write(OP_FRAME, msg)
        end = time.monotonic() + timeout
        while True:
            if time.monotonic() > end:
                raise OSError(f"Discord didn't answer {cmd}")
            if not self._available():
                if self._stop.is_set():
                    raise OSError("stopping")
                time.sleep(0.03)
                continue
            op, reply = self._read_frame()
            if op == OP_CLOSE:
                code = reply.get("code")
                if code == 4000:
                    raise AuthError("Invalid Client ID", reply.get("message"))
                raise OSError(f"Discord closed the connection: {reply}")
            if op == OP_PING:
                self._write(OP_PONG, reply)
            elif reply.get("nonce") == nonce:
                return reply
            elif reply.get("evt") == "VOICE_SETTINGS_UPDATE":
                self._voice_changed(reply.get("data") or {})

    def _authorize(self) -> dict:
        self.on_status("wait", "Authorize in Discord")
        # a pessoa tem até 2 minutos para clicar em Autorizar na janela do Discord
        reply = self._call("AUTHORIZE", {"client_id": self.client_id, "scopes": SCOPES}, timeout=120)
        if reply.get("evt") == "ERROR":
            raise AuthError("Authorization refused", (reply.get("data") or {}).get("message"))
        code = (reply.get("data") or {}).get("code")
        return self._exchange({"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT})

    def _refresh(self, token: dict) -> dict | None:
        try:
            return self._exchange({"grant_type": "refresh_token", "refresh_token": token["refresh_token"]})
        except AuthError:
            return None

    def _exchange(self, form: dict) -> dict:
        body = urllib.parse.urlencode({"client_id": self.client_id, "client_secret": self.secret, **form}).encode()
        req = urllib.request.Request(
            TOKEN_URL,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "D6Deck/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                tok = json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                detail = json.loads(e.read())
            except ValueError:
                detail = {}
            err = detail.get("error")
            if err == "invalid_client":
                raise AuthError("Wrong Client Secret", detail.get("error_description")) from None
            if err == "invalid_request" and "redirect" in str(detail).lower():
                raise AuthError("Add http://localhost to Redirects", detail.get("error_description")) from None
            raise AuthError("Discord refused the login", f"{e.code} {detail or e.reason}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            raise OSError(f"no internet to log in to Discord: {e}") from None
        tok["client_id"] = self.client_id
        tok["expires_at"] = time.time() + float(tok.get("expires_in", 0))
        self._save_token(tok)
        return tok

    # -- token salvo
    def _token_path(self):
        return winutil.data_dir() / "discord-rpc.json"

    def _token(self) -> dict | None:
        try:
            tok = json.loads(self._token_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return tok if tok.get("client_id") == self.client_id and tok.get("access_token") else None

    def _save_token(self, tok: dict) -> None:
        try:
            p = self._token_path()
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(tok), encoding="utf-8")
        except OSError as e:
            log.warning("Couldn't save the Discord token: %s", e)

    # -- baixo nível
    def _write(self, op: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self._pipe.write(struct.pack("<II", op, len(data)) + data)

    def _available(self) -> int:
        n = wintypes.DWORD(0)
        h = msvcrt.get_osfhandle(self._pipe.fileno())
        if not _peek(h, None, 0, None, ctypes.byref(n), None):
            raise OSError("Discord pipe closed")
        return n.value

    def _read_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self._pipe.read(n - len(buf))
            if not chunk:
                raise OSError("Discord pipe closed")
            buf += chunk
        return buf

    def _read_frame(self) -> tuple[int, dict]:
        op, length = struct.unpack("<II", self._read_exact(8))
        return op, json.loads(self._read_exact(length) or b"{}")

    def _read_blocking(self, timeout: float = 10.0) -> dict:
        end = time.monotonic() + timeout
        while not self._available():
            if time.monotonic() > end:
                raise OSError("Discord didn't answer the handshake")
            time.sleep(0.03)
        op, msg = self._read_frame()
        if op == OP_CLOSE:
            if msg.get("code") == 4000:
                raise AuthError("Invalid Client ID", msg.get("message"))
            raise OSError(f"Discord closed the connection: {msg}")
        return msg
