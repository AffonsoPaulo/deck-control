"""API do editor, pelo HTTP de verdade: o que cada rota responde hoje.

Servidor na porta 0 (qualquer livre), com um config sintético em tmp_path. As rotas que mexeriam no PC de quem
roda os testes são trocadas por falsas: iniciar com o Windows (registro), abrir pasta, apertar teclas e rodar
ações. O Engine é o de verdade, só construído (sem abrir o Deck: quem abre é o run()).
"""

from __future__ import annotations

import base64
import http.client
import io
import json
import zipfile
from pathlib import Path

import jsonschema
import pytest

from app import actions, history
from app.editor import contract
from app.editor.api import ROUTES
from app.editor.server import EditorServer
from app.plugins import MANAGER

CONFIG = """\
language: en
brightness: 70
pages:
  main:
    1: { icon: { text: "Mic" }, action: { type: hotkey, keys: "ctrl+shift+m" } }
    2: { icon: { text: "Rec", bg: "#1d2330" }, state: rec.on, action: { type: hotkey, keys: "f13" } }
    4: { widget: app.clock, size: 1x2 }
  other:
    1: { icon: { text: "Back" }, action: { type: page, page: main } }
"""


def _png_b64() -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (1, 1), (255, 0, 0)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


PNG_1PX = _png_b64()


# o contrato exportado (o arquivo que o editor em React lê), conferido por uma biblioteca independente
SCHEMA = json.loads(contract.SCHEMA_FILE.read_text(encoding="utf-8"))


def _validator(sub: dict) -> jsonschema.Draft202012Validator:
    return jsonschema.Draft202012Validator({**sub, "$defs": SCHEMA["$defs"]})


def check_contract(kind: str, route: str, value) -> None:
    """kind: request | response | error. Levanta se o valor não segue o contrato."""
    sub = SCHEMA["x-error"] if kind == "error" else SCHEMA["x-routes"][route][kind]
    errors = sorted(_validator(sub).iter_errors(value), key=lambda e: list(e.path))
    assert not errors, f"{route} ({kind}) fora do contrato: " + "; ".join(
        f"{list(e.path)}: {e.message[:200]}" for e in errors[:5]
    )


class Client:
    def __init__(self, srv: EditorServer):
        self.srv = srv

    def request(
        self,
        method: str,
        path: str,
        body=None,
        token: str | None = None,
        host: str | None = None,
        raw=None,
        check_request: bool = True,
    ):
        route = f"{method} {path.split('?', 1)[0]}"
        known = route in SCHEMA["x-routes"]
        if known and check_request and body is not None and SCHEMA["x-routes"][route]["request"] is not None:
            check_contract("request", route, body)
        conn = http.client.HTTPConnection("127.0.0.1", self.srv.port, timeout=20)
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        headers = {"Host": host or f"127.0.0.1:{self.srv.port}", "X-Token": self.srv.token if token is None else token}
        if data is not None:
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=headers)
        r = conn.getresponse()
        payload = r.read()
        conn.close()
        ctype = r.getheader("Content-Type") or ""
        data = json.loads(payload) if ctype.startswith("application/json") else payload
        if ctype.startswith("application/json"):
            if r.status == 200 and known:
                check_contract("response", route, data)
            elif r.status != 200:
                check_contract("error", route, data)
        return r.status, data

    def get(self, path: str, **kw):
        status, data = self.request("GET", path, **kw)
        assert status == 200, (path, status, data)
        return data

    def post(self, path: str, body=None, **kw):
        status, data = self.request("POST", path, body if body is not None else {}, **kw)
        assert status == 200, (path, status, data)
        return data


@pytest.fixture
def cfg_path(tmp_path) -> Path:
    p = tmp_path / "config.yaml"
    p.write_text(CONFIG, encoding="utf-8")
    return p


@pytest.fixture
def no_side_effects(monkeypatch):
    """Troca o que sai do app (registro do Windows, Explorer, teclado, ações) por gravações numa lista."""
    from app import keys, winutil

    calls: list = []
    state = {"autostart": False}
    monkeypatch.setattr(winutil, "autostart_enabled", lambda: state["autostart"])
    monkeypatch.setattr(
        winutil, "set_autostart", lambda on, cfg: (calls.append(("autostart", on)), state.update(autostart=on))
    )
    monkeypatch.setattr("os.startfile", lambda target: calls.append(("open", str(target))), raising=False)
    monkeypatch.setattr(keys, "press_combo", lambda combo, **kw: calls.append(("press_combo", combo)))
    monkeypatch.setattr(actions, "run", lambda spec, ctx: calls.append(("run", ctx.page, ctx.key)))
    return calls


