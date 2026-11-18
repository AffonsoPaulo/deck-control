"""Ícone na bandeja do Windows (pystray)."""

from __future__ import annotations

import ctypes
import os
import tempfile
import threading
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING

import pystray
from pystray._util import win32

from app import brand, logs, winutil
from app.i18n import tr
from app import i18n

if TYPE_CHECKING:
    from app.editor.server import EditorServer
    from app.engine import Engine

log = logs.get("app")
TIP_MAX = 127  # o Windows corta a dica da bandeja em 127 caracteres


def _dpi_aware() -> None:
    """Pede ao Windows o tamanho real do ícone (20/24 px em telas com zoom), sem esticar o de 16."""
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # por monitor, v2
    except (AttributeError, OSError):
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except (AttributeError, OSError):
            pass


class _TrayIcon(pystray.Icon):
    """Usa um .ico com cada tamanho desenhado à parte, no tamanho exato da bandeja.

    O pystray reduziria uma imagem só, e o ícone ficaria borrado em 16 px.
    """

    lit = False
    alert = False  # problema em aberto: selo âmbar no canto

    def _assert_icon_handle(self):
        if self._icon_handle:
            return
        size = ctypes.windll.user32.GetSystemMetrics(49) or 16  # SM_CXSMICON
        fd, path = tempfile.mkstemp(suffix=".ico")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(brand.ico(self.lit, alert=self.alert))
            self._icon_handle = win32.LoadImage(None, path, win32.IMAGE_ICON, size, size, win32.LR_LOADFROMFILE)
        finally:
            os.unlink(path)


def _text(text: str):
    """Texto de item do menu que segue o idioma atual (o pystray chama de novo a cada abertura)."""
    return lambda item: tr(text)


def tooltip(connected: bool, page: str, problems: list[dict]) -> str:
    """Dica da bandeja: o estado do Deck ou, com problema em aberto, o primeiro (e quantos mais)."""
    if not problems:
        tip = tr("Deck: page {page}", page=page) if connected else tr("Deck disconnected")
        return tip[:TIP_MAX]
    more = f" {tr('(+{n} more)', n=len(problems) - 1)}" if len(problems) > 1 else ""
    text = " ".join(str(problems[0]["text"]).split())
    room = TIP_MAX - len("Deck: ") - len(more)
    if len(text) > room:
        text = text[: room - 1].rstrip() + "…"
    return f"Deck: {text}{more}"


def run_tray(engine: "Engine", editor: "EditorServer", config: Path) -> None:
    """Roda o engine numa thread e a bandeja na thread principal (até 'Sair')."""
    worker = threading.Thread(target=engine.run, daemon=True, name="engine")

    def open_editor(icon=None, item=None):
        webbrowser.open(editor.url)

    def open_config(icon, item):
        os.startfile(str(config))

    def open_log(icon, item):
        os.startfile(str(winutil.log_path()))

    def open_folder(icon, item):
        os.startfile(str(config.parent))

    def toggle_autostart(icon, item):
        try:
            winutil.set_autostart(not winutil.autostart_enabled(), config)
        except winutil.AutostartBlocked as e:  # executável sem assinatura: ligar é pelo instalador
            winutil.message_box(str(e))

    def quit_app(icon, item):
        engine.stop()
        editor.stop()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(_text("Open editor"), open_editor, default=True),
        pystray.MenuItem(_text("Open config.yaml"), open_config),
        pystray.MenuItem(_text("Open the app folder"), open_folder),
        pystray.MenuItem(_text("View the log"), open_log),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(
            _text("Start with Windows"), toggle_autostart, checked=lambda item: winutil.autostart_enabled()
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(_text("Quit"), quit_app),
    )
    _dpi_aware()
    icon = _TrayIcon("D6Deck", brand.mark(64, False), tr("Deck disconnected"), menu)

    notified: set[str] = set()  # problemas em aberto que já viraram notificação do Windows

    def notify_new(problems: list[dict]) -> None:
        """logging.notify: uma notificação por problema quando ele abre (nunca de novo enquanto aberto)."""
        open_ids = {p["id"] for p in problems}
        notified.intersection_update(open_ids)  # resolvido: se voltar, avisa de novo
        if not logs.setting(engine.config.get("logging"), "notify", False):
            notified.update(open_ids)  # desligado: não acumula avisos para depois
            return
        for p in problems:
            if p["id"] not in notified:
                notified.add(p["id"])
                try:
                    icon.notify(str(p["text"])[:250], "Deck")
                except Exception:
                    log.warning("Windows notification failed", exc_info=True)

    def watch_status():
        """Atualiza o ícone/tooltip conforme a conexão com o D6 e os problemas em aberto."""
        last = None
        tick = threading.Event()
        while worker.is_alive() or last is None:
            try:
                problems = logs.problems()
                cur = (
                    engine.device_connected,
                    engine.page,
                    i18n.language(),
                    tuple((p["id"], p["text"]) for p in problems),
                )
                if cur != last:
                    alert = bool(problems)
                    before = (last[0], bool(last[3])) if last else None
                    if (cur[0], alert) != before:
                        icon.lit, icon.alert = cur[0], alert
                        icon.icon = brand.mark(64, cur[0], alert)  # troca o ícone (o .ico sai de lit/alert)
                    icon.title = tooltip(cur[0], cur[1], problems)
                    last = cur
                notify_new(problems)
            except Exception:
                log.warning("Tray status update failed", exc_info=True)
            tick.wait(1)

    def setup(icon):
        icon.visible = True
        worker.start()
        threading.Thread(target=watch_status, daemon=True, name="tray-status").start()

    icon.run(setup=setup)
    worker.join(timeout=3)
