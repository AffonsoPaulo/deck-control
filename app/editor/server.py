"""Servidor HTTP local do editor visual.

Segurança: escuta só em 127.0.0.1, exige um token aleatório (gerado a cada
execução) no cabeçalho X-Token de toda chamada /api, e confere o Host
(contra DNS rebinding). Sem isso, qualquer site aberto no navegador poderia
mandar o app gravar uma ação 'command' no config.
"""
from __future__ import annotations

import base64
import io
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

from app import actions, history, i18n, icons, logs, transfer, values, widgets
from app.config import ConfigError, build_config
from app.configio import read_plain, save_plain
from app.schema import schema
from app.i18n import tr

if TYPE_CHECKING:
    from app.engine import Engine

STATIC = Path(__file__).parent / "static"
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/ttf", ".ttf")
MAX_BODY = 8 * 1024 * 1024
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
    def __init__(self, config_path: Path, engine: "Engine | None" = None, port: int = 8765):
        self.config_path = Path(config_path)
        self.engine = engine
        self.token = _persistent_token()
        self._register_token()
        self.httpd = self._bind(port)
        self.port = self.httpd.server_address[1]
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True, name="editor")
        history.record(self.config_path)   # garante que o estado atual está no histórico

    def _register_token(self) -> None:
        """O token do editor não pode aparecer no log (ele dá permissão de gravar o config)."""
        if self.engine is not None:
            self.engine.log_secrets.add(self.token)
            self.engine.apply_log_settings()
            return
        # sem engine (testes): as mesmas regras, lidas direto do arquivo
        from app.plugins import MANAGER
        try:
            raw = yaml.safe_load(self.config_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            raw = {}
        raw = raw if isinstance(raw, dict) else {}
        logs.configure(raw.get("logging"), secrets=[*MANAGER.secret_values(raw), self.token])

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
        log.info("Editor at %s", self.url)      # o token sai como **** (logs.configure)

    def stop(self) -> None:
        self.httpd.shutdown()

    # -- API ------------------------------------------------------------------------

    def api_get_config(self, _body):
        return {"config": read_plain(self.config_path), "file": self.config_path.name}

    def api_save_config(self, body):
        cfg = body.get("config")
        if not isinstance(cfg, dict):
            return {"ok": False, "errors": [tr("invalid config")]}
        i18n.set_language(cfg.get("language"))
        try:
            # valida exatamente como o app vai ler (PyYAML), antes de gravar
            build_config(yaml.safe_load(yaml.safe_dump(cfg, allow_unicode=True)), self.config_path)
        except ConfigError as e:
            errors = str(e).split("\n  - ")[1:] or [str(e)]
            log.warning("Config not saved: %d problem(s): %s", len(errors), "; ".join(errors))
            return {"ok": False, "errors": errors}
        try:
            save_plain(self.config_path, cfg)
        except Exception as e:
            log.error("Saving the config failed: %s", e, exc_info=True, extra={"ctx": {"file": str(self.config_path)}})
            raise
        log.info("Config saved from the editor")
        history.record(self.config_path)
        return {"ok": True}

    def api_history(self, _body):
        return {"entries": history.entries(self.config_path)}

    def api_history_restore(self, body):
        when = history.restore(self.config_path, str(body["id"]))
        return {"config": read_plain(self.config_path), "when": when}

    def api_export(self, body):
        name, data = transfer.export_zip(self.config_path, bool(body.get("include_secrets")))
        return {"name": name, "data": base64.b64encode(data).decode()}

    def api_import(self, body):
        name = transfer.safe_filename(body.get("name", "arquivo"))
        raw = base64.b64decode(str(body["data"]).split(",", 1)[-1])
        if len(raw) > MAX_BODY:
            raise ValueError(tr("file too large"))
        plain, images = transfer.read_import(name, raw)
        if body.get("dry_run"):
            return {"summary": transfer.summarize_import(plain, images)}
        try:
            new = transfer.build_import(self.config_path, plain, images, body.get("mode", "replace"))
        except ConfigError as e:
            log.warning("Import of %s refused: the config has problems", name)
            return {"ok": False, "errors": str(e).split("\n  - ")[1:] or [str(e)]}
        save_plain(self.config_path, new)
        log.info("Config imported from %s (%s)", name, body.get("mode", "replace"))
        history.record(self.config_path, reason=f"Importado de {name}")
        return {"ok": True, "config": read_plain(self.config_path)}

    def api_validate(self, body):
        from app.binds import conflicts
        raw = body.get("config") or {}
        try:
            out = {"conflicts": conflicts(raw)}
        except Exception:                     # um config pela metade não pode derrubar a validação
            log.debug("Shortcut conflict check failed (config being edited)", exc_info=True)
            out = {"conflicts": []}
        try:
            build_config(raw, self.config_path)
            return {"ok": True, **out}
        except ConfigError as e:
            return {"ok": False, "errors": str(e).split("\n  - ")[1:] or [str(e)], **out}

    def api_preview(self, body):
        """[{icon, active_icon, action}] -> [{normal, active|null}] em data URLs PNG."""
        out = []
        base = self.config_path.parent
        defaults = body.get("icons") if isinstance(body.get("icons"), dict) else None
        get = _sample_getter()
        wdefs = None
        for item in body.get("keys", []):
            if not item:
                out.append(None)
                continue
            if item.get("widget"):                 # widget: monta as células do tamanho escolhido
                if wdefs is None:
                    wdefs = widgets.all_defs(body.get("widgets"))
                built = widgets.expand(item, wdefs, "preview")
                item = {**item, "span": list(built["span"]), "cells": built["cells"], "icon": built["icon"], "mode": "split"}
            icon = item.get("icon") or {}
            if isinstance(icon, str):
                icon = {"text": icon}
            span = item.get("span") or [1, 1]
            if span != [1, 1] and item.get("mode") == "image" and icon.get("image"):
                try:
                    gap = int(((body.get("device") or {}).get("gap_px")) or 28)
                    tiles = icons.block_slices(icons._image_path(icon, base), int(span[0]), int(span[1]), gap)
                    out.append({"normal": None, "active": None, "cells": [_png(t) for t in tiles]})
                except (OSError, ValueError):
                    out.append({"normal": _preview({"text": "?"}, base, defaults), "active": None})
                continue
            if span != [1, 1] and item.get("cells"):
                cells = [c if isinstance(c, dict) else {"text": str(c)} for c in item["cells"]]
                out.append({"normal": None, "active": None,
                            "cells": [_preview(values.resolve_icon(c, get), base, defaults) for c in cells]})
                continue
            icon = values.resolve_icon(icon, get)
            res = {"normal": _preview(icon, base, defaults), "active": None}
            has_state = item.get("state") or actions.state_of(item.get("action"), "x:0")
            if has_state:
                override = item.get("active_icon") or {"bg": "#C62828"}
                if isinstance(override, str):
                    override = {"text": override}
                res["active"] = _preview(icons.merge_icon(icon, values.resolve_icon(override, get)), base, defaults)
            out.append(res)
        return {"images": out}

    def api_widget_expand(self, body):
        """{key: {widget, size, options, colors}, widgets} -> o widget montado (para separar em teclas e as ações padrão)."""
        k = body.get("key") if isinstance(body.get("key"), dict) else {}
        built = widgets.expand(k, widgets.all_defs(body.get("widgets")), str(body.get("id") or "key"))
        return {**built, "span": list(built["span"])}

    def api_values(self, _body):
        """Valor atual de cada valor (para a lista do editor e as etiquetas de prévia)."""
        from app.schema import schema as _schema
        get = _sample_getter()
        out = {}
        for v in _schema()["values"]:
            val = get(v["id"])
            out[v["id"]] = None if val is None else values._fmt(val, None)
        return {"values": out}

    def api_schema(self, _body):
        # o editor pode abrir antes de o engine ler o config (ou sem engine, nos testes)
        try:
            raw = yaml.safe_load(self.config_path.read_text(encoding="utf-8")) or {}
            i18n.set_language(raw.get("language") if isinstance(raw, dict) else None)
        except (OSError, yaml.YAMLError) as e:
            log.debug("api_schema: couldn't read the language from the config: %s", e)
        return schema()

    def api_status(self, _body):
        e = self.engine
        if e is None:
            s = logs.summary()
            return {"engine": False, "logs": {"new_errors": s["new_errors"], "last": s["last"]},
                    "problems": logs.problems()}
        from app.plugins import MANAGER
        s = logs.summary()
        return {"engine": True, "device": e.device_connected, "page": e.page,
                "obs": bool(e.obs and e.obs.req is not None), "plugins": MANAGER.status(),
                "logs": {"new_errors": s["new_errors"], "last": s["last"]}, "problems": logs.problems()}

    def api_about(self, _body):
        """Dados da seção Sobre e o 'iniciar com o Windows'."""
        from app import winutil
        e = self.engine
        try:
            autostart = winutil.autostart_enabled()
        except Exception:
            log.debug("Couldn't read the autostart setting", exc_info=True)
            autostart = None
        return {"firmware": e.firmware if e else None, "device": bool(e and e.device_connected),
                "autostart": autostart, "config": str(self.config_path), "log": str(winutil.log_path())}

    def api_autostart(self, body):
        from app import winutil
        winutil.set_autostart(bool(body.get("enabled")), self.config_path)
        return {"autostart": winutil.autostart_enabled()}

    def api_open(self, body):
        """Abre o log, a pasta dos logs ou a pasta do app no Windows (só esses)."""
        import os
        from app import winutil
        what = body.get("what")
        target = {"log": winutil.log_path(), "logs": logs.log_dir(), "folder": self.config_path.parent}.get(what)
        if target is None:
            raise ValueError(f"what to open? (log, logs or folder, got {what!r})")
        log.debug("Opening %s: %s", what, target)
        os.startfile(str(target))
        return {"ok": True}

    # -- aba Logs
    def api_logs(self, query):
        try:
            after = int(query.get("after") or 0)
        except (TypeError, ValueError):
            after = 0
        return {"records": logs.records(after), "summary": logs.summary(), "problems": logs.problems(),
                "files": logs.files_info(),
                "detail": {"detail": bool(getattr(logs, "_detail", False)),
                           "areas": sorted(getattr(logs, "_areas", ()) or ()),
                           "force": bool(getattr(logs, "_force_debug", False))}}

    def api_logs_seen(self, body):
        upto = body.get("upto")
        logs.mark_seen(int(upto) if isinstance(upto, (int, float)) and not isinstance(upto, bool) else None)
        return {"ok": True}

    def api_logs_diagnostics(self, _body):
        """Pacote para pedir ajuda: logs, config sem as senhas, versões, plugins e o aparelho."""
        from app import configio
        from app.plugins import MANAGER
        try:
            text = configio.without_secrets(self.config_path.read_text(encoding="utf-8"), MANAGER.secret_paths())
        except OSError as e:
            log.warning("Diagnostics: couldn't read the config: %s", e)
            text = None
        e = self.engine
        extra = {"plugins": [{"id": p.id, "version": p.manifest.get("version"), "running": p.running,
                              "builtin": p.builtin} for p in MANAGER.plugins.values()],
                 "device": e.device_info() if e is not None else {"connected": False},
                 "page": e.page if e is not None else None}
        data = logs.diagnostics_zip(text, extra=extra)
        name = f"deck-diagnostics-{time.strftime('%Y%m%d-%H%M')}.zip"
        log.info("Diagnostics package created: %s (%d KB)", name, len(data) // 1024)
        return {"name": name, "data": base64.b64encode(data).decode()}

    # -- plugins de terceiros: inspecionar o .zip, instalar, remover
    def _plugin_zip(self, body) -> tuple[Path, dict]:
        """Abre o .zip num diretório temporário e devolve (pasta do plugin, manifesto)."""
        import tempfile
        import zipfile
        from app.plugins import PluginError, read_manifest
        raw = base64.b64decode(str(body["data"]).split(",", 1)[-1])
        if len(raw) > MAX_BODY:
            raise ValueError(tr("file too large"))
        tmp = Path(tempfile.mkdtemp(prefix="d6plugin-"))
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names = z.namelist()
                if len(names) > 2000:
                    raise PluginError(tr("the .zip has too many files"))
                total = 0
                for info in z.infolist():
                    target = (tmp / info.filename).resolve()
                    if not str(target).startswith(str(tmp.resolve())):
                        raise PluginError(tr("the .zip has invalid paths"))
                    total += info.file_size
                    if total > 200 * 1024 * 1024:
                        raise PluginError(tr("the unzipped plugin is over 200 MB"))
                z.extractall(tmp)
        except zipfile.BadZipFile:
            raise PluginError(tr("the file isn't a valid .zip")) from None
        folder = tmp
        if not (folder / "plugin.json").exists():
            subs = [d for d in tmp.iterdir() if d.is_dir()]
            if len(subs) == 1 and (subs[0] / "plugin.json").exists():
                folder = subs[0]
        return folder, read_manifest(folder, builtin=False)

    def api_plugin_inspect(self, body):
        import shutil
        from app.plugins import MANAGER
        from app.plugins import localize, read_locales
        folder, m = self._plugin_zip(body)
        try:
            existing = MANAGER.plugins.get(m["id"])
            m = localize(m, read_locales(folder))
            return {"manifest": {k: m.get(k) for k in ("id", "name", "version", "author", "description", "icon", "color",
                                                       "permissions", "homepage")},
                    "actions": [d.get("label") for d in m.get("actions", {}).values()],
                    "installed": existing.manifest.get("version") if existing and not existing.builtin else None,
                    "builtin_conflict": bool(existing and existing.builtin)}
        finally:
            shutil.rmtree(folder if folder.name.startswith("d6plugin-") else folder.parent, ignore_errors=True)

    def api_plugin_install(self, body):
        import shutil
        from app.plugins import MANAGER
        from app.schema import schema
        folder, m = self._plugin_zip(body)
        try:
            MANAGER.install(folder, replace=bool(body.get("replace")))
        finally:
            shutil.rmtree(folder if folder.name.startswith("d6plugin-") else folder.parent, ignore_errors=True)
        return {"ok": True, "id": m["id"], "schema": schema()}

    def api_plugin_remove(self, body):
        from app.plugins import MANAGER
        from app.schema import schema
        MANAGER.remove(str(body.get("id", "")))
        return {"ok": True, "schema": schema()}

    def api_obs(self, _body):
        return self.engine.obs_lists() if self.engine else {"connected": False}

    def api_press(self, body):
        self._need_engine().press(str(body["page"]), int(body["key"]), body.get("which", "action"))
        return {"ok": True}

    def api_show(self, body):
        self._need_engine().go_to_page(str(body["page"]))
        return {"ok": True}

    def api_upload(self, body):
        """Salva uma imagem enviada pelo navegador em icons/ ao lado do config."""
        name = re.sub(r"[^\w.\-]+", "_", Path(str(body.get("name", "imagem.png"))).name)[:80] or "imagem.png"
        data = base64.b64decode(body["data"].split(",", 1)[-1])
        if len(data) > 5 * 1024 * 1024:
            raise ValueError(tr("image larger than 5 MB"))
        folder = self.config_path.parent / "icons"
        folder.mkdir(exist_ok=True)
        target = folder / name
        stem, suffix, n = target.stem, target.suffix, 1
        while target.exists() and target.read_bytes() != data:
            target = folder / f"{stem}-{n}{suffix}"
            n += 1
        target.write_bytes(data)
        return {"path": f"icons/{target.name}"}

    def api_image_info(self, body):
        """Nome, tamanho, quadros (GIF) e uma miniatura da imagem de um ícone, para o cartão da aba Aparência."""
        from PIL import Image
        path = icons._image_path({"image": str(body.get("path") or "")}, self.config_path.parent)
        try:
            with Image.open(path) as im:
                info = {"name": path.name, "width": im.width, "height": im.height,
                        "frames": int(getattr(im, "n_frames", 1) or 1)}
                first = im.convert("RGBA")
        except (OSError, ValueError):
            return {"name": path.name, "missing": True}
        frames = icons._gif_frames(path) or []
        if len(frames) > 1:
            small = []
            for fr, ms in frames:
                t = fr.copy(); t.thumbnail((88, 88)); small.append((t, ms))
            buf = io.BytesIO()
            small[0][0].save(buf, format="WEBP", save_all=True, append_images=[f for f, _ in small[1:]],
                             duration=[ms for _, ms in small], loop=0, quality=80)
            info["thumb"] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
        else:
            first.thumbnail((88, 88))
            info["thumb"] = _png(first)
        return info

    def api_free_bind(self, body):
        """Próximas combinações livres, considerando o config em edição (ainda não salvo)."""
        from app.binds import free_combos
        rules = body.get("rules") if isinstance(body.get("rules"), dict) else None
        return {"combos": free_combos(body.get("config") or {}, int(body.get("count", 1)), rules, body.get("taken") or ())}

    def api_record(self, body):
        """Gravar pela tecla do D6: a próxima tecla apertada só manda o atalho (sem rodar a ação)."""
        e = self._need_engine()
        if body.get("cancel"):
            e.cancel_record()
            return {"ok": True}
        from app import keys
        combo = str(body["keys"])
        keys.parse_combo(combo)
        e.arm_record(combo, float(body.get("seconds", 30)))
        return {"ok": True}

    def api_record_state(self, _body):
        return self._need_engine().record_state()

    def api_send_combo(self, body):
        """Aperta uma combinação depois de N segundos (para gravar o atalho em outro programa)."""
        from app import keys
        combo = str(body["keys"])
        keys.parse_combo(combo)  # valida antes de agendar
        delay = max(0.0, min(15.0, float(body.get("delay", 5))))
        threading.Timer(delay, keys.press_combo, args=(combo,), kwargs={"hold_ms": 80}).start()
        return {"ok": True}

    def _need_engine(self) -> "Engine":
        if self.engine is None:
            raise RuntimeError(tr("the app isn't running"))
        return self.engine


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


def _sample_getter():
    """Valor atual; sem ele (plugin desligado, app fechado), o exemplo declarado, para a prévia não ficar vazia."""
    samples = {}
    try:
        from app.plugins import MANAGER
        for v in values.describe() + MANAGER.value_schemas():
            samples[v["id"]] = v.get("sample")
    except Exception:
        log.debug("Couldn't read the sample values", exc_info=True)

    def get(name):
        v = values.VALUES.get(name)
        if v is None and name.startswith("timer."):
            return "05:00" if name.count(".") == 1 else 100 if name.endswith(".pct") else False
        return samples.get(name) if v is None else v
    return get


def _preview(icon, base, defaults) -> str:
    """PNG, ou WebP animado quando o ícone usa um GIF animado (a prévia anima também)."""
    if not icon.get("image"):
        return _png(icons.render_icon(icon, base, defaults))
    frames = icons.render_frames(icon, base, defaults)
    if len(frames) < 2:
        return _png(frames[0][0])
    buf = io.BytesIO()
    frames[0][0].save(buf, format="WEBP", save_all=True, append_images=[f for f, _ in frames[1:]],
                      duration=[ms for _, ms in frames], loop=0, quality=85)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def _png(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


ROUTES = {
    ("GET", "/api/config"): "api_get_config",
    ("POST", "/api/config"): "api_save_config",
    ("POST", "/api/validate"): "api_validate",
    ("POST", "/api/preview"): "api_preview",
    ("POST", "/api/widget/expand"): "api_widget_expand",
    ("GET", "/api/schema"): "api_schema",
    ("GET", "/api/status"): "api_status",
    ("GET", "/api/logs"): "api_logs",
    ("POST", "/api/logs/seen"): "api_logs_seen",
    ("POST", "/api/logs/diagnostics"): "api_logs_diagnostics",
    ("GET", "/api/obs"): "api_obs",
    ("GET", "/api/about"): "api_about",
    ("POST", "/api/autostart"): "api_autostart",
    ("POST", "/api/open"): "api_open",
    ("POST", "/api/plugins/inspect"): "api_plugin_inspect",
    ("POST", "/api/plugins/install"): "api_plugin_install",
    ("POST", "/api/plugins/remove"): "api_plugin_remove",
    ("POST", "/api/press"): "api_press",
    ("POST", "/api/show"): "api_show",
    ("POST", "/api/upload"): "api_upload",
    ("POST", "/api/image_info"): "api_image_info",
    ("POST", "/api/free_bind"): "api_free_bind",
    ("POST", "/api/send_combo"): "api_send_combo",
    ("POST", "/api/record"): "api_record",
    ("GET", "/api/values"): "api_values",
    ("GET", "/api/record"): "api_record_state",
    ("GET", "/api/history"): "api_history",
    ("POST", "/api/history/restore"): "api_history_restore",
    ("POST", "/api/export"): "api_export",
    ("POST", "/api/import"): "api_import",
}


_token_warned = [0.0]        # quando avisou do token antigo (uma aba velha pergunta a cada segundo)


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
                log.debug("%s %s %s in %d ms", method, path, self.status or "-", round((time.perf_counter() - t0) * 1000))

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
                name = ROUTES.get((method, path))
                if not name:
                    return self._json(404, {"error": "rota desconhecida"})
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
                    return self._json(200, getattr(server, name)(body))
                except Exception as e:
                    log.error("%s %s failed: %s", method, path, e, exc_info=True, extra={"ctx": {"route": name}})
                    return self._json(500, {"error": f"{type(e).__name__}: {e}"})
            if method != "GET":
                return self._send(405, b"", "text/plain")
            # arquivos estáticos
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            target = (STATIC / rel).resolve()
            if STATIC.resolve() not in target.parents or not target.is_file():
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