def _server(cfg_path: Path, engine) -> EditorServer:
    MANAGER.engine = None  # instalar/remover plugin não liga nada (só o engine rodando liga)
    srv = EditorServer(cfg_path, engine, port=0)
    srv.start()
    return srv


@pytest.fixture
def api(cfg_path, no_side_effects):
    """Servidor sem engine (o editor aberto antes do app, ou o servidor de teste)."""
    srv = _server(cfg_path, None)
    yield Client(srv)
    srv.stop()
    srv.httpd.server_close()


@pytest.fixture
def api_engine(cfg_path, no_side_effects):
    """Servidor com o Engine de verdade, só construído."""
    from app.engine import Engine
    from app.values import VALUES

    engine = Engine(cfg_path)
    srv = _server(cfg_path, engine)
    yield Client(srv)
    srv.stop()
    srv.httpd.server_close()
    engine._pool.shutdown(wait=True)
    VALUES.engine = None


# ---------------------------------------------------------------------------- as rotas


ALL_ROUTES = {
    ("GET", "/api/about"),
    ("GET", "/api/config"),
    ("GET", "/api/history"),
    ("GET", "/api/logs"),
    ("GET", "/api/obs"),
    ("GET", "/api/record"),
    ("GET", "/api/schema"),
    ("GET", "/api/status"),
    ("GET", "/api/values"),
    ("POST", "/api/autostart"),
    ("POST", "/api/config"),
    ("POST", "/api/export"),
    ("POST", "/api/free_bind"),
    ("POST", "/api/history/restore"),
    ("POST", "/api/image_info"),
    ("POST", "/api/import"),
    ("POST", "/api/logs/diagnostics"),
    ("POST", "/api/logs/seen"),
    ("POST", "/api/open"),
    ("POST", "/api/plugins/inspect"),
    ("POST", "/api/plugins/install"),
    ("POST", "/api/plugins/remove"),
    ("POST", "/api/press"),
    ("POST", "/api/preview"),
    ("POST", "/api/record"),
    ("POST", "/api/send_combo"),
    ("POST", "/api/show"),
    ("POST", "/api/upload"),
    ("POST", "/api/validate"),
    ("POST", "/api/widget/expand"),
}


def test_the_routes_are_these_30():
    # o editor (app.js) chama estas; trocar uma é mudar o contrato
    assert set(ROUTES) == ALL_ROUTES


def test_get_config(api):
    r = api.get("/api/config")
    assert r["file"] == "config.yaml"
    assert r["config"]["brightness"] == 70
    assert list(r["config"]["pages"]["main"]) == ["1", "2", "4"]


def test_save_config_ok_and_invalid(api, cfg_path):
    cfg = api.get("/api/config")["config"]
    cfg["brightness"] = 40
    assert api.post("/api/config", {"config": cfg}) == {"ok": True}
    assert "brightness: 40" in cfg_path.read_text(encoding="utf-8")

    cfg["pages"]["main"]["1"]["action"] = {"type": "nope"}
    r = api.post("/api/config", {"config": cfg})
    assert r["ok"] is False
    assert any("unknown action type 'nope'" in e for e in r["errors"])

    assert api.post("/api/config", {"config": "x"}, check_request=False) == {"ok": False, "errors": ["invalid config"]}


def test_validate(api):
    cfg = api.get("/api/config")["config"]
    assert api.post("/api/validate", {"config": cfg}) == {"ok": True, "conflicts": []}
    cfg["pages"]["main"]["1"]["action"] = {"type": "nope"}
    r = api.post("/api/validate", {"config": cfg})
    assert r["ok"] is False and r["conflicts"] == [] and len(r["errors"]) == 1
    cfg["pages"]["main"]["1"]["action"] = {"type": "bind", "keys": "ctrl+f13"}
    cfg["pages"]["main"]["3"] = {"action": {"type": "bind", "keys": "ctrl+f13"}}
    r = api.post("/api/validate", {"config": cfg})
    assert [c["combo"] for c in r["conflicts"]] == ["ctrl+f13"]
    assert set(r["conflicts"][0]["places"][0]) == {"page", "key", "type"}


