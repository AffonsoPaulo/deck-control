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

from app import brand, winutil
from app.i18n import tr
from app import i18n

if TYPE_CHECKING:
    from app.editor.server import EditorServer
    from app.engine import Engine


def _dpi_aware() -> None:
    """Pede ao Windows o tamanho real do ícone (20/24 px em telas com zoom), sem esticar o de 16."""
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))   # por monitor, v2
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

    def _assert_icon_handle(self):
        if self._icon_handle:
            return
        size = ctypes.windll.user32.GetSystemMetrics(49) or 16          # SM_CXSMICON
        fd, path = tempfile.mkstemp(suffix=".ico")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(brand.ico(self.lit))
            self._icon_handle = win32.LoadImage(None, path, win32.IMAGE_ICON, size, size, win32.LR_LOADFROMFILE)
        finally:
            os.unlink(path)


def _text(text: str):
    """Texto de item do menu que segue o idioma atual (o pystray chama de novo a cada abertura)."""
    return lambda item: tr(text)


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
        winutil.set_autostart(not winutil.autostart_enabled(), config)

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
        pystray.MenuItem(_text("Start with Windows"), toggle_autostart,
                         checked=lambda item: winutil.autostart_enabled()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(_text("Quit"), quit_app),
    )
    _dpi_aware()
    icon = _TrayIcon("D6Deck", brand.mark(64, False), tr("Deck disconnected"), menu)

    def watch_status():
        """Atualiza o ícone/tooltip conforme a conexão com o D6."""
        last = None
        while worker.is_alive() or last is None:
            cur = (engine.device_connected, engine.page, i18n.language())
            if cur != last:
                icon.lit = cur[0]
                icon.icon = brand.mark(64, cur[0])      # troca o ícone (o .ico sai de icon.lit)
                icon.title = tr("Deck: page {page}", page=cur[1]) if cur[0] else tr("Deck disconnected")
                last = cur
            threading.Event().wait(1)

    def setup(icon):
        icon.visible = True
        worker.start()
        threading.Thread(target=watch_status, daemon=True, name="tray-status").start()

    icon.run(setup=setup)
    worker.join(timeout=3)
