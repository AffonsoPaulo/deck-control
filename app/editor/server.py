"""Servidor HTTP local do editor visual.

Segurança: escuta só em 127.0.0.1, exige um token aleatório (guardado no perfil, o mesmo entre execuções)
no cabeçalho X-Token de toda chamada /api, e confere o Host (contra DNS rebinding). Sem isso, qualquer site
aberto no navegador poderia mandar o app gravar uma ação 'command' no config.

O token tem o formato XXXX-XXXX-XXXX (base32 de Crockford: sem I, L, O, U; 60 bits). O editor o leva no
caminho (/XXXX-XXXX-XXXX/teclas/...): por isso toda resposta manda Referrer-Policy: no-referrer, para o
navegador nunca repassar o endereço a outro site, e o log mascara o token como qualquer segredo.
"""

from __future__ import annotations

import json
import mimetypes
import re
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

# o que a página do editor pode carregar: só deste servidor (imagens também data:, as prévias das teclas); nenhum
# outro site pode abrir o editor dentro de um quadro (frame-ancestors), contra clique enganado
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; "
    "frame-ancestors 'none'"
)

# sem o build do editor (desenvolvimento, antes do npm run build): explica em vez de um 404 seco
NO_BUILD = (
    "<!doctype html><meta charset=utf-8><title>Deck</title><body style='font:16px system-ui;padding:2rem'>"
    "<h1>O editor ainda não foi montado</h1><p>Na pasta <code>editor-next</code>, rode <code>npm run build</code> "
    "e recarregue esta página.</p>"
).encode()
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/ttf", ".ttf")
# o Windows lê os tipos do registro, e alguns PCs dizem text/plain para .js: o navegador recusa módulos assim
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/json", ".map")
OLD_NEXT = "/next"  # onde o editor ficava antes da troca: redireciona para a raiz (aba ou favorito antigo)
TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # base32 de Crockford: sem I, L, O, U (não confundem)
TOKEN_RE = re.compile(r"[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){2}")
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
        """O editor, com o token no caminho."""
        return f"http://127.0.0.1:{self.port}/{self.token}/teclas"

    def start(self) -> None:
        self._thread.start()
        log.info("Editor at %s", self.url)  # o token sai como **** (logs.configure)

    def stop(self) -> None:
        self.httpd.shutdown()

    # -- API ------------------------------------------------------------------------


def new_token() -> str:
    """XXXX-XXXX-XXXX: 12 letras/números do base32 de Crockford (60 bits aleatórios), em grupos de 4."""
    raw = "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(12))
    return "-".join(raw[i : i + 4] for i in range(0, 12, 4))


def _persistent_token() -> str:
    """Token guardado no perfil do usuário: continua o mesmo quando o app reinicia, para uma aba do editor já
    aberta não perder a permissão de salvar. Um token no formato antigo (comprido) é trocado uma vez."""
    from app import winutil

    f = winutil.data_dir() / "editor-token"
    try:
        t = f.read_text(encoding="ascii").strip()
        if TOKEN_RE.fullmatch(t):
            return t
    except OSError:
        pass
    t = new_token()
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
            # o editor leva o token no caminho: o navegador nunca repassa o endereço a outro site
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            try:
                self.wfile.write(body)
            except _GONE:
                # o navegador desistiu do pedido (F5, aba fechada): normal, não é erro
                log.debug("Browser closed the connection before %s finished", self.path.split("?", 1)[0])

        def _redirect(self, to: str) -> None:
            # sempre um caminho deste servidor: "//site.com" viraria um endereço de outro site
            to = "/" + to.lstrip("/\\")
            self.status = 302
            self.send_response(302)
            self.send_header("Location", to)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()

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
                # em bytes: o compare_digest recusa texto com acento (o cabeçalho pode vir com qualquer coisa)
                sent = self.headers.get("X-Token", "").encode("utf-8", "surrogateescape")
                if not secrets.compare_digest(sent, server.token.encode("ascii")):
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
                    try:
                        n = int(self.headers.get("Content-Length") or 0)
                    except ValueError:
                        n = -1
                    if n < 0:  # negativo leria até a conexão fechar
                        return self._json(400, {"error": "Content-Length inválido"})
                    if n > MAX_BODY:
                        return self._json(413, {"error": "corpo grande demais"})
                    try:
                        body = json.loads(self.rfile.read(n) or b"{}")
                    except ValueError as e:
                        log.warning("%s %s: invalid JSON body: %s", method, path, e)
                        return self._json(400, {"error": f"JSON: {e}"})
                    if not isinstance(body, dict):
                        return self._json(400, {"error": "o corpo precisa ser um objeto JSON"})
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
            # o editor fica na raiz; o endereço de antes da troca (/next/...) leva para o mesmo lugar
            if path == OLD_NEXT or path.startswith(OLD_NEXT + "/"):
                rest = path[len(OLD_NEXT) :] or "/"
                return self._redirect(rest)
            # arquivos do build do editor (editor-next/dist). As páginas (/, /XXXX-XXXX-XXXX/qualquer/coisa) são
            # todas o index.html: quem lê o resto do caminho (seção, página, tecla) é o próprio editor.
            rest = path.lstrip("/")
            first = rest.split("/", 1)[0]
            root = paths.EDITOR_NEXT
            rel = "index.html" if not rest or TOKEN_RE.fullmatch(first) else rest
            if rel == "index.html" and not (root / rel).is_file():
                return self._send(503, NO_BUILD, "text/html; charset=utf-8")
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