def test_preview(api):
    keys = [
        None,
        {"icon": {"text": "A"}},
        {"icon": "B"},
        {"icon": {"text": "R"}, "state": "rec.on"},
        {"widget": "app.clock", "size": "1x2"},
        {"span": [2, 1], "cells": [{"text": "x"}, "y"]},
    ]
    images = api.post("/api/preview", {"keys": keys})["images"]
    assert images[0] is None
    assert set(images[1]) == {"normal", "active"} and images[1]["active"] is None
    assert images[1]["normal"].startswith("data:image/png;base64,")
    assert images[2]["normal"].startswith("data:image/png;base64,")
    assert images[3]["active"].startswith("data:image/png;base64,")
    for i in (4, 5):
        assert images[i]["normal"] is None and images[i]["active"] is None
        assert len(images[i]["cells"]) == 2


def test_widget_expand(api):
    r = api.post("/api/widget/expand", {"key": {"widget": "app.clock", "size": "1x2"}, "id": "k1"})
    # como o editor manda (widgets.js): opções e cores nulas, id nulo
    key = {"widget": "app.clock", "size": "1x1", "options": None, "colors": None}
    assert api.post("/api/widget/expand", {"key": key, "widgets": None, "id": None})["span"] == [1, 1]
    assert r["span"] == [2, 1]
    assert len(r["cells"]) == 2
    assert {"span", "cells", "icon"} <= set(r)


def test_values(api):
    vals = api.get("/api/values")["values"]
    assert "clock.hour" in vals
    assert all(v is None or isinstance(v, str) for v in vals.values())


def test_schema(api):
    s = api.get("/api/schema")
    assert {"actions", "values", "widgets", "plugins", "plugin_groups", "plugin_errors"} <= set(s)
    assert "hotkey" in s["actions"] and "obs.record" in s["actions"]


def test_status_without_and_with_engine(api, api_engine):
    s = api.get("/api/status")
    assert s["engine"] is False
    assert set(s) == {"engine", "logs", "problems"}
    assert set(s["logs"]) == {"new_errors", "last"}
    s = api_engine.get("/api/status")
    assert s["engine"] is True
    assert set(s) == {"engine", "device", "page", "obs", "plugins", "logs", "problems"}
    assert s["device"] is False and s["page"] == "main" and s["obs"] is False
    assert {"obs", "discord", "weather"} <= set(s["plugins"])
    assert {"state", "label", "error"} <= set(s["plugins"]["obs"])


def test_about(api, api_engine):
    for c in (api, api_engine):
        r = c.get("/api/about")
        assert set(r) == {"firmware", "device", "autostart", "config", "log"}
        assert r["device"] is False and r["autostart"] is False and r["firmware"] is None


def test_autostart(api, no_side_effects):
    assert api.post("/api/autostart", {"enabled": True}) == {"autostart": True}
    assert ("autostart", True) in no_side_effects


def test_open(api, no_side_effects):
    for what in ("log", "logs", "folder"):
        assert api.post("/api/open", {"what": what}) == {"ok": True}
    assert [c[0] for c in no_side_effects] == ["open", "open", "open"]
    status, r = api.request("POST", "/api/open", {"what": "x"}, check_request=False)
    assert status == 500 and r["error"].startswith("ValueError: what to open?")


def test_logs(api):
    r = api.get("/api/logs?after=0")
    assert set(r) == {"records", "summary", "problems", "files", "detail"}
    assert set(r["detail"]) == {"detail", "areas", "force"}
    assert isinstance(api.get("/api/logs?after=abc")["records"], list)  # "after" inválido vira 0
    assert api.post("/api/logs/seen", {"upto": 10}) == {"ok": True}
    assert api.post("/api/logs/seen", {"upto": True}, check_request=False) == {"ok": True}


def test_diagnostics(api, api_engine):
    for c in (api, api_engine):
        r = c.post("/api/logs/diagnostics")
        assert r["name"].startswith("deck-diagnostics-") and r["name"].endswith(".zip")
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(r["data"]))) as z:
            assert z.namelist()


