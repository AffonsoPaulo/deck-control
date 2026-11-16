"""Simulação de teclado no Windows via SendInput (sem dependências externas).

Formato de atalho: teclas separadas por '+', ex.:
    "ctrl+shift+m"   "win+shift+s"   "alt+f4"   "f13"   "play_pause"
Várias combinações em sequência: lista de strings, ex. ["ctrl+c", "alt+tab", "ctrl+v"].
"""
from __future__ import annotations

import ctypes
import time
from ctypes import wintypes
from app.i18n import tr

_user32 = ctypes.WinDLL("user32", use_last_error=True)

INPUT_KEYBOARD = 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_SCANCODE = 0x0008
MAPVK_VK_TO_VSC = 0

ULONG_PTR = ctypes.c_size_t


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]


_user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
_user32.SendInput.restype = wintypes.UINT
_user32.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
_user32.MapVirtualKeyW.restype = wintypes.UINT

VK: dict[str, int] = {
    # modificadores
    "ctrl": 0x11, "control": 0x11, "lctrl": 0xA2, "rctrl": 0xA3,
    "shift": 0x10, "lshift": 0xA0, "rshift": 0xA1,
    "alt": 0x12, "lalt": 0xA4, "ralt": 0xA5, "altgr": 0xA5,
    "win": 0x5B, "lwin": 0x5B, "rwin": 0x5C,
    # edição / navegação
    "backspace": 0x08, "tab": 0x09, "enter": 0x0D, "return": 0x0D, "pause": 0x13,
    "capslock": 0x14, "esc": 0x1B, "escape": 0x1B, "space": 0x20,
    "pageup": 0x21, "pgup": 0x21, "pagedown": 0x22, "pgdn": 0x22, "end": 0x23, "home": 0x24,
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "printscreen": 0x2C, "prtsc": 0x2C, "insert": 0x2D, "ins": 0x2D, "delete": 0x2E, "del": 0x2E,
    "apps": 0x5D, "menu": 0x5D,
    # numpad
    **{f"num{i}": 0x60 + i for i in range(10)},
    "multiply": 0x6A, "add": 0x6B, "subtract": 0x6D, "decimal": 0x6E, "divide": 0x6F,
    "numlock": 0x90, "scrolllock": 0x91,
    # F1..F24
    **{f"f{i}": 0x6F + i for i in range(1, 25)},
    # mídia / volume
    "volume_mute": 0xAD, "mute": 0xAD, "volume_down": 0xAE, "vol_down": 0xAE,
    "volume_up": 0xAF, "vol_up": 0xAF,
    "next": 0xB0, "next_track": 0xB0, "prev": 0xB1, "prev_track": 0xB1, "previous": 0xB1,
    "stop": 0xB2, "media_stop": 0xB2, "play_pause": 0xB3, "playpause": 0xB3,
    "browser_back": 0xA6, "browser_forward": 0xA7, "browser_refresh": 0xA8,
    "launch_mail": 0xB4, "launch_media": 0xB5, "calculator": 0xB7,
    # pontuação (layout US/ABNT2 pode variar)
    ";": 0xBA, "=": 0xBB, ",": 0xBC, "-": 0xBD, ".": 0xBE, "/": 0xBF, "`": 0xC0,
    "[": 0xDB, "\\": 0xDC, "]": 0xDD, "'": 0xDE,
}
for _c in "abcdefghijklmnopqrstuvwxyz":
    VK[_c] = ord(_c.upper())
for _d in "0123456789":
    VK[_d] = ord(_d)

_EXTENDED = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0x5D,
             0x6F, 0x90, 0xA3, 0xA5, 0x2C}
_MEDIA = set(range(0xA6, 0xB8))


def parse_combo(combo: str) -> list[int]:
    keys = []
    for part in combo.lower().replace(" ", "").split("+"):
        if not part:
            continue
        if part not in VK:
            raise ValueError(tr("unknown key: '{key}' in '{combo}'", key=part, combo=combo))
        keys.append(VK[part])
    if not keys:
        raise ValueError(tr("empty shortcut: '{combo}'", combo=combo))
    return keys


def _key_input(vk: int, up: bool) -> INPUT:
    flags = KEYEVENTF_KEYUP if up else 0
    if vk in _MEDIA:
        # Teclas de mídia funcionam por VK, sem scan code.
        return INPUT(INPUT_KEYBOARD, _INPUTUNION(ki=KEYBDINPUT(vk, 0, flags, 0, 0)))
    scan = _user32.MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)
    if vk in _EXTENDED:
        flags |= KEYEVENTF_EXTENDEDKEY
    return INPUT(INPUT_KEYBOARD, _INPUTUNION(ki=KEYBDINPUT(vk, scan, flags, 0, 0)))


def _send(inputs: list[INPUT]) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    sent = _user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))
    if sent != len(inputs):
        raise ctypes.WinError(ctypes.get_last_error())


def press_combo(combo: str, hold_ms: int = 30) -> None:
    """Aperta a combinação (na ordem) e solta (na ordem inversa)."""
    vks = parse_combo(combo)
    _send([_key_input(vk, False) for vk in vks])
    time.sleep(hold_ms / 1000)
    _send([_key_input(vk, True) for vk in reversed(vks)])


def key_down(combo: str) -> None:
    _send([_key_input(vk, False) for vk in parse_combo(combo)])


def key_up(combo: str) -> None:
    _send([_key_input(vk, True) for vk in reversed(parse_combo(combo))])


def type_text(text: str, delay_ms: int = 0) -> None:
    """Digita texto Unicode (acentos e emoji funcionam; não depende do layout)."""
    for ch in text:
        if ch == "\n":
            press_combo("enter", hold_ms=5)
        else:
            units = ch.encode("utf-16-le")
            for i in range(0, len(units), 2):
                code = int.from_bytes(units[i:i + 2], "little")
                _send([INPUT(INPUT_KEYBOARD, _INPUTUNION(ki=KEYBDINPUT(0, code, KEYEVENTF_UNICODE, 0, 0))),
                       INPUT(INPUT_KEYBOARD, _INPUTUNION(ki=KEYBDINPUT(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0, 0)))])
        if delay_ms:
            time.sleep(delay_ms / 1000)
