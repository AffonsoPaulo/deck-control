"""Avisos de energia do Windows: desligar ou encerrar a sessão, o PC indo dormir e acordando.

O D6 é alimentado pela USB, e muitos PCs mantêm a USB ligada com o computador desligado (para carregar fones e
celulares). Sem aviso, o aparelho ficaria aceso com a última imagem. watch() abre uma janela invisível numa
thread própria e repassa os avisos (dispatch); quem chama decide o que fazer (o __main__ liga no engine:
apagar o Deck, soltar e reconectar). Importar este módulo não abre nada.

A janela é de nível superior (sem WS_VISIBLE): janelas só de mensagem (HWND_MESSAGE) não recebem esses avisos.
"""

from __future__ import annotations

import ctypes
import itertools
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass

from app import logs

log = logs.get("device")

WM_QUERYENDSESSION = 0x0011
WM_ENDSESSION = 0x0016
WM_POWERBROADCAST = 0x0218
PBT_APMSUSPEND = 0x0004
PBT_APMRESUMESUSPEND = 0x0007
PBT_APMRESUMEAUTOMATIC = 0x0012

_names = itertools.count(1)


@dataclass
class Handlers:
    suspend: Callable[[], object]  # o PC vai dormir (o Windows dá ~2 s)
    resume: Callable[[], object]  # acordou (pode vir duas vezes: automático e com a pessoa)
    end_session: Callable[[], object]  # vai desligar, reiniciar ou encerrar a sessão (o Windows dá ~5 s)


def dispatch(msg: int, wparam: int, handlers: Handlers) -> int | None:
    """O que fazer com cada mensagem. None: não é um aviso daqui (vai para o DefWindowProc)."""
    if msg == WM_QUERYENDSESSION:
        return 1  # pode desligar: o Deck nunca segura o desligamento
    if msg == WM_ENDSESSION:
        if wparam:  # 0 = o desligamento foi cancelado
            log.info("Windows is shutting down or signing out")
            handlers.end_session()
        return 0
    if msg == WM_POWERBROADCAST:
        if wparam == PBT_APMSUSPEND:
            log.info("The PC is going to sleep")
            handlers.suspend()
        elif wparam in (PBT_APMRESUMESUSPEND, PBT_APMRESUMEAUTOMATIC):
            log.info("The PC woke up")
            handlers.resume()
        return 1
    return None


def watch(handlers: Handlers) -> int | None:
    """Abre a janela dos avisos numa thread (daemon) e devolve o handle dela (None fora do Windows ou se falhar)."""
    if sys.platform != "win32":
        return None
    ready = threading.Event()
    box: dict[str, int] = {}
    threading.Thread(target=_loop, args=(handlers, ready, box), daemon=True, name="power").start()
    ready.wait(5)
    return box.get("hwnd")


def _loop(handlers: Handlers, ready: threading.Event, box: dict[str, int]) -> None:
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    lresult = ctypes.c_ssize_t
    wndproc_t = ctypes.WINFUNCTYPE(lresult, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [
            ("style", wintypes.UINT),
            ("lpfnWndProc", wndproc_t),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE),
            ("hIcon", wintypes.HICON),
            ("hCursor", wintypes.HANDLE),
            ("hbrBackground", wintypes.HBRUSH),
            ("lpszMenuName", wintypes.LPCWSTR),
            ("lpszClassName", wintypes.LPCWSTR),
        ]

    user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.DefWindowProcW.restype = lresult
    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID,
    ]  # fmt: skip
    user32.CreateWindowExW.restype = wintypes.HWND
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE

    def proc(hwnd: int, msg: int, wparam: int, lparam: int) -> int:
        try:
            out = dispatch(msg, wparam, handlers)
        except Exception:
            log.warning("Handling a Windows power notice failed", exc_info=True)
            out = None
        return out if out is not None else user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    callback = wndproc_t(proc)  # a referência fica viva enquanto o laço roda (o Windows chama por ela)
    hinst = kernel32.GetModuleHandleW(None)
    wc = WNDCLASSW()
    wc.lpfnWndProc = callback
    wc.hInstance = hinst
    wc.lpszClassName = f"D6DeckPower{next(_names)}"  # um nome por janela: cada uma com o seu callback
    hwnd = None
    if user32.RegisterClassW(ctypes.byref(wc)):
        hwnd = user32.CreateWindowExW(0, wc.lpszClassName, "Deck", 0, 0, 0, 0, 0, None, None, hinst, None)
    if not hwnd:
        log.warning("Couldn't listen to Windows power notices (error %s)", ctypes.get_last_error())
        ready.set()
        return
    box["hwnd"] = hwnd
    ready.set()
    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))