def test_obs(api, api_engine):
    assert api.get("/api/obs") == {"connected": False}
    assert api_engine.get("/api/obs") == {"connected": False, "scenes": [], "inputs": [], "sources": {}}


def _plugin_zip(pid="meu-plugin", nested=False) -> str:
    buf = io.BytesIO()
    manifest = {
        "id": pid,
        "name": "Meu plugin",
        "version": "1.2.3",
        "run": ["python", "main.py"],
        "actions": {f"{pid}.go": {"label": "Go"}},
    }
    prefix = f"{pid}/" if nested else ""
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(prefix + "plugin.json", json.dumps(manifest))
        z.writestr(prefix + "main.py", "print('oi')\n")
    return base64.b64encode(buf.getvalue()).decode()


def test_plugin_inspect_install_remove(api):
    before = sorted(n for n, d in actions.REGISTRY.items() if d.plugin)
    r = api.post("/api/plugins/inspect", {"data": _plugin_zip(nested=True)})
    assert r["manifest"]["id"] == "meu-plugin" and r["manifest"]["version"] == "1.2.3"
    assert set(r["manifest"]) == {
        "id",
        "name",
        "version",
        "author",
        "description",
        "icon",
        "color",
        "permissions",
        "homepage",
    }
    assert r["actions"] == ["Go"] and r["installed"] is None and r["builtin_conflict"] is False

    r = api.post("/api/plugins/install", {"data": _plugin_zip()})
    assert r["ok"] is True and r["id"] == "meu-plugin" and "meu-plugin.go" in r["schema"]["actions"]
    assert api.post("/api/plugins/inspect", {"data": _plugin_zip()})["installed"] == "1.2.3"
    status, err = api.request("POST", "/api/plugins/install", {"data": _plugin_zip()})
    assert status == 500 and "already installed" in err["error"]

    r = api.post("/api/plugins/remove", {"id": "meu-plugin"})
    assert r["ok"] is True and "meu-plugin.go" not in r["schema"]["actions"]
    assert sorted(n for n, d in actions.REGISTRY.items() if d.plugin) == before


def test_plugin_zip_problems(api):
    status, r = api.request("POST", "/api/plugins/inspect", {"data": base64.b64encode(b"nada").decode()})
    assert status == 500 and r["error"] == "PluginError: the file isn't a valid .zip"
    status, r = api.request("POST", "/api/plugins/install", {"data": _plugin_zip("obs")})
    assert status == 500 and "built-in plugin" in r["error"]


def test_press_and_show(api, api_engine, no_side_effects):
    status, r = api.request("POST", "/api/press", {"page": "main", "key": 1})
    assert status == 500 and r["error"] == "RuntimeError: the app isn't running"
    assert api_engine.post("/api/press", {"page": "main", "key": 1}) == {"ok": True}
    api_engine.srv.engine._pool.shutdown(wait=True)
    assert ("run", "main", 1) in no_side_effects
    assert api_engine.post("/api/show", {"page": "other"}) == {"ok": True}
    assert api_engine.srv.engine.page == "other"


def test_upload_and_image_info(api, cfg_path):
    r = api.post("/api/upload", {"name": "meu ícone.png", "data": "data:image/png;base64," + PNG_1PX})
    assert r == {"path": "icons/meu_ícone.png"}
    assert (cfg_path.parent / "icons" / "meu_ícone.png").is_file()
    assert api.post("/api/upload", {"name": "meu ícone.png", "data": PNG_1PX}) == r  # mesmo arquivo: reaproveita
    info = api.post("/api/image_info", {"path": r["path"]})
    assert set(info) == {"name", "width", "height", "frames", "thumb"}
    assert (info["width"], info["height"], info["frames"]) == (1, 1, 1)
    assert api.post("/api/image_info", {"path": "icons/nao-existe.png"}) == {"name": "nao-existe.png", "missing": True}


def test_free_bind(api):
    r = api.post(
        "/api/free_bind", {"config": {"pages": {}}, "count": 2, "rules": {"keys": "f13-f15", "modifiers": [""]}}
    )
    assert r == {"combos": ["f13", "f14"]}


