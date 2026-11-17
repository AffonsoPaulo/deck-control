"""Servidor HTTP local do editor visual.

Segurança: escuta só em 127.0.0.1, exige um token aleatório (gerado a cada
execução) no cabeçalho X-Token de toda chamada /api, e confere o Host
(contra DNS rebinding). Sem isso, qualquer site aberto no navegador poderia
mandar o app gravar uma ação 'command' no config.
"""

from __future__ import annotations

import json
import mimetypes
import secrets
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from app import logs, paths
from app.editor.api import MAX_BODY, ROUTES, Context

if TYPE_CHECKING:
    from app.engine import Engine
    from app.plugins import PluginManager
    from app.values import Values

STATIC = paths.STATIC
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/ttf", ".ttf")
# o Windows lê os tipos do registro, e alguns PCs dizem text/plain para .js: o navegador recusa módulos assim
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/json", ".map")
NEXT_PREFIX = "/next"  # o editor novo (React), enquanto não substitui o atual
log = logs.get("editor")
_GONE = (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)


class _Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        """No lugar do traceback cru no stderr: conexão caída fica em debug, o resto vira um erro só."""
        exc = sys.exc_info()[1]
        if isinstance(exc, _GONE):
            log.debug("Browser closed the connection: %s", exc)
            return
        log.error("Editor request failed", exc_info=True)


class EditorServer:
    def __init__(
        self,
        config_path: Path,
        engine: "Engine | None" = None,
        port: int = 8765,
        plugins: "PluginManager | None" = None,
        values: "Values | None" = None,
    ):
        # plugins/values vêm do app/bootstrap.py; sem eles (código antigo, testes), as mesmas peças globais
        if plugins is None:
            from app.plugins import MANAGER as plugins
        if values is None:
            from app.values import VALUES as values
        self.plugins = plugins
        self.values = values
        self.config_path = Path(config_path)
        self.engine = engine
        self.ctx = Context(self.config_path, engine, plugins, values)  # o que cada rota recebe
        self.token = _persistent_token()
        self._register_token()
        self.httpd = self._bind(port)
        self.port = self.httpd.server_address[1]
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True, name="editor")
        self.ctx.store.record()  # garante que o estado atual está no histórico

    def _register_token(self) -> None:
        """O token do editor não pode aparecer no log (ele dá permissão de gravar o config)."""
        if self.engine is not None:
            self.engine.log_secrets.add(self.token)
            self.engine.apply_log_settings()
            return
        # sem engine (testes): as mesmas regras, lidas direto do arquivo

        try:
            raw = yaml.safe_load(self.config_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            raw = {}
        raw = raw if isinstance(raw, dict) else {}
        logs.configure(raw.get("logging"), secrets=[*self.plugins.secret_values(raw), self.token])

    def _bind(self, port: int) -> ThreadingHTTPServer:
        handler = _make_handler(self)
        for p in (port, 0):  # porta ocupada -> qualquer livre
            try:
                srv = _Server(("127.0.0.1", p), handler)
                if p != port:
                    log.warning("Port %d is busy; the editor uses port %d", port, srv.server_address[1])
                return srv
            except OSError:
                continue
        raise OSError("couldn't open the editor server")

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/#t={self.token}"

    def start(self) -> None:
        self._thread.start()
        log.info("Editor at %s", self.url)  # o token sai como **** (logs.configure)

    def stop(self) -> None:
        self.httpd.shutdown()

    # -- API ------------------------------------------------------------------------


def _persistent_token() -> str:
    """Token guardado no perfil do usuário: continua o mesmo quando o app reinicia,
    para uma aba do editor já aberta não perder a permissão de salvar."""
    from app import winutil

    f = winutil.data_dir() / "editor-token"
    try:
        t = f.read_text(encoding="ascii").strip()
        if len(t) >= 24:
            return t
    except OSError:
        pass
    t = secrets.token_urlsafe(24)
    f.write_text(t, encoding="ascii")
    return t


_token_warned = [0.0]  # quando avisou do token antigo (uma aba velha pergunta a cada segundo)


def _make_handler(server: EditorServer):
    class Handler(BaseHTTPRequestHandler):
        status = 0

        def log_message(self, *args):  # silencioso (cada pedido já vai para o log em _handle)
            pass

        def _host_ok(self) -> bool:
            host = (self.headers.get("Host") or "").lower()
            return host in (f"127.0.0.1:{server.port}", f"localhost:{server.port}")

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.status = code
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(body)
            except _GONE:
                # o navegador desistiu do pedido (F5, aba fechada): normal, não é erro
                log.debug("Browser closed the connection before %s finished", self.path.split("?", 1)[0])

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def _handle(self, method: str) -> None:
            t0 = time.perf_counter()
            path = self.path.split("?", 1)[0]
            try:
                self._route(method, path)
            finally:
                log.debug(
                    "%s %s %s in %d ms", method, path, self.status or "-", round((time.perf_counter() - t0) * 1000)
                )

        def _route(self, method: str, path: str) -> None:
            if not self._host_ok():
                log.warning("Request refused: unexpected Host header %r", self.headers.get("Host"))
                return self._send(403, b"host", "text/plain")
            if path.startswith("/api/"):
                if not secrets.compare_digest(self.headers.get("X-Token", ""), server.token):
                    if time.monotonic() - _token_warned[0] > 60:
                        _token_warned[0] = time.monotonic()
                        log.warning("Request refused: old token (tab opened before the app restarted?)")
                    return self._json(403, {"error": "token inválido", "code": "token"})
                route = ROUTES.get((method, path))
                if route is None:
                    return self._json(404, {"error": "rota desconhecida"})
                name = route.fn.__name__
                body = {}
                if method == "POST":
                    n = int(self.headers.get("Content-Length") or 0)
                    if n > MAX_BODY:
                        return self._json(413, {"error": "corpo grande demais"})
                    try:
                        body = json.loads(self.rfile.read(n) or b"{}")
                    except ValueError as e:
                        log.warning("%s %s: invalid JSON body: %s", method, path, e)
                        return self._json(400, {"error": f"JSON: {e}"})
                else:
                    # GET: os parâmetros da URL (?after=12) chegam como o "body"
                    query = self.path.split("?", 1)[1] if "?" in self.path else ""
                    body = {k: v[-1] for k, v in urllib.parse.parse_qs(query).items()}
                try:
                    return self._json(200, route.fn(server.ctx, body))
                except Exception as e:
                    log.error("%s %s failed: %s", method, path, e, exc_info=True, extra={"ctx": {"route": name}})
                    return self._json(500, {"error": f"{type(e).__name__}: {e}"})
            if method != "GET":
                return self._send(405, b"", "text/plain")
            # arquivos estáticos: o editor atual em /, o novo em /next (o build do editor-next/)
            if path == NEXT_PREFIX or path.startswith(NEXT_PREFIX + "/"):
                root, rel = paths.EDITOR_NEXT, path[len(NEXT_PREFIX) :].lstrip("/") or "index.html"
            else:
                root, rel = STATIC, "index.html" if path in ("/", "") else path.lstrip("/")
            target = (root / rel).resolve()
            if root.resolve() not in target.parents or not target.is_file():
                return self._send(404, b"not found", "text/plain")
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            self._send(200, target.read_bytes(), ctype)

        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

    return Handler