def test_send_combo(api, no_side_effects):
    assert api.post("/api/send_combo", {"keys": "ctrl+f13", "delay": 0}) == {"ok": True}
    import time

    for _ in range(50):
        if ("press_combo", "ctrl+f13") in no_side_effects:
            break
        time.sleep(0.02)
    assert ("press_combo", "ctrl+f13") in no_side_effects
    status, r = api.request("POST", "/api/send_combo", {"keys": "ctrl+nada"})
    assert status == 500


def test_record(api, api_engine):
    status, r = api.request("GET", "/api/record")
    assert status == 500 and r["error"] == "RuntimeError: the app isn't running"
    assert api_engine.get("/api/record") == {"armed": False, "left": 0, "sent": None}
    assert api_engine.post("/api/record", {"keys": "ctrl+f13", "seconds": 30}) == {"ok": True}
    r = api_engine.get("/api/record")
    assert r["armed"] is True and 0 < r["left"] <= 30
    assert api_engine.post("/api/record", {"cancel": True}) == {"ok": True}
    assert api_engine.get("/api/record")["armed"] is False


def test_history_and_restore(api, cfg_path):
    cfg = api.get("/api/config")["config"]
    cfg["brightness"] = 11
    api.post("/api/config", {"config": cfg})
    entries = api.get("/api/history")["entries"]
    assert len(entries) >= 2
    oldest = entries[-1]
    r = api.post("/api/history/restore", {"id": oldest["id"]})
    assert set(r) == {"config", "when"}
    assert r["config"]["brightness"] == 70


def test_export_and_import(api, cfg_path):
    r = api.post("/api/export", {"include_secrets": False})
    assert r["name"].endswith(".zip")
    data = r["data"]
    summary = api.post("/api/import", {"name": r["name"], "data": data, "dry_run": True})
    assert set(summary) == {"summary"}
    r = api.post("/api/import", {"name": r["name"], "data": data, "mode": "replace"})
    assert r["ok"] is True and r["config"]["brightness"] == 70
    bad = base64.b64encode(b"language: en\npages:\n  main:\n    1: { action: { type: nope } }\n").decode()
    r = api.post("/api/import", {"name": "config.yaml", "data": bad, "mode": "replace"})
    assert r["ok"] is False and r["errors"]
    # sem a seção pages: o arquivo não é um config do Deck; é um problema do arquivo ({ok: false}), não erro 500,
    # já na prévia (dry_run, o que o editor manda primeiro) e no importar
    empty = base64.b64encode(b"language: en\n").decode()
    no_pages = ["the file doesn't look like a Deck setup (the pages section is missing)"]
    for extra in ({"dry_run": True}, {"mode": "replace"}):
        r = api.post("/api/import", {"name": "config.yaml", "data": empty, **extra})
        assert r == {"ok": False, "errors": no_pages}


# ---------------------------------------------------------------------------- as regras do HTTP


def test_wrong_token(api):
    status, r = api.request("GET", "/api/config", token="errado")
    assert status == 403 and r == {"error": "token inválido", "code": "token"}


def test_wrong_host(api):
    status, r = api.request("GET", "/api/config", host="evil.example:80")
    assert status == 403 and r == b"host"


def test_unknown_route(api):
    status, r = api.request("GET", "/api/nada")
    assert status == 404 and r == {"error": "rota desconhecida"}
    status, r = api.request("GET", "/api/validate")  # existe só como POST
    assert status == 404


def test_bad_json_and_big_body(api):
    status, r = api.request("POST", "/api/validate", raw=b"{nao e json")
    assert status == 400 and r["error"].startswith("JSON:")
    conn = http.client.HTTPConnection("127.0.0.1", api.srv.port, timeout=10)
    conn.putrequest("POST", "/api/validate", skip_host=True)
    conn.putheader("Host", f"127.0.0.1:{api.srv.port}")
    conn.putheader("X-Token", api.srv.token)
    conn.putheader("Content-Length", str(8 * 1024 * 1024 + 1))
    conn.endheaders()
    resp = conn.getresponse()
    assert resp.status == 413 and json.loads(resp.read()) == {"error": "corpo grande demais"}
    conn.close()


def test_route_error_envelope(api):
    status, r = api.request("POST", "/api/history/restore", {}, check_request=False)  # sem "id"
    assert status == 500 and r == {"error": "KeyError: 'id'"}


def test_static_files(api):
    status, body = api.request("GET", "/")
    assert status == 200 and b"<html" in body.lower()
    status, body = api.request("GET", "/tokens.css")
    assert status == 200
    for path in ("/../config.yaml", "/..%2f..%2fconfig.yaml", "/nada.js"):
        status, _ = api.request("GET", path)
        assert status == 404, path
    # sem corpo: num POST fora da /api o servidor responde 405 sem ler o corpo, e no Windows a conexão pode
    # cair antes de o cliente ler a resposta (o navegador nunca faz isso)
    status, _ = api.request("POST", "/index.html", raw=b"")
    assert status == 405


def test_token_survives_restart(cfg_path, no_side_effects):
    a = _server(cfg_path, None)
    b = _server(cfg_path, None)
    try:
        assert a.token == b.token  # aba aberta continua com permissão depois que o app reinicia
    finally:
        for s in (a, b):
            s.stop()
            s.httpd.server_close()


def test_history_is_recorded_when_the_server_starts(cfg_path, no_side_effects):
    srv = _server(cfg_path, None)
    try:
        assert history.entries(cfg_path)
    finally:
        srv.stop()
        srv.httpd.server_close()


# ---------------------------------------------------------------------------- o contrato


def test_schema_file_is_up_to_date():
    from app.editor.api import ROUTES

    assert SCHEMA == contract.json_schema(ROUTES), "rode: python -m app.editor.contract"


def test_every_route_has_types():
    from app.editor.api import ROUTES

    for key, r in ROUTES.items():
        assert r.response is not None, key
        assert key[0] == "GET" or r.request is not None, key  # todo POST diz o que recebe


def test_contract_catches_a_missing_or_extra_key(api):
    about = api.get("/api/about")
    check_contract("response", "GET /api/about", about)
    with pytest.raises(AssertionError, match="fora do contrato"):
        check_contract("response", "GET /api/about", {k: v for k, v in about.items() if k != "log"})
    with pytest.raises(AssertionError, match="fora do contrato"):
        check_contract("response", "GET /api/about", {**about, "extra": 1})
    with pytest.raises(AssertionError, match="fora do contrato"):
        check_contract("response", "GET /api/about", {**about, "device": "sim"})


def test_contract_unions_pick_one_shape():
    ok = {"ok": True}
    check_contract("response", "POST /api/config", ok)
    check_contract("response", "POST /api/config", {"ok": False, "errors": ["x"]})
    with pytest.raises(AssertionError):
        check_contract("response", "POST /api/config", {"ok": True, "errors": ["x"]})
    with pytest.raises(AssertionError):
        check_contract("response", "POST /api/config", {"ok": False})


def test_optional_keys_are_optional():
    check_contract("error", "", {"error": "x"})
    check_contract("error", "", {"error": "token inválido", "code": "token"})
    with pytest.raises(AssertionError):
        check_contract("error", "", {"error": "x", "code": "outro"})


# ---------------------------------------------------------------------------- o editor novo em /next


def test_next_editor_is_served_from_its_build(api, tmp_path, monkeypatch):
    from app import paths

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>novo</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("export {}", encoding="utf-8")
    (dist / "assets" / "app.css").write_text("body{}", encoding="utf-8")
    monkeypatch.setattr(paths, "EDITOR_NEXT", dist)
    for path in ("/next", "/next/"):
        status, body = api.request("GET", path)
        assert status == 200 and b"novo" in body, path
    conn = http.client.HTTPConnection("127.0.0.1", api.srv.port, timeout=10)
    conn.request("GET", "/next/assets/app.js", headers={"Host": f"127.0.0.1:{api.srv.port}"})
    r = conn.getresponse()
    r.read()
    assert r.status == 200
    assert r.getheader("Content-Type") == "text/javascript; charset=utf-8"  # módulo: o navegador exige JS
    conn.close()
    for path in ("/next/../config.yaml", "/next/../../app/paths.py", "/next/nada.js"):
        status, _ = api.request("GET", path)
        assert status == 404, path
    # o editor atual continua em /
    status, body = api.request("GET", "/")
    assert status == 200 and b"novo" not in body


def test_next_without_build_is_404(api, tmp_path, monkeypatch):
    from app import paths

    monkeypatch.setattr(paths, "EDITOR_NEXT", tmp_path / "nao-existe")
    status, _ = api.request("GET", "/next/")
    assert status == 404
